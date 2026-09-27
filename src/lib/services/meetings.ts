import "server-only";
import { summarizeMeeting } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTranscription, submitTranscription } from "@/lib/transcription/assemblyai";
import type { Meeting } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/** Start de transcriptie van de geüploade opname. */
export async function startTranscription(meetingId: string) {
  const admin = createAdminClient();
  const { data: meeting } = await admin.from("meetings").select("*").eq("id", meetingId).single<Meeting>();
  if (!meeting?.audio_path) throw new Error("Geen opname gevonden");

  // Tijdelijke link (6 uur) waarmee de transcriptiedienst het bestand ophaalt.
  const { data: signed, error } = await admin.storage.from("recordings").createSignedUrl(meeting.audio_path, 6 * 3600);
  if (error || !signed) throw error ?? new Error("Kon geen downloadlink maken");

  const appUrl = process.env.APP_URL ?? "";
  const webhookUrl = appUrl.startsWith("https://") ? `${appUrl}/api/webhooks/transcription` : undefined;

  const transcriptionId = await submitTranscription({
    audioUrl: signed.signedUrl,
    language: meeting.language,
    webhookUrl,
  });
  await admin
    .from("meetings")
    .update({ status: "transcribing", transcription_id: transcriptionId, error: null })
    .eq("id", meetingId);
}

/** Controleer de transcriptie; is die klaar, dan samenvatten. Idempotent. */
export async function advanceMeeting(meetingId: string) {
  const admin = createAdminClient();
  const { data: meeting } = await admin.from("meetings").select("*").eq("id", meetingId).single<Meeting>();
  if (!meeting?.transcription_id || meeting.status !== "transcribing") return meeting?.status;

  const result = await getTranscription(meeting.transcription_id);
  if (result.status === "error") {
    await admin.from("meetings").update({ status: "error", error: result.error }).eq("id", meetingId);
    return "error";
  }
  if (result.status !== "completed") return "transcribing";

  // Claim: alleen één proces mag samenvatten.
  const { data: claimed } = await admin
    .from("meetings")
    .update({ status: "summarizing" })
    .eq("id", meetingId)
    .eq("status", "transcribing")
    .select("id");
  if (!claimed?.length) return "summarizing";

  await admin
    .from("meeting_content")
    .upsert({ meeting_id: meetingId, transcript: result.text, updated_at: new Date().toISOString() });

  try {
    await summarize(admin, meeting, result.text);
    await admin.from("meetings").update({ status: "done", error: null }).eq("id", meetingId);
    return "done";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.from("meetings").update({ status: "error", error: message }).eq("id", meetingId);
    return "error";
  }
}

/** Opnieuw samenvatten op basis van het opgeslagen transcript. */
export async function resummarize(meetingId: string) {
  const admin = createAdminClient();
  const { data: meeting } = await admin.from("meetings").select("*").eq("id", meetingId).single<Meeting>();
  const { data: content } = await admin.from("meeting_content").select("transcript").eq("meeting_id", meetingId).single();
  if (!meeting || !content?.transcript) throw new Error("Geen transcript");
  await admin.from("meetings").update({ status: "summarizing" }).eq("id", meetingId);
  await admin.from("meeting_sections").delete().eq("meeting_id", meetingId);
  await admin.from("tasks").delete().eq("meeting_id", meetingId).eq("status", "proposed");
  try {
    await summarize(admin, meeting, content.transcript);
    await admin.from("meetings").update({ status: "done", error: null }).eq("id", meetingId);
  } catch (e) {
    await admin
      .from("meetings")
      .update({ status: "error", error: e instanceof Error ? e.message : String(e) })
      .eq("id", meetingId);
  }
}

async function summarize(admin: Admin, meeting: Meeting, transcript: string) {
  const [{ data: participants }, { data: project }, { data: content }, { data: topics }] = await Promise.all([
    admin.from("meeting_participants").select("name, user_id").eq("meeting_id", meeting.id),
    meeting.project_id
      ? admin.from("projects").select("name").eq("id", meeting.project_id).single()
      : Promise.resolve({ data: null }),
    admin.from("meeting_content").select("agenda_md").eq("meeting_id", meeting.id).maybeSingle(),
    admin.from("knowledge_topics").select("id, title"),
  ]);

  const people = participants ?? [];
  const summary = await summarizeMeeting({
    transcript,
    language: meeting.language,
    meetingDate: (meeting.scheduled_at ?? meeting.created_at).slice(0, 10),
    participants: people.map((p) => p.name),
    projectName: project?.name ?? null,
    agenda: content?.agenda_md ?? null,
    knownTopics: (topics ?? []).map((t) => t.title),
  });

  const userIdByName = new Map(
    people.filter((p) => p.user_id).map((p) => [p.name.trim().toLowerCase(), p.user_id as string]),
  );
  const resolve = (name: string | null) => (name ? (userIdByName.get(name.trim().toLowerCase()) ?? null) : null);

  await admin
    .from("meeting_content")
    .upsert({
      meeting_id: meeting.id,
      summary_md: summary.summary_md,
      follow_ups: summary.follow_ups,
      updated_at: new Date().toISOString(),
    });

  if (summary.sections.length) {
    await admin.from("meeting_sections").insert(
      summary.sections.map((s, i) => ({
        meeting_id: meeting.id,
        position: i,
        heading: s.heading,
        body_md: s.body_md,
        kind: s.kind,
        visible_to: s.relevant_for.map(resolve).filter((id): id is string => Boolean(id)),
      })),
    );
  }

  // Actiepunten eerst als voorstel; na bevestiging gaan ze de agenda in.
  if (summary.tasks.length) {
    await admin.from("tasks").insert(
      summary.tasks.map((t) => ({
        project_id: meeting.project_id,
        meeting_id: meeting.id,
        title: t.title,
        description: t.description,
        assignee_id: resolve(t.assignee_name),
        assignee_name: t.assignee_name,
        due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date ?? "") ? t.due_date : null,
        status: "proposed",
        created_by: meeting.created_by,
      })),
    );
  }

  // Kennis: aan bestaand onderwerp toevoegen of nieuw onderwerp aanmaken.
  const topicByTitle = new Map((topics ?? []).map((t) => [t.title.trim().toLowerCase(), t.id as string]));
  for (const k of summary.knowledge) {
    let topicId = topicByTitle.get(k.topic_title.trim().toLowerCase());
    if (!topicId) {
      const { data: created } = await admin
        .from("knowledge_topics")
        .insert({ title: k.topic_title, created_by: meeting.created_by })
        .select("id")
        .single();
      if (!created) continue;
      topicId = created.id as string;
      topicByTitle.set(k.topic_title.trim().toLowerCase(), topicId);
    }
    await admin.from("knowledge_entries").insert({
      topic_id: topicId,
      body: k.insight,
      source_type: "meeting",
      source_id: meeting.id,
      created_by: meeting.created_by,
    });
    await admin.from("meeting_topics").upsert({ meeting_id: meeting.id, topic_id: topicId });
    if (meeting.project_id) {
      await admin.from("project_topics").upsert({ project_id: meeting.project_id, topic_id: topicId });
    }
  }

  if (!meeting.title || meeting.title === meeting.topic) {
    await admin.from("meetings").update({ title: summary.title }).eq("id", meeting.id);
  }
}
