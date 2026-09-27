import Link from "next/link";
import { redirect } from "next/navigation";
import { createTopic } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dict } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { KnowledgeTopic } from "@/lib/types";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { supabase, profile } = await requireUser();
  if (!profile.is_internal) redirect("/");
  const t = dict(profile.language);

  let query = supabase.from("knowledge_topics").select("*, project_topics(projects(name))").order("title");
  if (q) query = query.or(`title.ilike.%${q.replace(/[%,()]/g, "")}%,summary.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const [{ data: topics }, { data: projects }] = await Promise.all([
    query,
    supabase.from("projects").select("id, name").eq("status", "active").order("name"),
  ]);

  type Row = KnowledgeTopic & { project_topics: { projects: { name: string } | null }[] };

  return (
    <>
      <h1>{t.knowledge_title}</h1>
      <p className="muted">{t.knowledge_intro}</p>
      <form className="row" style={{ marginBottom: "1rem" }}>
        <input type="text" name="q" defaultValue={q} placeholder="🔍" style={{ flex: 1 }} />
      </form>
      <div className="grid">
        {((topics ?? []) as Row[]).map((topic) => (
          <Link key={topic.id} href={`/knowledge/${topic.id}`} className="card" style={{ color: "inherit" }}>
            <h2>{topic.title}</h2>
            {topic.summary && <p className="small">{topic.summary}</p>}
            <div className="row small">
              {topic.project_topics.map((pt, i) => pt.projects && <span key={i} className="badge">{pt.projects.name}</span>)}
              {topic.tags.map((tag) => (
                <span key={tag} className="muted">#{tag}</span>
              ))}
            </div>
          </Link>
        ))}
      </div>
      <section className="card">
        <h2>{t.knowledge_new}</h2>
        <form action={createTopic} className="stack">
          <div>
            <label>{t.knowledge_topic_title}</label>
            <input type="text" name="title" required placeholder="z. B. THG-Quote verkaufen" />
          </div>
          <div>
            <label>{t.knowledge_summary}</label>
            <textarea name="summary" />
          </div>
          <div className="grid">
            <div>
              <label>{t.knowledge_tags}</label>
              <input type="text" name="tags" />
            </div>
            <div>
              <label>{t.meeting_project}</label>
              <select name="project_id">
                <option value="">—</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <SubmitButton>{t.create}</SubmitButton>
        </form>
      </section>
    </>
  );
}
