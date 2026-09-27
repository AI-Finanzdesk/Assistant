import "server-only";
import type { Lang } from "@/lib/types";

/**
 * Transcriptie via AssemblyAI (EU-regio, sprekerherkenning).
 * Achter deze twee functies kan later een andere dienst worden gezet.
 */
const BASE = process.env.ASSEMBLYAI_BASE_URL ?? "https://api.eu.assemblyai.com";

function headers() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY ontbreekt");
  return { authorization: key, "content-type": "application/json" };
}

export async function submitTranscription(opts: {
  audioUrl: string;
  language: Lang;
  webhookUrl?: string;
}): Promise<string> {
  const res = await fetch(`${BASE}/v2/transcript`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      audio_url: opts.audioUrl,
      language_code: opts.language,
      speaker_labels: true,
      punctuate: true,
      format_text: true,
      ...(opts.webhookUrl
        ? {
            webhook_url: opts.webhookUrl,
            webhook_auth_header_name: "x-webhook-secret",
            webhook_auth_header_value: process.env.WEBHOOK_SECRET,
          }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`Transcriptie starten mislukt: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export type TranscriptResult =
  | { status: "queued" | "processing" }
  | { status: "error"; error: string }
  | { status: "completed"; text: string };

export async function getTranscription(id: string): Promise<TranscriptResult> {
  const res = await fetch(`${BASE}/v2/transcript/${id}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`Transcriptie ophalen mislukt: ${res.status}`);
  const data = (await res.json()) as {
    status: "queued" | "processing" | "completed" | "error";
    error?: string;
    text?: string;
    utterances?: { speaker: string; text: string; start: number }[] | null;
  };
  if (data.status === "error") return { status: "error", error: data.error ?? "onbekende fout" };
  if (data.status !== "completed") return { status: data.status };

  const text = data.utterances?.length
    ? data.utterances.map((u) => `[${formatTime(u.start)}] Spreker ${u.speaker}: ${u.text}`).join("\n")
    : (data.text ?? "");
  return { status: "completed", text };
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
