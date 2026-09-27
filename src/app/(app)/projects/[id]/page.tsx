import Link from "next/link";
import { notFound } from "next/navigation";
import { addMember, linkTopic, removeMember, unlinkTopic, updateMember } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskList } from "@/components/TaskList";
import { dict, formatDate } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Meeting, Profile, Project, ProjectMember, Task } from "@/lib/types";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user, profile } = await requireUser();
  const t = dict(profile.language);

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle<Project>();
  if (!project) notFound();

  const [members, people, topics, allTopics, meetings, tasks, emails] = await Promise.all([
    supabase.from("project_members").select("*").eq("project_id", id),
    supabase.from("profiles").select("id, full_name, email, is_internal").order("full_name"),
    supabase.from("project_topics").select("knowledge_topics(id, title, summary)").eq("project_id", id),
    supabase.from("knowledge_topics").select("id, title").order("title"),
    supabase.from("meetings").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(20),
    supabase
      .from("tasks")
      .select("*")
      .eq("project_id", id)
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("emails")
      .select("id, subject, from_name, received_at, summary, web_link")
      .eq("project_id", id)
      .order("received_at", { ascending: false })
      .limit(25),
  ]);

  const memberList = (members.data ?? []) as ProjectMember[];
  const peopleById = new Map(((people.data ?? []) as Profile[]).map((p) => [p.id, p]));
  const myRole = memberList.find((m) => m.user_id === user.id)?.role;
  const canManage = profile.is_admin || profile.is_internal || myRole === "owner";
  const nonMembers = ((people.data ?? []) as Profile[]).filter((p) => !memberList.some((m) => m.user_id === p.id));
  const linkedTopics = (topics.data ?? [])
    .map((r) => r.knowledge_topics as unknown as { id: string; title: string; summary: string | null } | null)
    .filter(Boolean) as { id: string; title: string; summary: string | null }[];

  return (
    <>
      <div className="row between">
        <h1>{project.name}</h1>
        <Link className="button" href={`/meetings/new?project=${id}`}>
          🎙️ {t.meeting_new}
        </Link>
      </div>
      {project.description && <p className="muted">{project.description}</p>}

      <div className="grid">
        <section className="card">
          <h2>{t.project_tasks}</h2>
          <TaskList tasks={(tasks.data ?? []) as Task[]} t={t} lang={profile.language} showProject={false} />
        </section>

        <section className="card">
          <h2>{t.project_meetings}</h2>
          <ul className="list">
            {((meetings.data ?? []) as Meeting[]).map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.id}`}>{m.title}</Link>
                <div className="small muted">{formatDate(m.scheduled_at ?? m.created_at, profile.language)}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {profile.is_internal || myRole !== "guest" ? (
        <section className="card">
          <h2>{t.project_topics}</h2>
          <ul className="list">
            {linkedTopics.map((topic) => (
              <li key={topic.id} className="row between">
                <div>
                  <Link href={`/knowledge/${topic.id}`}>{topic.title}</Link>
                  {topic.summary && <div className="small muted">{topic.summary}</div>}
                </div>
                <form action={unlinkTopic.bind(null, id, topic.id)}>
                  <button className="small ghost">✕</button>
                </form>
              </li>
            ))}
          </ul>
          <form action={linkTopic.bind(null, id)} className="row" style={{ marginTop: ".6rem" }}>
            <select name="topic_id" style={{ flex: 1, minWidth: 180 }}>
              {(allTopics.data ?? [])
                .filter((tp) => !linkedTopics.some((l) => l.id === tp.id))
                .map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.title}
                  </option>
                ))}
            </select>
            <SubmitButton className="secondary">{t.project_link_topic}</SubmitButton>
          </form>
        </section>
      ) : null}

      <section className="card">
        <h2>{t.project_emails}</h2>
        {emails.data?.length ? (
          <ul className="list">
            {emails.data.map((e) => (
              <li key={e.id}>
                <div className="row between">
                  <strong>{e.subject}</strong>
                  <span className="small muted">{formatDate(e.received_at, profile.language)}</span>
                </div>
                <div className="small muted">{e.from_name}</div>
                {e.summary && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{e.summary}</div>}
                {e.web_link && (
                  <a className="small" href={e.web_link} target="_blank" rel="noreferrer">
                    Outlook ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t.project_no_emails}</p>
        )}
      </section>

      <section className="card">
        <h2>{t.project_members}</h2>
        <ul className="list">
          {memberList.map((m) => {
            const person = peopleById.get(m.user_id);
            return (
              <li key={m.user_id}>
                <form action={updateMember.bind(null, id, m.user_id)} className="stack">
                  <div className="row between">
                    <strong>{person?.full_name ?? person?.email}</strong>
                    <select name="role" defaultValue={m.role} disabled={!canManage} style={{ width: "auto" }}>
                      <option value="owner">{t.role_owner}</option>
                      <option value="member">{t.role_member}</option>
                      <option value="guest">{t.role_guest}</option>
                    </select>
                  </div>
                  <div className="row">
                    <label className="check">
                      <input type="checkbox" name="see_all_meetings" defaultChecked={m.see_all_meetings} disabled={!canManage} />
                      {t.member_see_all_meetings}
                    </label>
                    <label className="check">
                      <input type="checkbox" name="see_emails" defaultChecked={m.see_emails} disabled={!canManage} />
                      {t.member_see_emails}
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="calendar_tasks"
                        defaultChecked={m.calendar_tasks}
                        disabled={!canManage}
                      />
                      {t.member_calendar_tasks}
                    </label>
                  </div>
                  {canManage && (
                    <div className="row">
                      <SubmitButton className="small secondary">{t.save}</SubmitButton>
                      <button className="small danger" formAction={removeMember.bind(null, id, m.user_id)}>
                        {t.delete}
                      </button>
                    </div>
                  )}
                </form>
              </li>
            );
          })}
        </ul>
        {canManage && (
          <>
            <form action={addMember.bind(null, id)} className="row" style={{ marginTop: ".8rem" }}>
              <select name="user_id" style={{ flex: 1, minWidth: 160 }}>
                {nonMembers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.email}
                  </option>
                ))}
              </select>
              <select name="role" defaultValue="member" style={{ width: "auto" }}>
                <option value="owner">{t.role_owner}</option>
                <option value="member">{t.role_member}</option>
                <option value="guest">{t.role_guest}</option>
              </select>
              <SubmitButton>{t.member_add}</SubmitButton>
            </form>
            <p className="small muted">{t.member_invite_hint}</p>
          </>
        )}
      </section>
    </>
  );
}
