import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase-client met de rechten van de ingelogde gebruiker (RLS actief). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Aangeroepen vanuit een Server Component: de middleware ververst de sessie.
          }
        },
      },
    },
  );
}
