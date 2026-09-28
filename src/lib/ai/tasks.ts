import { z } from "zod";
import type { Lang } from "@/lib/types";

/**
 * De AI-taken van de app, los van welk model ze uitvoert: per taak het schema van het antwoord,
 * de instructies en de prompt. `claude.ts` voert ze uit met Claude, `local.ts` met een eigen
 * model (bv. op de GB10). Zo gebruiken beide exact dezelfde prompts.
 */
export type TaskSpec<T extends z.ZodType> = {
  schema: T;
  system: string;
  prompt: string;
  /** Hoeveel denkwerk de taak vraagt (Claude: effort). */
  effort: "low" | "medium" | "high";
};

export const LANG_NAME: Record<Lang, string> = { nl: "Nederlands", de: "Deutsch" };

export const BASE_SYSTEM = `Je bent de projectassistent van een klein team (energie- en vastgoedprojecten in Duitsland,
o.a. anti-diefstalbeveiliging, bouw-/renovatieprojecten, energie-inkoop, THG-quote, subsidieregelingen).
Het team werkt in het Nederlands en het Duits. Je bent nauwkeurig: je verzint geen feiten, namen,
bedragen of datums die niet in het materiaal staan. Als iets onduidelijk is, zeg je dat.`;

// ─────────────────────────────────────────────────────────────
// Meeting samenvatten
// ─────────────────────────────────────────────────────────────

export const MeetingSummary = z.object({
  title: z.string().describe("Korte, beschrijvende titel van het gesprek"),
  summary_md: z.string().describe("Samenvatting in markdown: context, belangrijkste punten, besluiten"),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body_md: z.string(),
        kind: z.enum(["discussion", "decision", "info"]),
        relevant_for: z
          .array(z.string())
          .describe("Namen van deelnemers (exact uit de deelnemerslijst) voor wie dit onderdeel relevant is"),
      }),
    )
    .describe("Het verslag opgedeeld per besproken onderwerp"),
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      assignee_name: z
        .string()
        .nullable()
        .describe("Naam exact uit de deelnemerslijst, of null als onduidelijk"),
      due_date: z.string().nullable().describe("YYYY-MM-DD als er een deadline is genoemd of logisch is, anders null"),
    }),
  ),
  knowledge: z
    .array(
      z.object({
        topic_title: z
          .string()
          .describe("Titel van een bestaand kennisonderwerp (exact) of een nieuw, kort onderwerp"),
        insight: z.string().describe("Het herbruikbare inzicht: feiten, prijzen, contactpersonen, voorwaarden"),
      }),
    )
    .describe("Kennis die ook in andere projecten van nut is"),
  follow_ups: z.array(z.string()).describe("Concrete voorstellen voor opvolging die niet expliciet zijn afgesproken"),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

export function meetingSummaryTask(input: {
  transcript: string;
  language: Lang;
  meetingDate: string;
  participants: string[];
  projectName: string | null;
  agenda: string | null;
  knownTopics: string[];
}): TaskSpec<typeof MeetingSummary> {
  return {
    schema: MeetingSummary,
    effort: "high",
    system: `Je maakt verslagen van zakelijke gesprekken. Schrijf alle tekst in het ${LANG_NAME[input.language]}.
Sprekers in het transcript heten "Spreker A/B/…"; leid uit de inhoud af wie wie is als dat kan.
Actiepunten zijn alleen dingen die echt zijn afgesproken of duidelijk moeten gebeuren.
Deel het verslag op in onderdelen zodat een onderdeel los gedeeld kan worden met één persoon.`,
    prompt: `Datum: ${input.meetingDate}
Project: ${input.projectName ?? "geen (algemeen overleg)"}
Deelnemers: ${input.participants.join(", ") || "onbekend"}
Bestaande kennisonderwerpen: ${input.knownTopics.join(" | ") || "geen"}

${input.agenda ? `Agenda vooraf:\n${input.agenda}\n\n` : ""}Transcript:
<transcript>
${input.transcript}
</transcript>`,
  };
}

// ─────────────────────────────────────────────────────────────
// Agenda opstellen
// ─────────────────────────────────────────────────────────────

export const Agenda = z.object({
  agenda_md: z
    .string()
    .describe("Agenda in markdown: genummerde punten, per punt kort waarom en wat er besloten moet worden"),
  relevant_topics: z.array(z.string()).describe("Titels (exact) van relevante kennisonderwerpen"),
  preparation: z.array(z.string()).describe("Wat de deelnemers vooraf moeten uitzoeken of meenemen"),
});
export type Agenda = z.infer<typeof Agenda>;

