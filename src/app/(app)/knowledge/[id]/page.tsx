import Link from "next/link";
import { notFound } from "next/navigation";
import { addEntry, updateTopic } from "@/app/actions";
import { Markdown } from "@/components/Markdown";
import { SubmitButton } from "@/components/SubmitButton";
import { dict, formatDate } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { KnowledgeTopic } from "@/lib/types";

const SOURCE_ICON: Record<string, string> = { manual: "✍️", meeting: "🎙️", email: "✉️" };

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await requireUser();
  const t = dict(profile.language);

  const { data: topic } = await supabase.from("knowledge_topics").select("*").eq("id", id).maybeSingle<KnowledgeTopic>();
  if (!topic) notFound();

  const [entries, projects, emails] = await Promise.all([
    supabase.from("knowledge_entries").select("*").eq("topic_id", id).order("created_at", { ascending: false }),
    supabase.from("project_topics").select("projects(id, name)").eq("topic_id", id),
    supabase
      .from("email_topics")
      .select("emails(id, subject, from_name, received_at, summary, web_link)")
      .eq("topic_id", id)
      .limit(30),
  ]);

  const linked = (projects.data ?? [])
    .map((r) => r.projects as unknown as { id: string; name: string } | null)
    .filter(Boolean) as { id: string; name: string }[];
  const mails = (emails.data ?? [])
    .map(
      (r) =>
        r.emails as unknown as {
          id: string;
          subject: string;
          from_name: string;
          received_at: string;
          summary: string | null;
          web_link: string | null;
        } | null,
    )
    .filter(Boolean) as { id: string; subject: string; from_name: string; received_at: string; summary: string | null; web_link: string | null }[];

  return (
    <>
      <p className="small">
        <Link href="/knowledge">← {t.knowledge_title}</Link>
      </p>
      <h1>{topic.title}</h1>
      {linked.length > 0 && (
        <p className="small">
          {t.knowledge_linked_projects}:{" "}
          {linked.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/projects/${p.id}`}>{p.name}</Link>
            </span>
          ))}
        </p>
      )}

      <section className="card">
        {topic.summary && <p><strong>{topic.summary}</strong></p>}
        <Markdown text={topic.body} />
        <details>
          <summary className="small">✏️</summary>
          <form action={updateTopic.bind(null, id)} className="stack">
            <div>
              <label>{t.knowledge_topic_title}</label>
              <input type="text" name="title" defaultValue={topic.title} />
            </div>
            <div>
              <label>{t.knowledge_summary}</label>
              <textarea name="summary" defaultValue={topic.summary ?? ""} />
            </div>
            <div>
              <label>{t.knowledge_body}</label>
              <textarea name="body" defaultValue={topic.body ?? ""} rows={12} />
            </div>
            <div>
              <label>{t.knowledge_tags}</label>
              <input type="text" name="tags" defaultValue={topic.tags.join(", ")} />
            </div>
            <SubmitButton>{t.save}</SubmitButton>
          </form>
        </details>
      </section>

      <section className="card">
        <h2>{t.knowledge_entries}</h2>
        <form action={addEntry.bind(null, id)} className="stack" style={{ marginBottom: "1rem" }}>
          <textarea name="body" placeholder={t.knowledge_add_entry} />
          <SubmitButton className="small">{t.add}</SubmitButton>
        </form>
        <ul className="list">
          {(entries.data ?? []).map((e) => (
            <li key={e.id}>
              <div style={{ whiteSpace: "pre-wrap" }}>{e.body}</div>
              <div className="small muted">
                {SOURCE_ICON[e.source_type]} {formatDate(e.created_at, profile.language)}
                {e.source_type === "meeting" && e.source_id && (
                  <>
                    {" · "}
                    <Link href={`/meetings/${e.source_id}`}>meeting</Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {mails.length > 0 && (
        <section className="card">
          <h2>✉️ {t.project_emails}</h2>
          <ul className="list">
            {mails.map((m) => (
              <li key={m.id}>
                <strong>{m.subject}</strong>
                <div className="small muted">
                  {m.from_name} · {formatDate(m.received_at, profile.language)}
                </div>
                {m.summary && <div className="small">{m.summary}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
