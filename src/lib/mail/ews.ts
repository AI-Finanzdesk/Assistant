import "server-only";
import { XMLParser } from "fast-xml-parser";
import httpntlm from "httpntlm";
import {
  FIRST_SYNC_DAYS,
  escapeHtml,
  nextDay,
  taskDay,
  type MailFolder,
  type MailMessage,
  type MailProvider,
  type MeetingEventInput,
  type TaskEventInput,
} from "./types";

/**
 * Exchange on-premise via Exchange Web Services (SOAP).
 * Werkt met Exchange 2010 SP2 en nieuwer (2013/2016/2019/SE), NTLM- of Basic-authenticatie.
 * Voorwaarde: de EWS-URL (meestal https://mail.<domein>/EWS/Exchange.asmx) is vanaf
 * internet bereikbaar met een geldig TLS-certificaat – net als Outlook Web Access.
 */

export interface EwsConfig {
  url: string;
  username: string;
  password: string;
  authType: "ntlm" | "basic";
  accountEmail: string;
}

const TIME_ZONE = "W. Europe Standard Time";
const NS =
  'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" ' +
  'xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// fast-xml-parser geeft bij één element een object, bij meerdere een array.
type X = Record<string, unknown>;
function arr<T = X>(v: unknown): T[] {
  if (v === undefined || v === null || v === "") return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}
