/**
 * Test van de lokale modellen op de GB10, zonder Exchange of andere koppelingen.
 *
 * Leest voorbeeldmails en transcripten uit gb10-test/data/, laat elk lokaal model (en optioneel
 * Claude) dezelfde taken doen als in de app, en schrijft een vergelijkingsrapport naar
 * gb10-test/results/<tijdstip>/rapport.html. Zie gb10-test/README.md.
 *
 *   npm run gb10-test              alleen lokale modellen (niets verlaat het netwerk)
 *   npm run gb10-test -- --claude  ook Claude ter vergelijking (stuurt de testdata naar Claude!)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";
import type { z } from "zod";
import { runLocal } from "@/lib/ai/local";
import { emailDigestTask, meetingSummaryTask, type TaskSpec } from "@/lib/ai/tasks";
import type { Lang } from "@/lib/types";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
if (existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));

const BASE_URL = process.env.LOCAL_LLM_URL ?? "http://localhost:11434/v1";
const MODELS = (process.env.LOCAL_MODELS ?? "gpt-oss:120b,mistral-small3.2")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const LANGUAGE = (process.env.TEST_LANGUAGE ?? "de") as Lang;
const PROJECT = process.env.TEST_PROJECT ?? "Testprojekt";
const PARTICIPANTS = (process.env.TEST_PARTICIPANTS ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const TOPICS = (process.env.TEST_TOPICS ?? "Energieeinkauf,THG-Quote,Fördermittel").split(",").map((t) => t.trim());
const WITH_CLAUDE = process.argv.includes("--claude");

type Mail = { ref: string; from: string; subject: string; date: string; body: string };
type Outcome = { runner: string; seconds: number; result?: unknown; error?: string };
type Case = { title: string; input: string; outcomes: Outcome[] };

async function main() {
  const mails = await readMails(path.join(ROOT, "data", "mails"));
  const transcripts = readTranscripts(path.join(ROOT, "data", "transcripts"));
  if (!mails.length && !transcripts.length) {
    console.error("Geen testdata gevonden. Zet mails in gb10-test/data/mails en transcripten in gb10-test/data/transcripts.");
    process.exit(1);
  }

  const runners: { name: string; run: <T extends z.ZodType>(spec: TaskSpec<T>) => Promise<z.infer<T>> }[] =
    MODELS.map((model) => ({ name: model, run: (spec) => runLocal(spec, { baseUrl: BASE_URL, model }) }));
  if (WITH_CLAUDE) {
    // Pas hier laden: zonder --claude is er geen Claude-configuratie nodig.
    const { runClaude } = await import("@/lib/ai/claude");
    runners.push({ name: "Claude (vergelijking)", run: runClaude });
  }
  console.log(`Modellen: ${runners.map((r) => r.name).join(", ")} · ${mails.length} mails · ${transcripts.length} transcripten`);

  const cases: Case[] = [];

  // Mails in porties van 10, net als in de app.
  for (let i = 0; i < mails.length; i += 10) {
    const batch = mails.slice(i, i + 10);
    const spec = emailDigestTask({ language: LANGUAGE, projectName: PROJECT, knownTopics: TOPICS, emails: batch });
    cases.push({
      title: `Mails ${i + 1}–${i + batch.length}`,
      input: batch.map((m) => `${m.ref} · ${m.from} · ${m.subject}`).join("\n"),
      outcomes: await runAll(runners, spec),
    });
  }

  for (const t of transcripts) {
    const spec = meetingSummaryTask({
      transcript: t.text,
      language: LANGUAGE,
      meetingDate: new Date().toISOString().slice(0, 10),
      participants: PARTICIPANTS,
      projectName: PROJECT,
      agenda: null,
      knownTopics: TOPICS,
    });
    cases.push({
      title: `Verslag: ${t.name}`,
      input: `${t.text.length.toLocaleString("de-DE")} tekens transcript`,
      outcomes: await runAll(runners, spec),
    });
  }

  const dir = path.join(ROOT, "results", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "resultaten.json"), JSON.stringify(cases, null, 2));
  writeFileSync(path.join(dir, "rapport.html"), report(cases, runners.map((r) => r.name)));
  console.log(`\nKlaar. Rapport: ${path.relative(process.cwd(), path.join(dir, "rapport.html"))}`);
}

async function runAll(
  runners: { name: string; run: <T extends z.ZodType>(spec: TaskSpec<T>) => Promise<z.infer<T>> }[],
  spec: TaskSpec<z.ZodType>,
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  // Na elkaar, zodat de tijden per model eerlijk te vergelijken zijn.
  for (const r of runners) {
    process.stdout.write(`  ${r.name} … `);
    const t0 = performance.now();
    try {
      const result = await r.run(spec);
      const seconds = (performance.now() - t0) / 1000;
      outcomes.push({ runner: r.name, seconds, result });
      console.log(`${seconds.toFixed(1)} s`);
    } catch (e) {
      const seconds = (performance.now() - t0) / 1000;
      outcomes.push({ runner: r.name, seconds, error: e instanceof Error ? e.message : String(e) });
      console.log(`fout na ${seconds.toFixed(1)} s`);
    }
  }
  return outcomes;
}

// ─────────────────────────────────────────────────────────────
// Testdata inlezen
// ─────────────────────────────────────────────────────────────

/** .eml (Outlook: slepen naar de map, of "Opslaan als") of .txt ("Opslaan als → Alleen tekst"). */
async function readMails(dir: string): Promise<Mail[]> {
  if (!existsSync(dir)) return [];
  const mails: Mail[] = [];
  for (const file of readdirSync(dir).sort()) {
    const full = path.join(dir, file);
    const ext = path.extname(file).toLowerCase();
    if (ext === ".eml") {
      const m = await simpleParser(readFileSync(full));
      mails.push({
        ref: file,
        from: m.from?.text ?? "",
        subject: m.subject ?? "",
        date: m.date?.toISOString() ?? "",
        body: m.text ?? "",
      });
    } else if (ext === ".txt") {
      const text = readFileSync(full, "utf8");
      const header = (names: string[]) =>
        text.match(new RegExp(`^(?:${names.join("|")}):\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
      mails.push({
        ref: file,
        from: header(["Von", "From", "Van"]),
        subject: header(["Betreff", "Subject", "Onderwerp"]),
        date: header(["Gesendet", "Datum", "Date", "Sent", "Verzonden"]),
        body: text,
      });
    } else if (ext === ".msg") {
      console.warn(`Overgeslagen: ${file} (.msg). Sla de mail in Outlook op als .eml of als tekst (.txt).`);
    }
  }
  return mails;
}

/** Transcripten als tekst, bij voorkeur de uitvoer van transcribe.py ("[mm:ss] Spreker A: …"). */
function readTranscripts(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), "utf8") }));
}

// ─────────────────────────────────────────────────────────────
// Rapport
// ─────────────────────────────────────────────────────────────

function report(cases: Case[], runners: string[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const total = (name: string) =>
    cases.flatMap((c) => c.outcomes).filter((o) => o.runner === name).reduce((sum, o) => sum + o.seconds, 0);
  const errors = (name: string) => cases.flatMap((c) => c.outcomes).filter((o) => o.runner === name && o.error).length;

  const rows = cases
    .map(
      (c) => `<section><h2>${esc(c.title)}</h2><pre class="input">${esc(c.input)}</pre><div class="grid">${c.outcomes
        .map(
          (o) => `<div class="col"><h3>${esc(o.runner)} <span>${o.seconds.toFixed(1)} s</span></h3>${
            o.error ? `<pre class="err">${esc(o.error)}</pre>` : `<pre>${esc(readable(o.result))}</pre>`
          }</div>`,
        )
        .join("")}</div></section>`,
    )
    .join("\n");

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>GB10-test</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1d1d1f;background:#fff}
h1{font-size:22px}h2{font-size:17px;margin-top:32px}h3{font-size:14px;margin:0 0 6px}h3 span{color:#777;font-weight:400}
table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:4px 12px;text-align:left}
.grid{display:grid;grid-template-columns:repeat(${runners.length},minmax(0,1fr));gap:12px}
.col{border:1px solid #ddd;border-radius:8px;padding:10px;min-width:0}
pre{white-space:pre-wrap;word-break:break-word;margin:0;font:13px/1.4 system-ui,sans-serif}
pre.input{color:#555;background:#f5f5f5;padding:8px;border-radius:6px;margin-bottom:10px}.err{color:#b00020}
</style></head><body><h1>GB10-test · ${new Date().toLocaleString("de-DE")}</h1>
<p>Server: ${esc(BASE_URL)} · taal: ${LANGUAGE} · project: ${esc(PROJECT)}</p>
<table><tr><th>Model</th><th>Totale tijd</th><th>Fouten</th></tr>${runners
    .map((r) => `<tr><td>${esc(r)}</td><td>${total(r).toFixed(0)} s</td><td>${errors(r)}</td></tr>`)
    .join("")}</table>
<p>Beoordeel per blok: klopt de inhoud, mist er iets, is er iets verzonnen, is de taal goed?</p>
${rows}</body></html>`;
}

/** Zet het JSON-antwoord om in leesbare tekst voor het rapport. */
function readable(result: unknown): string {
  const r = result as Record<string, unknown>;
  if (Array.isArray(r?.emails)) {
    return (r.emails as { ref: string; summary: string; action: string | null; topic_titles: string[] }[])
      .map(
        (e) =>
          `▸ ${e.ref}\n${e.summary}${e.action ? `\n→ ${e.action}` : ""}${e.topic_titles.length ? `\n[${e.topic_titles.join(", ")}]` : ""}`,
      )
      .join("\n\n");
  }
  if (typeof r?.summary_md === "string") {
    const s = r as {
      title: string;
      summary_md: string;
      sections: { heading: string; kind: string; body_md: string; relevant_for: string[] }[];
      tasks: { title: string; assignee_name: string | null; due_date: string | null }[];
      follow_ups: string[];
    };
    return [
      `# ${s.title}`,
      s.summary_md,
      ...s.sections.map(
        (x) => `## ${x.heading} (${x.kind}${x.relevant_for.length ? ` · voor ${x.relevant_for.join(", ")}` : ""})\n${x.body_md}`,
      ),
      `## Taken\n${s.tasks.map((t) => `- ${t.title} (${t.assignee_name ?? "?"}${t.due_date ? `, ${t.due_date}` : ""})`).join("\n") || "-"}`,
      `## Opvolging\n${s.follow_ups.map((f) => `- ${f}`).join("\n") || "-"}`,
    ].join("\n\n");
  }
  return JSON.stringify(result, null, 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
