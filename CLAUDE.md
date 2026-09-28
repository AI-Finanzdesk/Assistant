# Projekt-Assistent – notities voor verdere ontwikkeling

- Next.js 15 App Router + Supabase (RLS!) + Claude (`src/lib/ai/claude.ts`) + AssemblyAI.
- AI-taken (prompt + zod-schema) staan los van het model in `src/lib/ai/tasks.ts`; `claude.ts` voert ze uit met
  Claude, `local.ts` met een eigen model (Ollama/vLLM op de GB10). Test van de lokale modellen: `gb10-test/`.
- Mail/agenda via `src/lib/mail/provider.ts`: Exchange on-premise (EWS, `src/lib/mail/ews.ts`) of Microsoft 365
  (Graph, `src/lib/microsoft/graph.ts`). Nieuwe mail-/agendafuncties altijd aan de `MailProvider`-interface toevoegen.
- Rechten staan in `supabase/migrations/*.sql` (RLS-policies en hulpfuncties `is_internal`, `project_role`,
  `can_view_meeting_full`, …). Schemawijzigingen altijd als nieuwe migratie (`0002_….sql`), nooit 0001 aanpassen.
- Schermen gebruiken de gebruikersclient (`requireUser()` → RLS). De service-role client (`createAdminClient`)
  alleen in `src/lib/services/*`, cron/webhooks, en pas na een rechtencheck (bv. `rpc("can_edit_meeting")`).
- Alle teksten in de UI via `src/lib/i18n.ts` (nl + de).
- Wensen van gebruikers staan in de tabel `suggestions` (kind `wish`), verbetervoorstellen van de assistent
  als kind `improvement`. Die vormen de backlog voor nieuwe features.
- Checks voor een commit: `npm run typecheck` en `npm run build`.
