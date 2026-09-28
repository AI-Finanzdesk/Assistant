import "server-only";
import { decryptSecret } from "@/lib/crypto";
import { getAccessToken, graphProvider } from "@/lib/microsoft/graph";
import { createAdminClient } from "@/lib/supabase/admin";
import { ewsProvider } from "./ews";
import type { MailProvider } from "./types";

/**
 * De mail-/agendakoppeling van een gebruiker: Exchange op eigen server (EWS)
 * of Microsoft 365 (Graph). Null als er niets gekoppeld is.
 */
export async function getMailProvider(userId: string): Promise<MailProvider | null> {
  const admin = createAdminClient();
  const { data: ews } = await admin.from("exchange_connections").select("*").eq("user_id", userId).maybeSingle();
  if (ews) {
    return ewsProvider({
      url: ews.ews_url,
      username: ews.username,
      password: decryptSecret(ews.password_enc),
      authType: ews.auth_type,
      accountEmail: ews.account_email,
    });
  }

  const { data: ms } = await admin.from("ms_connections").select("account_email").eq("user_id", userId).maybeSingle();
  if (ms) {
    const token = await getAccessToken(userId);
    if (token) return graphProvider(token, ms.account_email);
  }
  return null;
}

/** Welke koppeling heeft de gebruiker (zonder wachtwoorden te ontsleutelen)? */
export async function getConnectionInfo(userId: string) {
  const admin = createAdminClient();
  const [{ data: ews }, { data: ms }] = await Promise.all([
    admin.from("exchange_connections").select("ews_url, account_email, username, auth_type").eq("user_id", userId).maybeSingle(),
    admin.from("ms_connections").select("account_email").eq("user_id", userId).maybeSingle(),
  ]);
  if (ews) return { kind: "ews" as const, accountEmail: ews.account_email as string, url: ews.ews_url as string };
  if (ms) return { kind: "graph" as const, accountEmail: ms.account_email as string | null, url: null };
  return null;
}
