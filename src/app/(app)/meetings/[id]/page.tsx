import Link from "next/link";
import { notFound } from "next/navigation";
import {
  confirmMeetingTasks,
  generateAgendaAction,
  meetingToCalendar,
  saveAgenda,
  setConsent,
  setSectionVisibility,
} from "@/app/actions";
import { ActionButton } from "@/components/ActionButton";
import { Markdown } from "@/components/Markdown";
import { Recorder } from "@/components/Recorder";
import { StatusPoller } from "@/components/StatusPoller";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskList } from "@/components/TaskList";
import { dict, formatDate } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Meeting, Task } from "@/lib/types";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const t = dict(profile.language);

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*, projects(id, name)")
    .eq("id", id)
    .maybeSingle<Meeting & { projects: { id: string; name: string } | null }>();
  if (!meeting) notFound();

  const [{ data: full }, { data: canEdit }, content, sections, participants, tasks, topics, people] = await Promise.all([
    supabase.rpc("can_view_meeting_full", { mid: id }),
    supabase.rpc("can_edit_meeting", { mid: id }),
    supabase.from("meeting_content").select("*").eq("meeting_id", id).maybeSingle(),
    supabase.from("meeting_sections").select("*").eq("meeting_id", id).order("position"),
    supabase.from("meeting_participants").select("name, user_id").eq("meeting_id", id),
    supabase.from("tasks").select("*").eq("meeting_id", id).order("created_at"),
    supabase.from("meeting_topics").select("knowledge_topics(id, title)").eq("meeting_id", id),
    supabase.from("profiles").select("id, full_name, email"),
  ]);

  const c = content.data;
  const busy = meeting.status === "transcribing" || meeting.status === "summarizing";
  const proposed = ((tasks.data ?? []) as Task[]).filter((x) => x.status === "proposed");
  const nameById = new Map((people.data ?? []).map((p) => [p.id, p.full_name ?? p.email]));
  const shareable = (participants.data ?? []).filter((p) => p.user_id);
  const linkedTopics = (topics.data ?? [])
    .map((r) => r.knowledge_topics as unknown as { id: string; title: string } | null)
    .filter(Boolean) as { id: string; title: string }[];
  const statusClass = meeting.status === "done" ? "ok" : meeting.status === "error" ? "danger" : busy ? "warn" : "";

  return (
    <>
      <StatusPoller meetingId={id} active={busy} />
      <div className="row between">
        <h1>{meeting.title}</h1>
        <span className={`badge ${statusClass}`}>{t[`status_${meeting.status}`]}</span>
      </div>
      <p className="muted small">
        {formatDate(meeting.scheduled_at ?? meeting.created_at, profile.language, Boolean(meeting.scheduled_at))}
        {meeting.projects && (
          <>
            {" · "}
            <Link href={`/projects/${meeting.projects.id}`}>{meeting.projects.name}</Link>
          </>
        )}
        {" · "}
        {(participants.data ?? []).map((p) => p.name).join(", ")}
      </p>
      {meeting.error && <p className="error small">{meeting.error}</p>}
      {!full && <p className="card muted">{t.meeting_only_shared}</p>}

      {full && (
        <section className="card">
          <div className="row between">
            <h2>{t.meeting_agenda}</h2>
            {canEdit && (
              <div className="row">
                <form action={generateAgendaAction.bind(null, id)}>
                  <SubmitButton className="small secondary" pendingText="⏳">
                    ✨ {t.meeting_generate_agenda}
                  </SubmitButton>
                </form>
                {meeting.scheduled_at && profile.calendar_sync_enabled && (
                  meeting.calendar_event_id ? (
                    <span className="badge ok">📅 {t.meeting_in_calendar}</span>
                  ) : (
                    <form action={meetingToCalendar.bind(null, id)}>
                      <SubmitButton className="small secondary">📅 {t.meeting_to_calendar}</SubmitButton>
                    </form>
                  )
                )}
              </div>
            )}
          </div>
          <Markdown text={c?.agenda_md} />
          {linkedTopics.length > 0 && (
            <p className="small">
              📚{" "}
              {linkedTopics.map((tp, i) => (
                <span key={tp.id}>
                  {i > 0 && ", "}
                  <Link href={`/knowledge/${tp.id}`}>{tp.title}</Link>
                </span>
              ))}
            </p>
          )}
          {canEdit && (
            <details>
              <summary className="small">✏️</summary>
              <form action={saveAgenda.bind(null, id)} className="stack">
                <textarea name="agenda_md" defaultValue={c?.agenda_md ?? ""} rows={10} />
                <SubmitButton className="small">{t.save}</SubmitButton>
              </form>
            </details>
          )}
        </section>
      )}

      {canEdit && (meeting.status === "planned" || meeting.status === "uploaded" || meeting.status === "error") && (
        <section className="card stack">
          <h2>🎙️ {t.meeting_record}</h2>
          <form action={setConsent.bind(null, id, !meeting.consent_confirmed)}>
            <label className="check">
              <input type="checkbox" checked={meeting.consent_confirmed} readOnly />
              <SubmitButton className="small ghost">{t.meeting_consent}</SubmitButton>
            </label>
          </form>
          <Recorder
            meetingId={id}
            consent={meeting.consent_confirmed}
            labels={{
              record: t.meeting_record,
              stop: t.meeting_stop,
              upload: t.meeting_upload,
              uploading: t.meeting_uploading,
              consentNeeded: t.meeting_consent_needed,
            }}
          />
          {meeting.audio_path && meeting.status !== "planned" && (
            <ActionButton url={`/api/meetings/${id}/process`} className="secondary">
              {t.meeting_process}
            </ActionButton>
          )}
        </section>
      )}

      {busy && canEdit && (
        <p>
          <ActionButton url={`/api/meetings/${id}/advance`} className="small secondary">
            {t.meeting_check_status}
          </ActionButton>
        </p>
      )}

      {full && c?.summary_md && (
        <section className="card">
          <h2>{t.meeting_summary}</h2>
          <Markdown text={c.summary_md} />
        </section>
      )}

      {(tasks.data?.length ?? 0) > 0 && (
        <section className="card">
          <div className="row between">
            <h2>{t.meeting_tasks}</h2>
            {canEdit && proposed.length > 0 && (
              <form action={confirmMeetingTasks.bind(null, id)}>
                <SubmitButton className="small">📅 {t.meeting_confirm_tasks}</SubmitButton>
              </form>
            )}
          </div>
          <TaskList tasks={(tasks.data ?? []) as Task[]} t={t} lang={profile.language} showProject={false} canDelete={Boolean(canEdit)} />
        </section>
      )}

      {(sections.data?.length ?? 0) > 0 && (
        <section className="card">
          <h2>{t.meeting_sections}</h2>
          {(sections.data ?? []).map((s) => (
            <div key={s.id} className="card">
              <h3>
                {s.kind === "decision" ? "✅ " : s.kind === "info" ? "ℹ️ " : ""}
                {s.heading}
              </h3>
              <Markdown text={s.body_md} />
              {canEdit && shareable.length > 0 && (
                <form action={setSectionVisibility.bind(null, id, s.id)} className="row small" style={{ marginTop: ".5rem" }}>
                  <span className="muted">{t.meeting_section_visible_to}:</span>
                  {shareable.map((p) => (
                    <label key={p.user_id} className="check">
                      <input
                        type="checkbox"
                        name="visible_to"
                        value={p.user_id!}
                        defaultChecked={(s.visible_to as string[]).includes(p.user_id!)}
                      />
                      {nameById.get(p.user_id!) ?? p.name}
                    </label>
                  ))}
                  <SubmitButton className="small ghost">{t.save}</SubmitButton>
                </form>
              )}
            </div>
          ))}
        </section>
      )}

      {full && (c?.follow_ups?.length ?? 0) > 0 && (
        <section className="card">
          <h2>{t.meeting_follow_ups}</h2>
          <ul>
            {c!.follow_ups.map((f: string, i: number) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      {full && c?.transcript && (
        <section className="card">
          <details>
            <summary>{t.meeting_transcript}</summary>
            <div className="transcript">{c.transcript}</div>
          </details>
          {canEdit && (
            <p>
              <ActionButton url={`/api/meetings/${id}/advance?resummarize=1`} className="small ghost" pendingText="⏳">
                ↻ {t.meeting_summary}
              </ActionButton>
            </p>
          )}
        </section>
      )}
    </>
  );
}
