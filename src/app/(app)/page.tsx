import Link from "next/link";
import { runAssistantNow, setSuggestionStatus, submitWish } from "@/app/actions";
import { Markdown } from "@/components/Markdown";
import { SubmitButton } from "@/components/SubmitButton";
import { TaskList } from "@/components/TaskList";
import { dict, formatDate } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Meeting, Suggestion, Task } from "@/lib/types";

const KIND_ICON: Record<Suggestion["kind"], string> = {
  followup: "📨",
  task: "✅",
  insight: "💡",
  improvement: "🛠️",
  wish: "🙋",
};

export default async function HomePage() {
  const { supabase, user, profile } = await requireUser();
  const t = dict(profile.language);

  const [{ data: tasks }, { data: meetings }, { data: suggestions }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("assignee_id", user.id)
      .in("status", ["open", "proposed"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from("meetings")
      .select("*")
      .gte("scheduled_at", new Date(Date.now() - 3600_000).toISOString())
      .order("scheduled_at")
      .limit(5),
    supabase
      .from("suggestions")
      .select("*")
      .in("status", ["new"])
      .neq("kind", "wish")
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  return (
    <>
      <div className="row between">
        <h1>
          {t.nav_home} · {profile.full_name ?? ""}
        </h1>
        <Link className="button" href="/meetings/new">
          🎙️ {t.home_new_meeting}
        </Link>
      </div>

      <div className="grid">
        <section className="card">
          <h2>{t.home_my_tasks}</h2>
          <TaskList tasks={(tasks ?? []) as Task[]} t={t} lang={profile.language} />
        </section>

        <section className="card">
          <h2>{t.home_upcoming}</h2>
          {meetings?.length ? (
            <ul className="list">
              {(meetings as Meeting[]).map((m) => (
                <li key={m.id}>
                  <Link href={`/meetings/${m.id}`}>{m.title}</Link>
                  <div className="small muted">{formatDate(m.scheduled_at, profile.language, true)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t.home_no_meetings}</p>
          )}
        </section>
      </div>

      {profile.is_internal && (
        <section className="card">
          <div className="row between">
            <h2>{t.home_suggestions}</h2>
            <form action={runAssistantNow}>
              <SubmitButton className="small secondary">{t.home_run_assistant}</SubmitButton>
            </form>
          </div>
          {suggestions?.length ? (
            <ul className="list">
              {(suggestions as Suggestion[]).map((s) => (
                <li key={s.id}>
                  <details>
                    <summary>
                      {KIND_ICON[s.kind]} {s.title}
                    </summary>
                    <Markdown text={s.body_md} />
                  </details>
                  <div className="row" style={{ marginTop: ".4rem" }}>
                    <form action={setSuggestionStatus.bind(null, s.id, "accepted")}>
                      <button className="small">{t.accept}</button>
                    </form>
                    <form action={setSuggestionStatus.bind(null, s.id, "dismissed")}>
                      <button className="small ghost">{t.dismiss}</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t.home_no_suggestions}</p>
          )}
        </section>
      )}

      <section className="card">
        <h2>{t.home_wish}</h2>
        <form action={submitWish} className="row">
          <input type="text" name="wish" placeholder={t.home_wish_placeholder} style={{ flex: 1, minWidth: 200 }} />
          <SubmitButton>{t.home_wish_send}</SubmitButton>
        </form>
      </section>
    </>
  );
}