function obj(v: unknown): X {
  return v && typeof v === "object" ? (v as X) : {};
}
function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  const t = obj(v)["#text"];
  return typeof t === "string" ? t : null;
}
function xml(s: string) {
  return escapeHtml(s).replace(/'/g, "&apos;");
}

export class EwsError extends Error {}

async function post(cfg: EwsConfig, body: string): Promise<{ status: number; body: string }> {
  const headers = { "Content-Type": "text/xml; charset=utf-8" };
  if (cfg.authType === "basic") {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        ...headers,
        Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`,
      },
      body,
      cache: "no-store",
    });
    return { status: res.status, body: await res.text() };
  }

  // NTLM: "DOMEIN\gebruiker" of "gebruiker@domein.de"
  const [domain, username] = cfg.username.includes("\\") ? cfg.username.split("\\", 2) : ["", cfg.username];
  return new Promise((resolve, reject) => {
    httpntlm.post(
      { url: cfg.url, username, password: cfg.password, domain, workstation: "", headers, body, timeout: 60_000 },
      (err, res) => {
        if (err) reject(err);
        else resolve({ status: res.statusCode, body: String(res.body ?? "") });
      },
    );
  });
}

/** Voert een EWS-operatie uit en geeft de Body van het SOAP-antwoord terug. */
async function call(cfg: EwsConfig, operation: string, soapHeader = ""): Promise<X> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope ${NS}>
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2010_SP2"/>
    ${soapHeader}
  </soap:Header>
  <soap:Body>${operation}</soap:Body>
</soap:Envelope>`;

  const res = await post(cfg, envelope);
  if (res.status === 401) throw new EwsError("Exchange: gebruikersnaam of wachtwoord onjuist (401)");
  if (res.status === 404) throw new EwsError("Exchange: EWS-adres niet gevonden (404) – controleer de URL");

  let parsed: X;
  try {
    parsed = parser.parse(res.body) as X;
  } catch {
    throw new EwsError(`Exchange gaf geen geldig antwoord (HTTP ${res.status})`);
  }
  const body = obj(obj(parsed.Envelope).Body);
  const fault = obj(body.Fault);
  if (Object.keys(fault).length) throw new EwsError(`Exchange-fout: ${text(fault.faultstring) ?? "onbekend"}`);
  if (res.status >= 400) throw new EwsError(`Exchange: HTTP ${res.status}`);
  return body;
}

/** Alle ResponseMessages van een antwoord; gooit een fout bij ResponseClass="Error". */
function messages(body: X, response: string, message: string): X[] {
  const list = arr<X>(obj(obj(body[response]).ResponseMessages)[message]);
  for (const m of list) {
    if (m["@_ResponseClass"] === "Error") {
      throw new EwsError(`Exchange: ${text(m.MessageText) ?? text(m.ResponseCode) ?? "fout"}`);
    }
  }
  return list;
}

// ─────────────────────────────────────────────────────────────
// Mappen
// ─────────────────────────────────────────────────────────────

async function listFolders(cfg: EwsConfig): Promise<MailFolder[]> {
  const body = await call(
    cfg,
    `<m:FindFolder Traversal="Deep">
      <m:FolderShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="folder:DisplayName"/>
          <t:FieldURI FieldURI="folder:ParentFolderId"/>
          <t:FieldURI FieldURI="folder:FolderClass"/>
        </t:AdditionalProperties>
      </m:FolderShape>
      <m:IndexedPageFolderView MaxEntriesReturned="2000" Offset="0" BasePoint="Beginning"/>
      <m:ParentFolderIds><t:DistinguishedFolderId Id="msgfolderroot"/></m:ParentFolderIds>
    </m:FindFolder>`,
  );
  const [msg] = messages(body, "FindFolderResponse", "FindFolderResponseMessage");
  const folders = arr(obj(obj(msg?.RootFolder).Folders).Folder).map((f) => ({
    id: String(obj(f.FolderId)["@_Id"]),
    parent: String(obj(f.ParentFolderId)["@_Id"] ?? ""),
    name: text(f.DisplayName) ?? "",
    cls: text(f.FolderClass),
  }));

  const byId = new Map(folders.map((f) => [f.id, f]));
  const pathOf = (id: string, depth = 0): string => {
    const f = byId.get(id);
    if (!f || depth > 10) return "";
    const parent = pathOf(f.parent, depth + 1);
    return parent ? `${parent} / ${f.name}` : f.name;
  };
  return folders
    .filter((f) => !f.cls || f.cls.startsWith("IPF.Note"))
    .map((f) => ({ id: f.id, path: pathOf(f.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// ─────────────────────────────────────────────────────────────
// Berichten synchroniseren
// ─────────────────────────────────────────────────────────────

async function syncFolder(
  cfg: EwsConfig,
  folderId: string,
  syncState: string | null,
): Promise<{ messages: MailMessage[]; syncState: string | null }> {
  const since = Date.now() - FIRST_SYNC_DAYS * 86400_000;
  const newIds: string[] = [];
  let state = syncState;

  // SyncFolderItems levert per ronde max. 200 wijzigingen; herhalen tot alles binnen is.
  for (let round = 0; round < 25; round++) {
    const body = await call(
      cfg,
      `<m:SyncFolderItems>
        <m:ItemShape>
          <t:BaseShape>IdOnly</t:BaseShape>
          <t:AdditionalProperties><t:FieldURI FieldURI="item:DateTimeReceived"/></t:AdditionalProperties>
        </m:ItemShape>
        <m:SyncFolderId><t:FolderId Id="${xml(folderId)}"/></m:SyncFolderId>
        ${state ? `<m:SyncState>${xml(state)}</m:SyncState>` : ""}
        <m:MaxChangesReturned>200</m:MaxChangesReturned>
      </m:SyncFolderItems>`,
    );
    const [msg] = messages(body, "SyncFolderItemsResponse", "SyncFolderItemsResponseMessage");
    state = text(msg?.SyncState) ?? state;

    for (const create of arr(obj(msg?.Changes).Create)) {
      // Het kind-element kan Message, MeetingRequest, … zijn.
      for (const item of Object.values(create).map(obj)) {
        const id = obj(item.ItemId)["@_Id"];
        const received = text(item.DateTimeReceived);
        if (typeof id !== "string") continue;
        if (!syncState && received && Date.parse(received) < since) continue;
        newIds.push(id);
      }
    }
    if (text(msg?.IncludesLastItemInRange) !== "false") break;
  }

  const result: MailMessage[] = [];
  for (let i = 0; i < newIds.length; i += 25) {
    result.push(...(await getItems(cfg, newIds.slice(i, i + 25))));
  }
  return { messages: result, syncState: state };
}

async function getItems(cfg: EwsConfig, ids: string[]): Promise<MailMessage[]> {
  const body = await call(
    cfg,
    `<m:GetItem>
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:BodyType>Text</t:BodyType>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject"/>
          <t:FieldURI FieldURI="item:Body"/>
          <t:FieldURI FieldURI="item:DateTimeReceived"/>
          <t:FieldURI FieldURI="item:WebClientReadFormQueryString"/>
          <t:FieldURI FieldURI="message:From"/>
          <t:FieldURI FieldURI="message:ToRecipients"/>
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:ItemIds>${ids.map((id) => `<t:ItemId Id="${xml(id)}"/>`).join("")}</m:ItemIds>
    </m:GetItem>`,
  );

  const list = arr<X>(obj(obj(body.GetItemResponse).ResponseMessages).GetItemResponseMessage);
  const out: MailMessage[] = [];
  for (const m of list) {
    if (m["@_ResponseClass"] === "Error") continue; // bv. intussen verwijderd
    for (const item of Object.values(obj(m.Items)).flatMap((v) => arr(v))) {
      const bodyText = text(item.Body);
      const from = obj(obj(item.From).Mailbox);
      out.push({
        id: String(obj(item.ItemId)["@_Id"]),
        subject: text(item.Subject),
        fromName: text(from.Name),
        fromAddress: text(from.EmailAddress),
        to: arr(obj(item.ToRecipients).Mailbox)
          .map((r) => text(r.EmailAddress))
          .filter((a): a is string => Boolean(a)),
        receivedAt: text(item.DateTimeReceived) ?? new Date().toISOString(),
        preview: (bodyText ?? "").slice(0, 255),
        bodyText,
        webLink: text(item.WebClientReadFormQueryString),
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Agenda
// ─────────────────────────────────────────────────────────────

const TZ_HEADER = `<t:TimeZoneContext><t:TimeZoneDefinition Id="${TIME_ZONE}"/></t:TimeZoneContext>`;

async function createCalendarItem(cfg: EwsConfig, itemXml: string, invite: boolean): Promise<string> {
  const body = await call(
    cfg,
    `<m:CreateItem SendMeetingInvitations="${invite ? "SendToAllAndSaveCopy" : "SendToNone"}">
      <m:Items><t:CalendarItem>${itemXml}</t:CalendarItem></m:Items>
    </m:CreateItem>`,
    TZ_HEADER,
  );
  const [msg] = messages(body, "CreateItemResponse", "CreateItemResponseMessage");
  const id = obj(obj(obj(msg?.Items).CalendarItem).ItemId)["@_Id"];
  if (typeof id !== "string") throw new EwsError("Exchange: afspraak aangemaakt zonder ID");
  return id;
}

// Let op: EWS verwacht de elementen in schemavolgorde.
async function createTaskEvent(cfg: EwsConfig, task: TaskEventInput): Promise<string> {
  const day = taskDay(task.due_date);
  return createCalendarItem(
    cfg,
    `<t:Subject>${xml(`✅ ${task.title}`)}</t:Subject>
     <t:Body BodyType="HTML">${xml(`${escapeHtml(task.description ?? "")}<br><br><a href="${escapeHtml(task.link)}">${escapeHtml(task.link)}</a>`)}</t:Body>
     <t:Categories><t:String>Projekt-Assistent</t:String></t:Categories>
     <t:ReminderIsSet>true</t:ReminderIsSet>
     <t:ReminderMinutesBeforeStart>900</t:ReminderMinutesBeforeStart>
     <t:Start>${day}T00:00:00</t:Start>
     <t:End>${nextDay(day)}T00:00:00</t:End>
     <t:IsAllDayEvent>true</t:IsAllDayEvent>
     <t:LegacyFreeBusyStatus>Free</t:LegacyFreeBusyStatus>`,
    false,
  );
}

async function createMeetingEvent(cfg: EwsConfig, meeting: MeetingEventInput): Promise<string> {
  const start = new Date(meeting.start);
  const end = new Date(start.getTime() + 60 * 60_000);
  const attendees = meeting.attendees
    .map((a) => `<t:Attendee><t:Mailbox><t:EmailAddress>${xml(a)}</t:EmailAddress></t:Mailbox></t:Attendee>`)
    .join("");
  const html = `${escapeHtml(meeting.agenda ?? "").replace(/\n/g, "<br>")}<br><br><a href="${escapeHtml(meeting.link)}">${escapeHtml(meeting.link)}</a>`;
  return createCalendarItem(
    cfg,
    `<t:Subject>${xml(meeting.title)}</t:Subject>
     <t:Body BodyType="HTML">${xml(html)}</t:Body>
     <t:Categories><t:String>Projekt-Assistent</t:String></t:Categories>
     <t:Start>${start.toISOString()}</t:Start>
     <t:End>${end.toISOString()}</t:End>
     ${attendees ? `<t:RequiredAttendees>${attendees}</t:RequiredAttendees>` : ""}`,
    attendees.length > 0,
  );
}

export function ewsProvider(cfg: EwsConfig): MailProvider {
  return {
    kind: "ews",
    accountEmail: cfg.accountEmail,
    listFolders: () => listFolders(cfg),
    syncFolder: (folderId, state) => syncFolder(cfg, folderId, state),
    createTaskEvent: (task) => createTaskEvent(cfg, task),
    createMeetingEvent: (meeting) => createMeetingEvent(cfg, meeting),
  };
}

/** Controleert de verbinding (inloggen + mappen lezen). */
export async function testEws(cfg: EwsConfig) {
  const folders = await listFolders(cfg);
  return folders.length;
}
