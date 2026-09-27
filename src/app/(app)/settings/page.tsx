import {
  disconnectMicrosoft,
  inviteUser,
  linkFolder,
  syncMailNow,
  unlinkFolder,
  updateProfile,
  updateUserFlags,
} from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { dict, formatDate } from "@/lib/i18n";
import { getAccessToken, listMailFolders, msConfigured, type MailFolder } from "@/lib/microsoft/graph";
import { requireUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ms?: string }> }) {
  const { ms } = await searchParams;
  const { supabase, user, profile } = await requireUser();
  const t = dict(profile.language);

  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("ms_connections")
    .select("account_email")
    .eq("user_id", user.id)
    .maybeSingle();

  let folders: MailFolder[] = [];
  let folderError: string | null = null;
  if (connection && profile.mail_sync_enabled) {
    try {
      const token = await getAccessToken(user.id);
      if (token) folders = await listMailFolders(token);
    } catch (e) {
      folderError = e instanceof Error ? e.message : String(e);
    }
  }

  const [{ data: links }, { data: projects }, { data: users }] = await Promise.all([
    supabase.from("mail_folder_links").select("*, projects(name)").eq("user_id", user.id).order("folder_name"),
    supabase.from("projects").select("id, name").order("name"),
    profile.is_admin ? supabase.from("profiles").select("*").order("full_name") : Promise.resolve({ data: null }),
  ]);

  return (
    <>
      <h1>{t.settings_title}</h1>

      <section className="card">
        <h2>{t.settings_profile}</h2>
        <form action={updateProfile} className="stack">
          <div className="grid">
            <div>
              <label>{t.settings_name}</label>
              <input type="text" name="full_name" defaultValue={profile.full_name ?? ""} />
            </div>
            <div>
              <label>{t.settings_language}</label>
              <select name="language" defaultValue={profile.language}>
                <option value="nl">Nederlands</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" name="mail_sync_enabled" defaultChecked={profile.mail_sync_enabled} />
            {t.settings_mail_sync}
          </label>
          <label className="check">
            <input type="checkbox" name="calendar_sync_enabled" defaultChecked={profile.calendar_sync_enabled} />
            {t.settings_calendar_sync}
          </label>
          <SubmitButton>{t.save}</SubmitButton>
        </form>
      </section>

      {(profile.mail_sync_enabled || profile.calendar_sync_enabled) && (
        <section className="card stack">
          <h2>{t.settings_mail}</h2>
          {ms === "error" && <p className="error">Microsoft ✕</p>}
          {!msConfigured() ? (
            <p className="muted">{t.settings_ms_not_configured}</p>
          ) : connection ? (
            <div className="row between">
              <span>
                ✅ {t.settings_connected_as} <strong>{connection.account_email}</strong>
              </span>
              <form action={disconnectMicrosoft}>
                <SubmitButton className="small ghost">{t.settings_disconnect}</SubmitButton>
              </form>
            </div>
          ) : (
            <a className="button" href="/api/microsoft/connect">
              {t.settings_connect_ms}
            </a>
          )}

          {connection && profile.mail_sync_enabled && (
            <>
              <h3>{t.settings_folders}</h3>
              <p className="small muted">{t.settings_folders_hint}</p>
              {folderError && <p className="error small">{folderError}</p>}
              <ul className="list">
                {(links ?? []).map((l) => (
                  <li key={l.id} className="row between">
                    <div>
                      📂 {l.folder_name} → <strong>{(l.projects as { name: string } | null)?.name}</strong>
                      <div className="small muted">{formatDate(l.last_synced_at, profile.language, true)}</div>
                    </div>
                    <form action={unlinkFolder.bind(null, l.id)}>
                      <button className="small ghost">✕</button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={linkFolder} className="row">
                <select name="folder" style={{ flex: 2, minWidth: 200 }}>
                  {folders
                    .filter((f) => !(links ?? []).some((l) => l.graph_folder_id === f.id))
                    .map((f) => (
                      <option key={f.id} value={`${f.id}|${f.path}`}>
                        {f.path}
                      </option>
                    ))}
                </select>
                <select name="project_id" style={{ flex: 1, minWidth: 150 }}>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <SubmitButton>{t.add}</SubmitButton>
              </form>
              <form action={syncMailNow}>
                <SubmitButton className="secondary" pendingText="⏳">
                  ↻ {t.settings_sync_now}
                </SubmitButton>
              </form>
            </>
          )}
        </section>
      )}

      {profile.is_admin && (
        <section className="card stack">
          <h2>{t.settings_users}</h2>
          <ul className="list">
            {((users ?? []) as Profile[]).map((u) => (
              <li key={u.id}>
                <form action={updateUserFlags.bind(null, u.id)} className="row between">
                  <div>
                    <strong>{u.full_name}</strong> <span className="small muted">{u.email}</span>
                    <div className="small muted">
                      {u.mail_sync_enabled ? "✉️ " : ""}
                      {u.calendar_sync_enabled ? "📅" : ""}
                    </div>
                  </div>
                  <div className="row">
                    <label className="check">
                      <input type="checkbox" name="is_internal" defaultChecked={u.is_internal} />
                      {t.settings_internal}
                    </label>
                    <label className="check">
                      <input type="checkbox" name="is_admin" defaultChecked={u.is_admin} disabled={u.id === user.id} />
                      {t.settings_admin}
                    </label>
                    {u.id === user.id && <input type="hidden" name="is_admin" value="on" />}
                    <SubmitButton className="small ghost">{t.save}</SubmitButton>
                  </div>
                </form>
              </li>
            ))}
          </ul>
          <form action={inviteUser} className="row">
            <input type="text" name="full_name" placeholder={t.settings_name} style={{ flex: 1, minWidth: 140 }} />
            <input type="email" name="email" required placeholder={t.login_email} style={{ flex: 1, minWidth: 180 }} />
            <label className="check">
              <input type="checkbox" name="is_internal" /> {t.settings_internal}
            </label>
            <SubmitButton>{t.settings_invite}</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
