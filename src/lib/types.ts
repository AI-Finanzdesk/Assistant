export type Lang = "nl" | "de";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  language: Lang;
  is_admin: boolean;
  is_internal: boolean;
  mail_sync_enabled: boolean;
  calendar_sync_enabled: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "done";
  created_at: string;
}

export type MemberRole = "owner" | "member" | "guest";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: MemberRole;
  see_all_meetings: boolean;
  see_emails: boolean;
  calendar_tasks: boolean;
}

export interface KnowledgeTopic {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  tags: string[];
  updated_at: string;
}

export type MeetingStatus = "planned" | "uploaded" | "transcribing" | "summarizing" | "done" | "error";

export interface Meeting {
  id: string;
  project_id: string | null;
  title: string;
  topic: string | null;
  scheduled_at: string | null;
  language: Lang;
  status: MeetingStatus;
  consent_confirmed: boolean;
  audio_path: string | null;
  transcription_id: string | null;
  error: string | null;
  calendar_event_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string | null;
  meeting_id: string | null;
  title: string;
  description: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  status: "proposed" | "open" | "done";
  calendar_event_id: string | null;
  created_at: string;
}

export interface Suggestion {
  id: string;
  user_id: string | null;
  project_id: string | null;
  kind: "followup" | "task" | "insight" | "improvement" | "wish";
  title: string;
  body_md: string | null;
  status: "new" | "accepted" | "dismissed" | "done";
  created_at: string;
}
