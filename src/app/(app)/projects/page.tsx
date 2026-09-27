import Link from "next/link";
import { createProject } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dict } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Project } from "@/lib/types";

export default async function ProjectsPage() {
  const { supabase, profile } = await requireUser();
  const t = dict(profile.language);
  const { data: projects } = await supabase.from("projects").select("*").order("status").order("name");

  return (
    <>
      <h1>{t.projects_title}</h1>
      <div className="grid">
        {(projects as Project[] | null)?.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ color: "inherit" }}>
            <div className="row between">
              <h2>{p.name}</h2>
              {p.status !== "active" && <span className="badge">{p.status}</span>}
            </div>
            <p className="muted small">{p.description}</p>
          </Link>
        ))}
      </div>
      {profile.is_internal && (
        <section className="card">
          <h2>{t.projects_new}</h2>
          <form action={createProject} className="stack">
            <div>
              <label>{t.project_name}</label>
              <input type="text" name="name" required />
            </div>
            <div>
              <label>{t.project_description}</label>
              <textarea name="description" />
            </div>
            <SubmitButton>{t.create}</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
