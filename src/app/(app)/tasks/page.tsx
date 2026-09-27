import Link from "next/link";
import { createTask } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskList } from "@/components/TaskList";
import { dict } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Task } from "@/lib/types";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ all?: string; done?: string }> }) {
  const { all, done } = await searchParams;
  const { supabase, user, profile } = await requireUser();
  const t = dict(profile.language);

  let query = supabase
    .from("tasks")
    .select("*, projects(name)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  if (!all) query = query.eq("assignee_id", user.id);
  query = done ? query.eq("status", "done") : query.in("status", ["open", "proposed"]);

  const [{ data: tasks }, { data: projects }, { data: people }] = await Promise.all([
    query,
    supabase.from("projects").select("id, name").eq("status", "active").order("name"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);

  return (
    <>
      <h1>{t.tasks_title}</h1>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <Link className={`button small ${all ? "secondary" : ""}`} href="/tasks">
          {t.tasks_filter_mine}
        </Link>
        <Link className={`button small ${all ? "" : "secondary"}`} href="/tasks?all=1">
          {t.tasks_filter_all}
        </Link>
        <Link className="button small secondary" href={`/tasks?${all ? "all=1&" : ""}${done ? "" : "done=1"}`}>
          {done ? "⏳" : "✓"} {done ? t.nav_tasks : t.task_done}
        </Link>
      </div>
      <section className="card">
        <TaskList tasks={(tasks ?? []) as Task[]} t={t} lang={profile.language} canDelete />
      </section>
      <section className="card">
        <h2>{t.task_new}</h2>
        <form action={createTask} className="stack">
          <input type="text" name="title" required placeholder={t.task_title} />
          <textarea name="description" rows={2} />
          <div className="grid">
            <div>
              <label>{t.task_assignee}</label>
              <select name="assignee_id" defaultValue={user.id}>
                <option value="">—</option>
                {people?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name ?? p.email}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>{t.task_due}</label>
              <input type="date" name="due_date" />
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
