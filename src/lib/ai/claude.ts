import "server-only";
import Anthropic, { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import type { Lang } from "@/lib/types";

const MODEL = "claude-opus-5";
const FALLBACK_MODEL = "claude-opus-4-8";

/**
 * Met VERTEX_PROJECT_ID loopt Claude via Google Vertex AI, standaard in de EU-regio
 * (VERTEX_REGION, bv. "eu" of "europe-west1"; nooit "global" als de data in de EU moet blijven).
 * Zonder VERTEX_PROJECT_ID wordt de API van Anthropic zelf gebruikt (ANTHROPIC_API_KEY).
 */
const useVertex = !!process.env.VERTEX_PROJECT_ID;

function createClient() {
  if (!useVertex) return new Anthropic();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return new AnthropicVertex({
    projectId: process.env.VERTEX_PROJECT_ID,
    region: process.env.VERTEX_REGION || "eu",
    googleAuth: new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
      // Op Vercel is er geen gcloud-login: de sleutel van het serviceaccount staat in een omgevingsvariabele.
      ...(key ? { credentials: JSON.parse(key) } : {}),
    }),
    // Vertex kent geen server-side fallbacks; de SDK doet het hier aan de kant van de client.
    middleware: [betaRefusalFallbackMiddleware([{ model: FALLBACK_MODEL }])],
  });
}

const client = createClient();

const LANG_NAME: Record<Lang, string> = { nl: "Nederlands", de: "Deutsch" };

const BASE_SYSTEM = `Je bent de projectassistent van een klein team (energie- en vastgoedprojecten in Duitsland,
o.a. anti-diefstalbeveiliging, bouw-/renovatieprojecten, energie-inkoop, THG-quote, subsidieregelingen).
Het team werkt in het Nederlands en het Duits. Je bent nauwkeurig: je verzint geen feiten, namen,
bedragen of datums die niet in het materiaal staan. Als iets onduidelijk is, zeg je dat.`;

/**
 * Eén Claude-aanroep met gestructureerde (JSON-)uitvoer, gevalideerd met zod.
 * Bij een weigering door de veiligheidsfilters wordt overgeschakeld op een reservemodel:
 * bij Anthropic door de API zelf (fallbacks: "default"), bij Vertex door de middleware hierboven.
 */
async function structured<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    ...(useVertex ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    system: `${BASE_SYSTEM}\n\n${opts.system}`,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: {
      effort: opts.effort ?? "high",
      format: betaZodOutputFormat(opts.schema),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude heeft dit verzoek geweigerd.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Antwoord van Claude was te lang en is afgebroken.");
  }
  if (!response.parsed_output) {
    throw new Error("Kon het antwoord van Claude niet verwerken.");
  }
  return response.parsed_output as z.infer<T>;
}

// ─────────────────────────────────────────────────────────────
// Meeting samenvatten
// ─────────────────────────────────────────────────────────────

const MeetingSummary = z.object({
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

export async function summarizeMeeting(input: {
  transcript: string;
  language: Lang;
  meetingDate: string;
  participants: string[];
  projectName: string | null;
  agenda: string | null;
  knownTopics: string[];
}): Promise<MeetingSummary> {
  return structured({
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
  });
}

// ─────────────────────────────────────────────────────────────
// Agenda opstellen
// ─────────────────────────────────────────────────────────────

const Agenda = z.object({
  agenda_md: z
    .string()
    .describe("Agenda in markdown: genummerde punten, per punt kort waarom en wat er besloten moet worden"),
  relevant_topics: z.array(z.string()).describe("Titels (exact) van relevante kennisonderwerpen"),
  preparation: z.array(z.string()).describe("Wat de deelnemers vooraf moeten uitzoeken of meenemen"),
});
export type Agenda = z.infer<typeof Agenda>;

export async function generateAgenda(input: {
  topic: string;
  language: Lang;
  projectName: string | null;
  participants: string[];
  openTasks: string[];
  previousMeetings: { date: string; summary: string }[];
  recentEmails: { date: string; from: string; subject: string; summary: string }[];
  topics: { title: string; summary: string | null }[];
}): Promise<Agenda> {
  const meetings = input.previousMeetings.map((m) => `### ${m.date}\n${m.summary}`).join("\n\n");
  const emails = input.recentEmails.map((e) => `- ${e.date} · ${e.from} · ${e.subject}: ${e.summary}`).join("\n");
  const topics = input.topics.map((t) => `- ${t.title}${t.summary ? `: ${t.summary}` : ""}`).join("\n");

  return structured({
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
  });
}

// ─────────────────────────────────────────────────────────────
// E-mails samenvatten en aan kennis koppelen
// ─────────────────────────────────────────────────────────────

const EmailDigest = z.object({
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

export async function digestEmails(input: {
  language: Lang;
  projectName: string;
  knownTopics: string[];
  emails: { ref: string; from: string; subject: string; date: string; body: string }[];
}): Promise<EmailDigest> {
  const list = input.emails
    .map(
      (e) =>
        `<email ref="${e.ref}">\nVan: ${e.from}\nDatum: ${e.date}\nOnderwerp: ${e.subject}\n\n${e.body.slice(0, 12000)}\n</email>`,
    )
    .join("\n\n");
  return structured({
    schema: EmailDigest,
    effort: "low",
    system: `Je vat zakelijke e-mails samen voor een projectdossier. Schrijf in het ${LANG_NAME[input.language]}.
Negeer handtekeningen, disclaimers en geciteerde eerdere berichten.`,
    prompt: `Project: ${input.projectName}
Bestaande kennisonderwerpen: ${input.knownTopics.join(" | ") || "geen"}

${list}`,
  });
}

// ─────────────────────────────────────────────────────────────
// Wekelijkse analyse: opvolging, inzichten en verbeteringen
// ─────────────────────────────────────────────────────────────

const Review = z.object({
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

export async function weeklyReview(input: { language: Lang; userName: string; context: string }): Promise<Review> {
  return structured({
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
  });
}
