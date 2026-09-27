import Link from "next/link";
import { dict, formatDate } from "@/lib/i18n";
import { requireUser } from "@/lib/session";
import type { Meeting } from "@/lib/types";

const STATUS_CLASS: Record<string, string> = { done: "ok", error: "danger", transcribing: "warn", summarizing: "warn" };

export default async function MeetingsPage() {
  const { supabase, profile } = await requireUser();
  const t = dict(profile.language);
  const { data: meetings } = await supabase
    .from("meetings")
    .select("*, projects(name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <div className="row between">
        <h1>{t.meetings_title}</h1>
        <Link className="button" href="/meetings/new">
          🎙️ {t.meeting_new}
        </Link>
      </div>
      <section className="card">
        <ul className="list">
          {((meetings ?? []) as (Meeting & { projects: { name: string } | null })[]).map((m) => (
            <li key={m.id} className="row between">
              <div>
                <Link href={`/meetings/${m.id}`}>{m.title}</Link>
                <div className="small muted">
                  {formatDate(m.scheduled_at ?? m.created_at, profile.language, Boolean(m.scheduled_at))}
                  {m.projects?.name && ` · ${m.projects.name}`}
                </div>
              </div>
              <span className={`badge ${STATUS_CLASS[m.status] ?? ""}`}>{t[`status_${m.status}`]}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
