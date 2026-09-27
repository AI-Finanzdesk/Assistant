import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Microsoft 365 / Exchange Online via Microsoft Graph.
 * Elke gebruiker koppelt zijn eigen account (gedelegeerde rechten), zodat de
 * app alleen ziet wat die gebruiker zelf mag zien – en alleen de mappen die hij
 * aan een project koppelt worden ingelezen.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = "offline_access User.Read Mail.Read Calendars.ReadWrite";

function tenant() {
  return process.env.MS_TENANT_ID || "organizations";
}

export function msConfigured() {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function redirectUri() {
  return `${process.env.APP_URL}/api/microsoft/callback`;
}

export function authorizeUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: MS_SCOPES,
    state,
    prompt: "select_account",
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: MS_SCOPES,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Microsoft-token mislukt: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(userId: string, code: string) {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  const me = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json() as Promise<{ mail?: string; userPrincipalName?: string }>);

  const admin = createAdminClient();
  const { error } = await admin.from("ms_connections").upsert({
    user_id: userId,
    account_email: me.mail ?? me.userPrincipalName ?? null,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + (tokens.expires_in - 120) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Geldig access token voor deze gebruiker, of null als er geen koppeling is. */
export async function getAccessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: conn } = await admin.from("ms_connections").select("*").eq("user_id", userId).maybeSingle();
  if (!conn) return null;
  if (new Date(conn.expires_at).getTime() > Date.now()) return conn.access_token;

  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token });
  await admin
    .from("ms_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      expires_at: new Date(Date.now() + (tokens.expires_in - 120) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  return tokens.access_token;
}

async function graph<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ─────────────────────────────────────────────────────────────
// Mailmappen
// ─────────────────────────────────────────────────────────────

export interface MailFolder {
  id: string;
  path: string;
}

interface GraphFolder {
  id: string;
  displayName: string;
  childFolderCount: number;
}

/** Alle mappen (tot 3 niveaus diep) met hun volledige pad, bv. "Inbox / Projekte / Dritz". */
export async function listMailFolders(token: string): Promise<MailFolder[]> {
  const result: MailFolder[] = [];
  async function walk(url: string, prefix: string, depth: number) {
    let next: string | undefined = url;
    while (next) {
      const page: { value: GraphFolder[]; "@odata.nextLink"?: string } = await graph(token, next);
      for (const f of page.value) {
        const path = prefix ? `${prefix} / ${f.displayName}` : f.displayName;
        result.push({ id: f.id, path });
        if (f.childFolderCount > 0 && depth < 3) {
          await walk(`/me/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName,childFolderCount`, path, depth + 1);
        }
      }
      next = page["@odata.nextLink"];
    }
  }
  await walk("/me/mailFolders?$top=100&$select=id,displayName,childFolderCount", "", 1);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export interface GraphMessage {
  id: string;
  subject: string | null;
  from?: { emailAddress: { name: string; address: string } };
  toRecipients?: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  bodyPreview: string;
  body?: { contentType: string; content: string };
  webLink: string;
  "@removed"?: unknown;
}

/**
 * Nieuwe/gewijzigde berichten in een map sinds de vorige synchronisatie
 * (Graph delta query). Eerste keer: berichten van de afgelopen 90 dagen.
 */
export async function fetchFolderDelta(
  token: string,
  folderId: string,
  deltaLink: string | null,
): Promise<{ messages: GraphMessage[]; deltaLink: string | null }> {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  let url: string | undefined =
    deltaLink ??
    `/me/mailFolders/${folderId}/messages/delta?$select=subject,from,toRecipients,receivedDateTime,bodyPreview,body,webLink&$filter=receivedDateTime ge ${since}`;
  const messages: GraphMessage[] = [];
  let newDelta: string | null = null;

  while (url) {
    const page: {
      value: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    } = await graph(token, url, { headers: { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' } });
    messages.push(...page.value.filter((m) => !m["@removed"]));
    url = page["@odata.nextLink"];
    if (page["@odata.deltaLink"]) newDelta = page["@odata.deltaLink"];
  }
  return { messages, deltaLink: newDelta };
}

// ─────────────────────────────────────────────────────────────
// Agenda
// ─────────────────────────────────────────────────────────────

/** Taak als hele-dag-afspraak op de deadline (of morgen), met herinnering. */
export async function createTaskEvent(
  token: string,
  task: { title: string; description: string | null; due_date: string | null; link: string },
): Promise<string> {
  const day = task.due_date ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const end = new Date(`${day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const event = await graph<{ id: string }>(token, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: `✅ ${task.title}`,
      body: {
        contentType: "HTML",
        content: `${escapeHtml(task.description ?? "")}<br><br><a href="${task.link}">${task.link}</a>`,
      },
      start: { dateTime: `${day}T00:00:00`, timeZone: "Europe/Berlin" },
      end: { dateTime: `${end.toISOString().slice(0, 10)}T00:00:00`, timeZone: "Europe/Berlin" },
      isAllDay: true,
      showAs: "free",
      isReminderOn: true,
      reminderMinutesBeforeStart: 60 * 15,
      categories: ["Projekt-Assistent"],
    }),
  });
  return event.id;
}

export async function createMeetingEvent(
  token: string,
  meeting: { title: string; start: string; agenda: string | null; link: string; attendees: string[] },
): Promise<string> {
  const start = new Date(meeting.start);
  const end = new Date(start.getTime() + 60 * 60_000);
  const event = await graph<{ id: string }>(token, "/me/events", {
    method: "POST",
    body: JSON.stringify({
      subject: meeting.title,
      body: {
        contentType: "HTML",
        content: `${escapeHtml(meeting.agenda ?? "").replace(/\n/g, "<br>")}<br><br><a href="${meeting.link}">${meeting.link}</a>`,
      },
      start: { dateTime: start.toISOString(), timeZone: "UTC" },
      end: { dateTime: end.toISOString(), timeZone: "UTC" },
      attendees: meeting.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
      categories: ["Projekt-Assistent"],
    }),
  });
  return event.id;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
