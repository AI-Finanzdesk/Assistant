"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createMeetingEvent, getAccessToken } from "@/lib/microsoft/graph";
import { prepareAgenda, runAssistantForUser } from "@/lib/services/assistant";
import { syncTaskToCalendar } from "@/lib/services/calendar";
import { syncMailForUser } from "@/lib/services/mail";
import { requireUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MemberRole } from "@/lib/types";

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────
// Projecten en deelnemers
// ─────────────────────────────────────────────────────────────

export async function createProject(form: FormData) {
  const { supabase, user } = await requireUser();
  const name = str(form, "name");
  if (!name) return;
  const { data, error } = await supabase
    .from("projects")
    .insert({ name, description: str(form, "description"), created_by: user.id })
    .select("id")
    .single();
  check(error);
  check(
    (await supabase.from("project_members").insert({ project_id: data!.id, user_id: user.id, role: "owner" })).error,
  );
  redirect(`/projects/${data!.id}`);
}

export async function updateProject(projectId: string, form: FormData) {
  const { supabase } = await requireUser();
  check(
    (
      await supabase
        .from("projects")
        .update({ name: str(form, "name"), description: str(form, "description"), status: str(form, "status") ?? "active" })
        .eq("id", projectId)
    ).error,
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function addMember(projectId: string, form: FormData) {
  const { supabase } = await requireUser();
  const userId = str(form, "user_id");
  if (!userId) return;
  const role = (str(form, "role") ?? "member") as MemberRole;
  check(
    (
      await supabase.from("project_members").upsert({
        project_id: projectId,
        user_id: userId,
        role,
        // Gasten zien standaard alleen wat aan hen is toegewezen.
        see_all_meetings: role !== "guest",
        see_emails: role !== "guest",
      })
    ).error,
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function updateMember(projectId: string, userId: string, form: FormData) {
  const { supabase } = await requireUser();
  check(
    (
      await supabase
        .from("project_members")
        .update({
          role: str(form, "role") ?? "member",
          see_all_meetings: form.get("see_all_meetings") === "on",
          see_emails: form.get("see_emails") === "on",
          calendar_tasks: form.get("calendar_tasks") === "on",
        })
        .eq("project_id", projectId)
        .eq("user_id", userId)
    ).error,
  );
  revalidatePath(`/projects/${projectId}`);
}

export async function removeMember(projectId: string, userId: string) {
  const { supabase } = await requireUser();
  check((await supabase.from("project_members").delete().eq("project_id", projectId).eq("user_id", userId)).error);
  revalidatePath(`/projects/${projectId}`);
}

export async function linkTopic(projectId: string, form: FormData) {
  const { supabase } = await requireUser();
  const topicId = str(form, "topic_id");
  if (!topicId) return;
  check((await supabase.from("project_topics").upsert({ project_id: projectId, topic_id: topicId })).error);
  revalidatePath(`/projects/${projectId}`);
}

export async function unlinkTopic(projectId: string, topicId: string) {
  const { supabase } = await requireUser();
  check((await supabase.from("project_topics").delete().eq("project_id", projectId).eq("topic_id", topicId)).error);
  revalidatePath(`/projects/${projectId}`);
}

// ─────────────────────────────────────────────────────────────
// Kennisbank
// ─────────────────────────────────────────────────────────────

function tags(form: FormData) {
  return (str(form, "tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function createTopic(form: FormData) {
  const { supabase, user } = await requireUser();
  const title = str(form, "title");
  if (!title) return;
  const { data, error } = await supabase
    .from("knowledge_topics")
    .insert({ title, summary: str(form, "summary"), tags: tags(form), created_by: user.id })
    .select("id")
    .single();
  check(error);
  const projectId = str(form, "project_id");
  if (projectId) await supabase.from("project_topics").insert({ project_id: projectId, topic_id: data!.id });
  redirect(`/knowledge/${data!.id}`);
}

export async function updateTopic(topicId: string, form: FormData) {
  const { supabase } = await requireUser();
  check(
    (
      await supabase
        .from("knowledge_topics")
        .update({
          title: str(form, "title"),
          summary: str(form, "summary"),
          body: str(form, "body"),
          tags: tags(form),
          updated_at: new Date().toISOString(),
        })
        .eq("id", topicId)
    ).error,
  );
  revalidatePath(`/knowledge/${topicId}`);
}

export async function addEntry(topicId: string, form: FormData) {
  const { supabase, user } = await requireUser();
  const body = str(form, "body");
  if (!body) return;
  check((await supabase.from("knowledge_entries").insert({ topic_id: topicId, body, created_by: user.id })).error);
  revalidatePath(`/knowledge/${topicId}`);
}

// ─────────────────────────────────────────────────────────────
// Meetings
// ─────────────────────────────────────────────────────────────

export async function createMeeting(form: FormData) {
  const { supabase, user, profile } = await requireUser();
  const topic = str(form, "topic");
  const title = str(form, "title") ?? topic;
  if (!title) return;
  const scheduled = str(form, "scheduled_at");

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      title,
      topic,
      project_id: str(form, "project_id"),
      scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
      language: str(form, "language") ?? profile.language,
      created_by: user.id,
    })
    .select("id")
    .single();
  check(error);
  const meetingId = meeting!.id as string;

  const userIds = new Set(form.getAll("participant_ids").map(String));
  userIds.add(user.id);
  const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", [...userIds]);
  const extra = (str(form, "extra_participants") ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const rows = [
    ...(people ?? []).map((p) => ({ meeting_id: meetingId, user_id: p.id, name: p.full_name ?? p.email })),
    ...extra.map((name) => ({ meeting_id: meetingId, user_id: null, name })),
  ];
  check((await supabase.from("meeting_participants").insert(rows)).error);
  check((await supabase.from("meeting_content").insert({ meeting_id: meetingId })).error);

  if (form.get("with_agenda") === "on") {
    try {
      await prepareAgenda(meetingId);
    } catch (e) {
      console.error("Agenda opstellen mislukt", e);
    }
  }
  redirect(`/meetings/${meetingId}`);
}

async function assertCanEdit(meetingId: string) {
  const { supabase, user, profile } = await requireUser();
  const { data } = await supabase.rpc("can_edit_meeting", { mid: meetingId });
  if (!data) throw new Error("Geen rechten voor deze meeting");
  return { supabase, user, profile };
}

export async function generateAgendaAction(meetingId: string) {
  await assertCanEdit(meetingId);
  await prepareAgenda(meetingId);
  revalidatePath(`/meetings/${meetingId}`);
}

export async function saveAgenda(meetingId: string, form: FormData) {
  const { supabase } = await assertCanEdit(meetingId);
  check(
    (
      await supabase
        .from("meeting_content")
        .upsert({ meeting_id: meetingId, agenda_md: str(form, "agenda_md"), updated_at: new Date().toISOString() })
    ).error,
  );
  revalidatePath(`/meetings/${meetingId}`);
}

export async function setConsent(meetingId: string, consent: boolean) {
  const { supabase } = await assertCanEdit(meetingId);
  check((await supabase.from("meetings").update({ consent_confirmed: consent }).eq("id", meetingId)).error);
  revalidatePath(`/meetings/${meetingId}`);
}

/** Na een upload vanuit de browser: pad van de opname vastleggen. */
export async function setAudioPath(meetingId: string, path: string) {
  const { supabase } = await assertCanEdit(meetingId);
  if (!path.startsWith(`${meetingId}/`)) throw new Error("Ongeldig pad");
  check((await supabase.from("meetings").update({ audio_path: path, status: "uploaded" }).eq("id", meetingId)).error);
  revalidatePath(`/meetings/${meetingId}`);
}

export async function setSectionVisibility(meetingId: string, sectionId: string, form: FormData) {
  const { supabase } = await assertCanEdit(meetingId);
  const visibleTo = form.getAll("visible_to").map(String);
  check(
    (await supabase.from("meeting_sections").update({ visible_to: visibleTo }).eq("id", sectionId).eq("meeting_id", meetingId))
      .error,
  );
  revalidatePath(`/meetings/${meetingId}`);
}

export async function confirmMeetingTasks(meetingId: string) {
  const { supabase } = await assertCanEdit(meetingId);
  const { data: tasks, error } = await supabase
    .from("tasks")
    .update({ status: "open" })
    .eq("meeting_id", meetingId)
    .eq("status", "proposed")
    .select("id");
  check(error);
  for (const t of tasks ?? []) {
    try {
      await syncTaskToCalendar(t.id);
    } catch (e) {
      console.error("Agenda-sync mislukt", e);
    }
  }
  revalidatePath(`/meetings/${meetingId}`);
}

export async function meetingToCalendar(meetingId: string) {
  const { supabase, user, profile } = await assertCanEdit(meetingId);
  if (!profile.calendar_sync_enabled) throw new Error("Agenda-sync staat uit in je instellingen");
  const token = await getAccessToken(user.id);
  if (!token) throw new Error("Geen Microsoft-account gekoppeld");

  const [{ data: meeting }, { data: content }, { data: participants }] = await Promise.all([
    supabase.from("meetings").select("*").eq("id", meetingId).single(),
    supabase.from("meeting_content").select("agenda_md").eq("meeting_id", meetingId).maybeSingle(),
    supabase.from("meeting_participants").select("user_id, profiles(email)").eq("meeting_id", meetingId),
  ]);
  if (!meeting?.scheduled_at) throw new Error("Meeting heeft geen datum");

  const attendees = (participants ?? [])
    .filter((p) => p.user_id && p.user_id !== user.id)
    .map((p) => (p.profiles as unknown as { email: string } | null)?.email)
    .filter((e): e is string => Boolean(e));

  const eventId = await createMeetingEvent(token, {
    title: meeting.title,
    start: meeting.scheduled_at,
    agenda: content?.agenda_md ?? null,
    link: `${process.env.APP_URL}/meetings/${meetingId}`,
    attendees,
  });
  await supabase.from("meetings").update({ calendar_event_id: eventId }).eq("id", meetingId);
  revalidatePath(`/meetings/${meetingId}`);
}

// ─────────────────────────────────────────────────────────────
// Taken
// ─────────────────────────────────────────────────────────────

export async function createTask(form: FormData) {
  const { supabase, user } = await requireUser();
  const title = str(form, "title");
  if (!title) return;
  const assigneeId = str(form, "assignee_id");
  let assigneeName: string | null = null;
  if (assigneeId) {
    const { data } = await supabase.from("profiles").select("full_name, email").eq("id", assigneeId).single();
    assigneeName = data?.full_name ?? data?.email ?? null;
  }
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description: str(form, "description"),
      project_id: str(form, "project_id"),
      assignee_id: assigneeId,
      assignee_name: assigneeName,
      due_date: str(form, "due_date"),
      status: "open",
      created_by: user.id,
    })
    .select("id")
    .single();
  check(error);
  try {
    await syncTaskToCalendar(data!.id);
  } catch (e) {
    console.error("Agenda-sync mislukt", e);
  }
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function setTaskStatus(taskId: string, status: "open" | "done") {
  const { supabase } = await requireUser();
  const { data: updated, error } = await supabase
    .from("tasks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", taskId)
    .select("id");
  check(error);
  if (status === "open" && updated?.length) {
    try {
      await syncTaskToCalendar(taskId);
    } catch (e) {
      console.error("Agenda-sync mislukt", e);
    }
  }
  revalidatePath("/", "layout");
}

export async function assignTask(taskId: string, form: FormData) {
  const { supabase } = await requireUser();
  const assigneeId = str(form, "assignee_id");
  let assigneeName: string | null = null;
  if (assigneeId) {
    const { data } = await supabase.from("profiles").select("full_name, email").eq("id", assigneeId).single();
    assigneeName = data?.full_name ?? data?.email ?? null;
  }
  check(
    (
      await supabase
        .from("tasks")
        .update({ assignee_id: assigneeId, assignee_name: assigneeName, due_date: str(form, "due_date") })
        .eq("id", taskId)
    ).error,
  );
  revalidatePath("/", "layout");
}

export async function deleteTask(taskId: string) {
  const { supabase } = await requireUser();
  check((await supabase.from("tasks").delete().eq("id", taskId)).error);
  revalidatePath("/", "layout");
}

// ─────────────────────────────────────────────────────────────
// Instellingen
// ─────────────────────────────────────────────────────────────

export async function updateProfile(form: FormData) {
  const { supabase, user } = await requireUser();
  check(
    (
      await supabase
        .from("profiles")
        .update({
          full_name: str(form, "full_name"),
          language: str(form, "language") ?? "nl",
          mail_sync_enabled: form.get("mail_sync_enabled") === "on",
          calendar_sync_enabled: form.get("calendar_sync_enabled") === "on",
        })
        .eq("id", user.id)
    ).error,
  );
  revalidatePath("/", "layout");
}

export async function disconnectMicrosoft() {
  const { user } = await requireUser();
  await createAdminClient().from("ms_connections").delete().eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function linkFolder(form: FormData) {
  const { supabase, user } = await requireUser();
  const folder = str(form, "folder");
  const projectId = str(form, "project_id");
  if (!folder || !projectId) return;
  const [folderId, ...nameParts] = folder.split("|");
  check(
    (
      await supabase.from("mail_folder_links").upsert(
        { user_id: user.id, graph_folder_id: folderId, folder_name: nameParts.join("|"), project_id: projectId, delta_link: null },
        { onConflict: "user_id,graph_folder_id" },
      )
    ).error,
  );
  revalidatePath("/settings");
}

export async function unlinkFolder(linkId: string) {
  const { supabase } = await requireUser();
  check((await supabase.from("mail_folder_links").delete().eq("id", linkId)).error);
  revalidatePath("/settings");
}

export async function syncMailNow() {
  const { user } = await requireUser();
  await syncMailForUser(user.id);
  revalidatePath("/", "layout");
}

export async function inviteUser(form: FormData) {
  const { profile } = await requireUser();
  if (!profile.is_admin) throw new Error("Alleen voor beheerders");
  const email = str(form, "email");
  if (!email) return;
  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name: str(form, "full_name") ?? undefined, is_internal: form.get("is_internal") === "on" },
    redirectTo: `${process.env.APP_URL}/login`,
  });
  check(error);
  revalidatePath("/settings");
}

export async function updateUserFlags(userId: string, form: FormData) {
  const { profile } = await requireUser();
  if (!profile.is_admin) throw new Error("Alleen voor beheerders");
  check(
    (
      await createAdminClient()
        .from("profiles")
        .update({ is_internal: form.get("is_internal") === "on", is_admin: form.get("is_admin") === "on" })
        .eq("id", userId)
    ).error,
  );
  revalidatePath("/settings");
}

// ─────────────────────────────────────────────────────────────
// Assistent
// ─────────────────────────────────────────────────────────────

export async function submitWish(form: FormData) {
  const { supabase, user } = await requireUser();
  const title = str(form, "wish");
  if (!title) return;
  check(
    (await supabase.from("suggestions").insert({ kind: "wish", title, user_id: null, created_by: user.id, status: "new" }))
      .error,
  );
  revalidatePath("/");
}

export async function setSuggestionStatus(id: string, status: "accepted" | "dismissed" | "done") {
  const { supabase, user } = await requireUser();
  const { data: s } = await supabase.from("suggestions").select("*").eq("id", id).single();
  check((await supabase.from("suggestions").update({ status }).eq("id", id)).error);

  // Een geaccepteerd taak- of opvolgvoorstel wordt een echte taak.
  if (s && status === "accepted" && (s.kind === "task" || s.kind === "followup")) {
    const { data: me } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).single();
    const { data: task } = await supabase
      .from("tasks")
      .insert({
        title: s.title,
        description: s.body_md,
        project_id: s.project_id,
        assignee_id: user.id,
        assignee_name: me?.full_name ?? me?.email,
        status: "open",
        created_by: user.id,
      })
      .select("id")
      .single();
    if (task) {
      try {
        await syncTaskToCalendar(task.id);
      } catch (e) {
        console.error("Agenda-sync mislukt", e);
      }
    }
  }
  revalidatePath("/");
}

export async function runAssistantNow() {
  const { user, profile } = await requireUser();
  if (!profile.is_internal) throw new Error("Alleen voor het kernteam");
  await runAssistantForUser(user.id);
  revalidatePath("/");
}
