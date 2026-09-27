import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase-client met service role: omzeilt RLS. Alleen gebruiken in
 * achtergrondtaken (webhooks, cron) en na een eigen rechtencontrole.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