export function agendaTask(input: {
  topic: string;
  language: Lang;
  projectName: string | null;
  participants: string[];
  openTasks: string[];
  previousMeetings: { date: string; summary: string }[];
  recentEmails: { date: string; from: string; subject: string; summary: string }[];
  topics: { title: string; summary: string | null }[];
}): TaskSpec<typeof Agenda> {
  const meetings = input.previousMeetings.map((m) => `### ${m.date}\n${m.summary}`).join("\n\n");
  const emails = input.recentEmails.map((e) => `- ${e.date} · ${e.from} · ${e.subject}: ${e.summary}`).join("\n");
  const topics = input.topics.map((t) => `- ${t.title}${t.summary ? `: ${t.summary}` : ""}`).join("\n");

  return {
    schema: Agenda,
    effort: "medium",
    system: `Je bereidt een zakelijk overleg voor. Schrijf in het ${LANG_NAME[input.language]}.
Baseer de agenda op het onderwerp én op wat er nog openstaat uit eerdere gesprekken en e-mails.
Houd het compact: liever 4–7 scherpe punten dan een lange lijst.`,
    prompt: `Onderwerp van de meeting: ${input.topic}
Project: ${input.projectName ?? "geen specifiek project"}
Deelnemers: ${input.participants.join(", ") || "onbekend"}

Open taken:
${input.openTasks.join("\n") || "geen"}

Eerdere besprekingen:
${meetings || "geen"}

Recente e-mails:
${emails || "geen"}

Kennisbank:
${topics || "leeg"}`,
  };
}

// ─────────────────────────────────────────────────────────────
// E-mails samenvatten en aan kennis koppelen
// ─────────────────────────────────────────────────────────────

export const EmailDigest = z.object({
  emails: z.array(
    z.object({
      ref: z.string().describe("De ref van de e-mail zoals gegeven"),
      summary: z.string().describe("1–3 zinnen: waar gaat het over, wat wordt er gevraagd/afgesproken"),
      topic_titles: z.array(z.string()).describe("Exacte titels van relevante bestaande kennisonderwerpen"),
      action: z.string().nullable().describe("Actie die voor ons team volgt uit deze mail, of null"),
    }),
  ),
});
export type EmailDigest = z.infer<typeof EmailDigest>;

export function emailDigestTask(input: {
  language: Lang;
  projectName: string;
  knownTopics: string[];
  emails: { ref: string; from: string; subject: string; date: string; body: string }[];
}): TaskSpec<typeof EmailDigest> {
  const list = input.emails
    .map(
      (e) =>
        `<email ref="${e.ref}">\nVan: ${e.from}\nDatum: ${e.date}\nOnderwerp: ${e.subject}\n\n${e.body.slice(0, 12000)}\n</email>`,
    )
    .join("\n\n");
  return {
    schema: EmailDigest,
    effort: "low",
    system: `Je vat zakelijke e-mails samen voor een projectdossier. Schrijf in het ${LANG_NAME[input.language]}.
Negeer handtekeningen, disclaimers en geciteerde eerdere berichten.`,
    prompt: `Project: ${input.projectName}
Bestaande kennisonderwerpen: ${input.knownTopics.join(" | ") || "geen"}

${list}`,
  };
}

// ─────────────────────────────────────────────────────────────
// Wekelijkse analyse: opvolging, inzichten en verbeteringen
// ─────────────────────────────────────────────────────────────

export const Review = z.object({
  suggestions: z.array(
    z.object({
      kind: z.enum(["followup", "task", "insight", "improvement"]),
      project_name: z.string().nullable().describe("Exacte projectnaam of null"),
      title: z.string(),
      body_md: z.string().describe("Toelichting; bij followup eventueel een conceptbericht"),
    }),
  ),
});
export type Review = z.infer<typeof Review>;

export function weeklyReviewTask(input: { language: Lang; userName: string; context: string }): TaskSpec<typeof Review> {
  return {
    schema: Review,
    effort: "high",
    system: `Je bent een proactieve assistent. Analyseer de stand van zaken en doe maximaal 8 voorstellen,
alleen als ze echt waarde hebben. Schrijf in het ${LANG_NAME[input.language]}.
- followup: iemand moet worden nagebeld/gemaild (bv. geen reactie, deadline verlopen). Voeg een kort conceptbericht toe.
- task: iets dat moet gebeuren maar nog geen taak is.
- insight: een verband tussen projecten, een risico, of kennis die hergebruikt kan worden.
- improvement: een concrete verbetering of uitbreiding van deze assistent-tool zelf, gebaseerd op hoe hij gebruikt wordt
  en op de wensen die gebruikers hebben doorgegeven.
Herhaal geen voorstellen die al openstaan.`,
    prompt: `Voorstellen voor: ${input.userName}\n\n${input.context}`,
  };
}
