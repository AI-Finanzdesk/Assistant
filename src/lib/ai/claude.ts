import "server-only";
import Anthropic, { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import {
  agendaTask,
  BASE_SYSTEM,
  emailDigestTask,
  meetingSummaryTask,
  type TaskSpec,
  weeklyReviewTask,
} from "@/lib/ai/tasks";

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

/**
 * Eén Claude-aanroep met gestructureerde (JSON-)uitvoer, gevalideerd met zod.
 * Bij een weigering door de veiligheidsfilters wordt overgeschakeld op een reservemodel:
 * bij Anthropic door de API zelf (fallbacks: "default"), bij Vertex door de middleware hierboven.
 */
export async function runClaude<T extends z.ZodType>(opts: TaskSpec<T> & { maxTokens?: number }): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    ...(useVertex ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    system: `${BASE_SYSTEM}\n\n${opts.system}`,
    messages: [{ role: "user", content: opts.prompt }],
    output_config: {
      effort: opts.effort,
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

export type { Agenda, EmailDigest, MeetingSummary, Review } from "@/lib/ai/tasks";

export const summarizeMeeting = (input: Parameters<typeof meetingSummaryTask>[0]) => runClaude(meetingSummaryTask(input));
export const generateAgenda = (input: Parameters<typeof agendaTask>[0]) => runClaude(agendaTask(input));
export const digestEmails = (input: Parameters<typeof emailDigestTask>[0]) => runClaude(emailDigestTask(input));
export const weeklyReview = (input: Parameters<typeof weeklyReviewTask>[0]) => runClaude(weeklyReviewTask(input));
