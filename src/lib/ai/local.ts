import { z } from "zod";
import { BASE_SYSTEM, type TaskSpec } from "@/lib/ai/tasks";

/**
 * Voert een AI-taak uit met een eigen model (bv. op de GB10), via de OpenAI-compatibele API
 * die zowel Ollama (`http://host:11434/v1`) als vLLM (`http://host:8000/v1`) aanbieden.
 *
 * Het JSON-schema gaat mee als `response_format` én staat in de instructies: niet elk model of
 * elke server dwingt het formaat af. Het antwoord wordt daarom altijd met zod gecontroleerd;
 * klopt het niet, dan krijgt het model één keer de fout terug om het te herstellen.
 */
export type LocalModel = { baseUrl: string; model: string; apiKey?: string };

export async function runLocal<T extends z.ZodType>(spec: TaskSpec<T>, target: LocalModel): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(spec.schema);
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: `${BASE_SYSTEM}\n\n${spec.system}\n\nAntwoord uitsluitend met één JSON-object volgens dit schema, zonder uitleg of codeblok:\n${JSON.stringify(jsonSchema)}`,
    },
    { role: "user", content: spec.prompt },
  ];

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await chat(target, messages, jsonSchema);
    const parsed = spec.schema.safeParse(extractJson(text));
    if (parsed.success) return parsed.data;
    lastError = parsed.error.message;
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: `Dit antwoord voldoet niet aan het schema:\n${lastError}\nGeef het volledige, gecorrigeerde JSON-object.` },
    );
  }
  throw new Error(`Antwoord van ${target.model} voldoet niet aan het schema: ${lastError}`);
}

/** Streamt het antwoord, zodat lange berekeningen niet op een HTTP-timeout stuklopen. */
async function chat(target: LocalModel, messages: object[], jsonSchema: object): Promise<string> {
  const res = await fetch(`${target.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: target.model,
      messages,
      stream: true,
      temperature: 0.2,
      response_format: { type: "json_schema", json_schema: { name: "antwoord", schema: jsonSchema } },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${target.model}: ${res.status} ${await res.text()}`);

  let text = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] };
      text += event.choices?.[0]?.delta?.content ?? "";
    }
  }
  return text;
}

/** Haalt het JSON-object uit het antwoord, ook als het model er toch tekst of een codeblok omheen zet. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
