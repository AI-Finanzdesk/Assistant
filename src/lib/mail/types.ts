/** Gemeenschappelijke interface voor Exchange on-premise (EWS) en Microsoft 365 (Graph). */

export interface MailFolder {
  id: string;
  /** Volledig pad, bv. "Posteingang / Projekte / Dritz" */
  path: string;
}

export interface MailMessage {
  id: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  to: string[];
  receivedAt: string;
  preview: string;
  bodyText: string | null;
  webLink: string | null;
}

export interface TaskEventInput {
  title: string;
  description: string | null;
  due_date: string | null;
  link: string;
}

export interface MeetingEventInput {
  title: string;
  start: string;
  agenda: string | null;
  link: string;
  attendees: string[];
}

export interface MailProvider {
  kind: "ews" | "graph";
  accountEmail: string | null;
  listFolders(): Promise<MailFolder[]>;
  /**
   * Nieuwe berichten in een map sinds de vorige keer (syncState). Eerste keer:
   * berichten van de afgelopen 90 dagen.
   */
  syncFolder(folderId: string, syncState: string | null): Promise<{ messages: MailMessage[]; syncState: string | null }>;
  createTaskEvent(task: TaskEventInput): Promise<string>;
  createMeetingEvent(meeting: MeetingEventInput): Promise<string>;
}

export const FIRST_SYNC_DAYS = 90;

/** Dag waarop een taak in de agenda komt: de deadline, of anders morgen. */
export function taskDay(due: string | null) {
  return due ?? new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
}

export function nextDay(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
