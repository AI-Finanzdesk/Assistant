import "server-only";
import { generateAgenda, weeklyReview } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lang } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Stelt een agenda op voor een meeting: haalt open taken, eerdere verslagen,
 * recente mails en kennis erbij. Rechten zijn al gecontroleerd door de aanroeper.
 */
export async function prepareAgenda(meetingId: string) {
  const admin = createAdminClient();
  const { data: meeting } = await admin.from("meetings").select("*").eq("id", meetingId).single();
  if (!meeting) throw new Error("Meeting niet gevonden");

  const { data: participants } = await admin
    .from("meeting_participants")
    .select("name, user_id")
    .eq("meeting_id", meetingId);
  const participantIds = (participants ?? []).map((p) => p.user_id).filter(Boolean) as string[];

  const projectId: string | null = meeting.project_id;
  const since = new Date(Date.now() - 45 * 86400_000).toISOString();

  const tasksQuery = admin.from("tasks").select("title, assignee_name, due_date").eq("status", "open").limit(40);
  const meetingsQuery = admin
    .from("meetings")
    .select("id, scheduled_at, created_at, meeting_content(summary_md)")
    .eq("status", "done")
    .neq("id", meetingId)
    .order("created_at", { ascending: false })
    .limit(4);
  const emailsQuery = admin
    .from("emails")
    .select("received_at, from_name, subject, summary")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(30);

  const [tasks, meetings, emails, project, topics] = await Promise.all([
    projectId ? tasksQuery.eq("project_id", projectId) : tasksQuery.in("assignee_id", participantIds),
    projectId ? meetingsQuery.eq("project_id", projectId) : meetingsQuery.is("project_id", null),
    projectId ? emailsQuery.eq("project_id", projectId) : Promise.resolve({ data: [] as never[] }),
    projectId ? admin.from("projects").select("name").eq("id", projectId).single() : Promise.resolve({ data: null }),
    admin.from("knowledge_topics").select("id, title, summary"),
  ]);

  const agenda = await generateAgenda({
    topic: meeting.topic ?? meeting.title,
    language: meeting.language as Lang,
    projectName: project.data?.name ?? null,
    participants: (participants ?? []).map((p) => p.name),
    openTasks: (tasks.data ?? []).map(
      (t) => `- ${t.title} (${t.assignee_name ?? "niemand"}${t.due_date ? `, voor ${t.due_date}` : ""})`,
    ),
    previousMeetings: (meetings.data ?? [])
      .map((m) => ({
        date: (m.scheduled_at ?? m.created_at).slice(0, 10),
        summary: (m.meeting_content as unknown as { summary_md: string | null } | null)?.summary_md ?? "",
      }))
      .filter((m) => m.summary),
    recentEmails: (emails.data ?? []).map((e) => ({
      date: (e.received_at ?? "").slice(0, 10),
      from: e.from_name ?? "",
      subject: e.subject ?? "",
      summary: e.summary ?? "",
    })),
    topics: (topics.data ?? []).map((t) => ({ title: t.title, summary: t.summary })),
  });

  const agendaMd = agenda.preparation.length
    ? `${agenda.agenda_md}\n\n**Voorbereiding / Vorbereitung**\n${agenda.preparation.map((p) => `- ${p}`).join("\n")}`
    : agenda.agenda_md;

  await admin.from("meeting_content").upsert({ meeting_id: meetingId, agenda_md: agendaMd, updated_at: new Date().toISOString() });

  const byTitle = new Map((topics.data ?? []).map((t) => [t.title.trim().toLowerCase(), t.id as string]));
  const topicRows = agenda.relevant_topics
    .map((t) => byTitle.get(t.trim().toLowerCase()))
    .filter((id): id is string => Boolean(id))
    .map((topic_id) => ({ meeting_id: meetingId, topic_id }));
  if (topicRows.length) await admin.from("meeting_topics").upsert(topicRows);

  return agendaMd;
}

