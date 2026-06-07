// Thin OpenRouter client. InsForge provisions OPENROUTER_API_KEY via `npx @insforge/cli ai setup`
// and recommends calling OpenRouter directly (the InsForge AI proxy is deprecated).
// Server-only. Docs: `npx @insforge/cli docs ai rest-api`.

const BASE = "https://openrouter.ai/api/v1";

export const VISION_MODEL = process.env.REFLEX_VISION_MODEL || "openai/gpt-4o-mini";
export const TEXT_MODEL = process.env.REFLEX_TEXT_MODEL || "openai/gpt-4o-mini";
export const EMBED_MODEL = process.env.REFLEX_EMBED_MODEL || "openai/text-embedding-3-small";
export const EMBED_DIMS = 1536;

export function hasModelKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function key(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY missing — run `npx @insforge/cli ai setup`.");
  return k;
}

export interface ImagePart {
  base64: string;
  mime: string;
}

/** Chat completion that returns parsed JSON. `images` are sent as vision content blocks. */
export async function chatJSON<T>(args: {
  system: string;
  user: string;
  images?: ImagePart[];
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const content: unknown[] = [{ type: "text", text: args.user }];
  for (const img of args.images ?? []) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}` },
    });
  }

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model ?? VISION_MODEL,
      max_tokens: args.maxTokens ?? 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.system },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter chat failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return JSON.parse(text) as T;
}

/** Embed one or more strings. Returns a vector per input, in order. */
export async function embed(input: string[], model = EMBED_MODEL): Promise<number[][]> {
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw new Error(`OpenRouter embeddings failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}
