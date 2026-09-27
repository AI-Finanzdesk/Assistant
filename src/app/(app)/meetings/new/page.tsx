import { createMeeting } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dict } from "@/lib/i18n";
import { requireUser } from "@/lib/session";

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const { supabase, user, profile } = await requireUser();
  const t = dict(profile.language);
  const [{ data: projects }, { data: people }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("status", "active").order("name"),
    supabase.from("profiles").select("id, full_name, email").neq("id", user.id).order("full_name"),
  ]);

  return (
    <>
      <h1>{t.meeting_new}</h1>
      <form action={createMeeting} className="card stack">
        <div>
          <label>{t.meeting_topic}</label>
          <textarea name="topic" required placeholder="z. B. Stand Anti-Diebstahlschutz, nächste Schritte Förderantrag …" />
        </div>
        <div>
          <label>{t.meeting_title}</label>
          <input type="text" name="title" />
        </div>
        <div className="grid">
          <div>
            <label>{t.meeting_project}</label>
            <select name="project_id" defaultValue={project ?? ""}>
              <option value="">{t.meeting_no_project}</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>{t.meeting_when}</label>
            <input type="datetime-local" name="scheduled_at" />
          </div>
          <div>
            <label>{t.meeting_language}</label>
            <select name="language" defaultValue={profile.language}>
              <option value="nl">Nederlands</option>
              <option value="de">Deutsch</option>
            </select>
          </div>
        </div>
        <div>
          <label>{t.meeting_participants}</label>
          <div className="row">
            {people?.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" name="participant_ids" value={p.id} /> {p.full_name ?? p.email}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label>{t.meeting_extra_participants}</label>
          <input type="text" name="extra_participants" />
        </div>
        <label className="check">
          <input type="checkbox" name="with_agenda" defaultChecked /> {t.meeting_generate_agenda}
        </label>
        <SubmitButton pendingText="⏳ …">{t.create}</SubmitButton>
      </form>
    </>
  );
}
