import "server-only";
import { createTaskEvent, getAccessToken } from "@/lib/microsoft/graph";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Task } from "@/lib/types";

/**
 * Zet een taak in de Outlook-agenda van de toegewezen persoon – maar alleen als
 * die persoon agenda-sync aan heeft staan (profiel) én dat voor dit project wil
 * (project_members.calendar_tasks).
 */
export async function syncTaskToCalendar(taskId: string): Promise<"synced" | "skipped"> {
  const admin = createAdminClient();
  const { data: task } = await admin.from("tasks").select("*").eq("id", taskId).single<Task>();
  if (!task || !task.assignee_id || task.calendar_event_id || task.status !== "open") return "skipped";

  const { data: profile } = await admin
    .from("profiles")
    .select("calendar_sync_enabled")
    .eq("id", task.assignee_id)
    .single();
  if (!profile?.calendar_sync_enabled) return "skipped";

  if (task.project_id) {
    const { data: member } = await admin
      .from("project_members")
      .select("calendar_tasks")
      .eq("project_id", task.project_id)
      .eq("user_id", task.assignee_id)
      .maybeSingle();
    if (member && !member.calendar_tasks) return "skipped";
  }

  const token = await getAccessToken(task.assignee_id);
  if (!token) return "skipped";

  const eventId = await createTaskEvent(token, {
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    link: `${process.env.APP_URL}/tasks?highlight=${task.id}`,
  });
  await admin
    .from("tasks")
    .update({ calendar_event_id: eventId, calendar_synced_at: new Date().toISOString() })
    .eq("id", task.id);
  return "synced";
}
