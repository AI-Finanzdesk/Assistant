import "server-only";
import { digestEmails } from "@/lib/ai/claude";
import { fetchFolderDelta, getAccessToken } from "@/lib/microsoft/graph";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lang } from "@/lib/types";

/**
 * Leest nieuwe mails uit de aan projecten gekoppelde mappen van één gebruiker,
 * laat Claude ze samenvatten en koppelt ze aan kennisonderwerpen.
 */
export async function syncMailForUser(userId: string) {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("mail_sync_enabled, language")
    .eq("id", userId)
    .single();
  if (!profile?.mail_sync_enabled) return { imported: 0 };

  const token = await getAccessToken(userId);
  if (!token) return { imported: 0 };

  const { data: links } = await admin
    .from("mail_folder_links")
    .select("id, graph_folder_id, project_id, delta_link, projects(name)")
    .eq("user_id", userId);

  const { data: topics } = await admin.from("knowledge_topics").select("id, title");
  const topicByTitle = new Map((topics ?? []).map((t) => [t.title.trim().toLowerCase(), t.id as string]));

  let imported = 0;
  for (const link of links ?? []) {
    const { messages, deltaLink } = await fetchFolderDelta(token, link.graph_folder_id, link.delta_link);

    const rows = messages.map((m) => ({
      owner_id: userId,
      project_id: link.project_id,
      graph_message_id: m.id,
      subject: m.subject,
      from_name: m.from?.emailAddress.name ?? null,
      from_address: m.from?.emailAddress.address ?? null,
      to_addresses: (m.toRecipients ?? []).map((r) => r.emailAddress.address),
      received_at: m.receivedDateTime,
      body_preview: m.bodyPreview,
      body_text: m.body?.content ?? null,
      web_link: m.webLink,
    }));

    if (rows.length) {
      const { data: inserted } = await admin
        .from("emails")
        .upsert(rows, { onConflict: "owner_id,graph_message_id", ignoreDuplicates: true })
        .select("id, subject, from_name, from_address, received_at, body_text, body_preview");

      const fresh = inserted ?? [];
      imported += fresh.length;
      const projectName = (link.projects as unknown as { name: string } | null)?.name ?? "";

      // Samenvatten in porties van 10.
      for (let i = 0; i < fresh.length; i += 10) {
        const batch = fresh.slice(i, i + 10);
        try {
          const digest = await digestEmails({
            language: profile.language as Lang,
            projectName,
            knownTopics: (topics ?? []).map((t) => t.title),
            emails: batch.map((e) => ({
              ref: e.id,
              from: `${e.from_name ?? ""} <${e.from_address ?? ""}>`,
              subject: e.subject ?? "",
              date: e.received_at ?? "",
              body: e.body_text ?? e.body_preview ?? "",
            })),
          });
          for (const d of digest.emails) {
            if (!batch.some((e) => e.id === d.ref)) continue;
            const summary = d.action ? `${d.summary}\n→ ${d.action}` : d.summary;
            await admin.from("emails").update({ summary }).eq("id", d.ref);
            const topicRows = d.topic_titles
              .map((title) => topicByTitle.get(title.trim().toLowerCase()))
              .filter((id): id is string => Boolean(id))
              .map((topic_id) => ({ email_id: d.ref, topic_id }));
            if (topicRows.length) await admin.from("email_topics").upsert(topicRows);
          }
        } catch (e) {
          console.error("E-mails samenvatten mislukt", e);
        }
      }
    }

    await admin
      .from("mail_folder_links")
      .update({ delta_link: deltaLink ?? link.delta_link, last_synced_at: new Date().toISOString() })
      .eq("id", link.id);
  }
  return { imported };
}

export async function syncAllMail() {
  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id").eq("mail_sync_enabled", true);
  const results: Record<string, number | string> = {};
  for (const u of users ?? []) {
    try {
      results[u.id] = (await syncMailForUser(u.id)).imported;
    } catch (e) {
      results[u.id] = e instanceof Error ? e.message : String(e);
    }
  }
  return results;
}