/** Wekelijkse analyse per kernteamlid → voorstellen op het dashboard. */
export async function runAssistantForUser(userId: string) {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single();
  if (!profile) return 0;

  const context = await buildContext(admin, userId);
  const review = await weeklyReview({
    language: profile.language as Lang,
    userName: profile.full_name ?? profile.email,
    context,
  });

  const { data: projects } = await admin.from("projects").select("id, name");
  const projectByName = new Map((projects ?? []).map((p) => [p.name.trim().toLowerCase(), p.id as string]));

  if (review.suggestions.length) {
    await admin.from("suggestions").insert(
      review.suggestions.map((s) => ({
        // Verbetervoorstellen voor de tool gelden voor het hele kernteam.
        user_id: s.kind === "improvement" ? null : userId,
        project_id: s.project_name ? (projectByName.get(s.project_name.trim().toLowerCase()) ?? null) : null,
        kind: s.kind,
        title: s.title,
        body_md: s.body_md,
      })),
    );
  }
  return review.suggestions.length;
}

export async function runAssistantForAll() {
  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id").eq("is_internal", true);
  let total = 0;
  for (const u of users ?? []) {
    try {
      total += await runAssistantForUser(u.id);
    } catch (e) {
      console.error("Assistent mislukt voor", u.id, e);
    }
  }
  return total;
}

async function buildContext(admin: Admin, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 21 * 86400_000).toISOString();

  const [projects, tasks, meetings, emails, open, wishes] = await Promise.all([
    admin.from("projects").select("id, name, status, description").eq("status", "active"),
    admin
      .from("tasks")
      .select("title, assignee_name, due_date, status, created_at, projects(name)")
      .in("status", ["open", "proposed"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(80),
    admin
      .from("meetings")
      .select("title, created_at, projects(name), meeting_content(summary_md, follow_ups)")
      .gte("created_at", since)
      .eq("status", "done")
      .limit(10),
    admin
      .from("emails")
      .select("received_at, from_name, subject, summary, projects(name)")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(60),
    admin
      .from("suggestions")
      .select("kind, title")
      .in("status", ["new", "accepted"])
      .or(`user_id.eq.${userId},user_id.is.null`),
    admin.from("suggestions").select("title, body_md, created_at").eq("kind", "wish").order("created_at", { ascending: false }).limit(20),
  ]);

  const name = (rel: unknown) => (rel as { name?: string } | null)?.name ?? "—";

  return [
    `Vandaag: ${today}`,
    `## Actieve projecten\n${(projects.data ?? []).map((p) => `- ${p.name}: ${p.description ?? ""}`).join("\n")}`,
    `## Open taken\n${(tasks.data ?? [])
      .map(
        (t) =>
          `- [${name(t.projects)}] ${t.title} – ${t.assignee_name ?? "niemand"}${t.due_date ? `, deadline ${t.due_date}` : ""}${t.status === "proposed" ? " (nog niet bevestigd)" : ""}`,
      )
      .join("\n")}`,
    `## Meetings laatste 3 weken\n${(meetings.data ?? [])
      .map((m) => {
        const c = m.meeting_content as unknown as { summary_md: string | null; follow_ups: string[] } | null;
        return `### ${m.title} (${name(m.projects)}, ${m.created_at.slice(0, 10)})\n${c?.summary_md ?? ""}\nOpvolging: ${(c?.follow_ups ?? []).join("; ")}`;
      })
      .join("\n\n")}`,
    `## E-mails laatste 3 weken\n${(emails.data ?? [])
      .map((e) => `- ${(e.received_at ?? "").slice(0, 10)} [${name(e.projects)}] ${e.from_name}: ${e.subject} – ${e.summary ?? ""}`)
      .join("\n")}`,
    `## Wensen van gebruikers voor de tool\n${(wishes.data ?? []).map((w) => `- ${w.title}${w.body_md ? `: ${w.body_md}` : ""}`).join("\n") || "geen"}`,
    `## Al openstaande voorstellen (niet herhalen)\n${(open.data ?? []).map((s) => `- (${s.kind}) ${s.title}`).join("\n") || "geen"}`,
  ].join("\n\n");
}
