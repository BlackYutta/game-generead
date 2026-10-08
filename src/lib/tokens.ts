/**
 * Cheap token accounting. We never need exactness here — only enough accuracy to
 * decide when to compact, well before any real context limit is in sight.
 * Real numbers come back from the API and are what we bill and display.
 */

/** ~4 chars per token for English + code, with a floor for structural overhead. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(m: {
  content?: string | null;
  tool_calls?: string | null;
}): number {
  return estimateTokens(m.content ?? "") + estimateTokens(m.tool_calls ?? "") + 6;
}

/** Above this many estimated context tokens, fold old turns into a summary. */
export const COMPACT_AT = Number(process.env.COMPACT_AT ?? 48_000);

/** Recent turns always kept verbatim, even during compaction. */
export const KEEP_RECENT_TOKENS = Number(process.env.KEEP_RECENT_TOKENS ?? 14_000);

/** A single tool result never gets to dominate the window. */
export const MAX_TOOL_RESULT_CHARS = 24_000;

export function truncate(text: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.2));
  const cut = text.length - head.length - tail.length;
  return `${head}\n\n… [${cut.toLocaleString()} characters truncated — read a specific line range to see this region] …\n\n${tail}`;
}

/** Rough USD, for the editor's cost readout. Per 1M tokens. */
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gemini-3.8-flash": { in: 0.75, cached: 0.075, out: 3.75 },
  "gemini-3.5-flash-lite": { in: 0.3, cached: 0.03, out: 2.5 },
};

export function estimateCost(model: string, prompt: number, output: number, cached = 0): number {
  const p = PRICES[model] ?? PRICES["gemini-3.5-flash-lite"];
  const fresh = Math.max(0, prompt - cached);
  return (fresh * p.in + cached * p.cached + output * p.out) / 1_000_000;
}

export const MODEL_CHOICES = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Strong agentic coding, available on the free tier." },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Faster lightweight model, available on the free tier." },
] as const;

/** Gemini 2.5+ and 3.x reasoning models accept reasoning_effort via compatibility API. */
export function modelParams(model: string): Record<string, unknown> {
  if (/^gemini-(2\.5|3\.[678])/.test(model)) {
    return { reasoning_effort: process.env.GEMINI_REASONING || "medium" };
  }
  return { temperature: 0.4 };
}
