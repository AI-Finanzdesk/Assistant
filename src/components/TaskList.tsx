import Link from "next/link";
import { deleteTask, setTaskStatus } from "@/app/actions";
import { formatDate, type Dict } from "@/lib/i18n";
import type { Lang, Task } from "@/lib/types";

type TaskRow = Task & { projects?: { name: string } | null };

export function TaskList({
  tasks,
  t,
  lang,
  showProject = true,
  canDelete = false,
}: {
  tasks: TaskRow[];
  t: Dict;
  lang: Lang;
  showProject?: boolean;
  canDelete?: boolean;
}) {
  if (!tasks.length) return <p className="muted">{t.home_no_tasks}</p>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul className="list">
      {tasks.map((task) => {
        const overdue = task.status !== "done" && task.due_date && task.due_date < today;
        return (
          <li key={task.id} id={`task-${task.id}`}>
            <div className="row between">
              <div style={{ minWidth: 0 }}>
                <div style={{ textDecoration: task.status === "done" ? "line-through" : undefined }}>
                  {task.status === "proposed" && <span className="badge warn">{t.task_proposed}</span>} {task.title}
                </div>
                <div className="small muted">
                  {task.assignee_name ?? t.none}
                  {task.due_date && (
                    <span className={overdue ? "error" : undefined}> · {formatDate(task.due_date, lang)}</span>
                  )}
                  {showProject && task.projects?.name && (
                    <>
                      {" · "}
                      <Link href={`/projects/${task.project_id}`}>{task.projects.name}</Link>
                    </>
                  )}
                  {task.meeting_id && (
                    <>
                      {" · "}
                      <Link href={`/meetings/${task.meeting_id}`}>🎙️</Link>
                    </>
                  )}
                  {task.calendar_event_id && " · 📅"}
                </div>
              </div>
              <div className="row">
                {task.status === "proposed" && (
                  <form action={setTaskStatus.bind(null, task.id, "open")}>
                    <button className="small secondary">{t.task_confirm}</button>
                  </form>
                )}
                {task.status === "open" && (
                  <form action={setTaskStatus.bind(null, task.id, "done")}>
                    <button className="small secondary">✓ {t.task_done}</button>
                  </form>
                )}
                {task.status === "done" && (
                  <form action={setTaskStatus.bind(null, task.id, "open")}>
                    <button className="small ghost">{t.task_reopen}</button>
                  </form>
                )}
                {canDelete && (
                  <form action={deleteTask.bind(null, task.id)}>
                    <button className="small ghost" aria-label={t.delete}>✕</button>
                  </form>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
