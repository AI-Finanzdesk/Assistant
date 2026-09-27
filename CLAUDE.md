# Projekt-Assistent – notities voor verdere ontwikkeling

- Next.js 15 App Router + Supabase (RLS!) + Claude (`src/lib/ai/claude.ts`) + AssemblyAI + Microsoft Graph.
- Rechten staan in `supabase/migrations/*.sql` (RLS-policies en hulpfuncties `is_internal`, `project_role`,
  `can_view_meeting_full`, …). Schemawijzigingen altijd als nieuwe migratie (`0002_….sql`), nooit 0001 aanpassen.
- Schermen gebruiken de gebruikersclient (`requireUser()` → RLS). De service-role client (`createAdminClient`)
  alleen in `src/lib/services/*`, cron/webhooks, en pas na een rechtencheck (bv. `rpc("can_edit_meeting")`).
- Alle teksten in de UI via `src/lib/i18n.ts` (nl + de).
- Wensen van gebruikers staan in de tabel `suggestions` (kind `wish`), verbetervoorstellen van de assistent
  als kind `improvement`. Die vormen de backlog voor nieuwe features.
- Checks voor een commit: `npm run typecheck` en `npm run build`.
