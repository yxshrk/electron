// Turn a captured event timeline into a precise symptom + grep anchors.
// This is the "proof over guess" signal: a real failing request beats a vision guess at a spinner.
import type { EvidenceSummaryItem } from "@/lib/insforge/types";

export interface CaptureEvent {
  tMs: number;
  type: "click" | "navigation" | "network" | "console" | "error";
  detail: string;
  meta?: Record<string, unknown>;
}

export interface TimelineSummary {
  symptomSeed?: string; // present when the timeline shows a clear failure
  anchors: string[]; // literal tokens to grep in the repo (route, label, error keyword)
  lines: string[]; // human-readable timeline for evidence/dashboard
  visibleState: Record<string, unknown>;
  evidenceSummary: EvidenceSummaryItem[];
}

const SLOW_MS = 3000;

export function summarizeTimeline(events: CaptureEvent[]): TimelineSummary {
  const lines = events.map((e) => `t=${(e.tMs / 1000).toFixed(1)}s ${e.type}: ${e.detail}`);

  const network = events.filter((e) => e.type === "network");
  const failing = network.find((e) => {
    const status = Number(e.meta?.status ?? 0);
    const dur = Number(e.meta?.durationMs ?? 0);
    return status === 0 || status >= 400 || dur >= SLOW_MS;
  });
  const lastClick = [...events].reverse().find((e) => e.type === "click");
  const firstError = events.find((e) => e.type === "error" || (e.type === "console" && e.meta?.level === "error"));

  const anchors = new Set<string>();
  for (const e of network) {
    const url = String(e.meta?.url ?? "");
    pathTokens(url).forEach((t) => anchors.add(t));
  }
  if (lastClick) labelTokens(lastClick.detail).forEach((t) => anchors.add(t));
  if (firstError) errorTokens(firstError.detail).forEach((t) => anchors.add(t));

  let symptomSeed: string | undefined;
  if (failing) {
    const status = Number(failing.meta?.status ?? 0);
    const dur = Number(failing.meta?.durationMs ?? 0);
    const path = pathOf(String(failing.meta?.url ?? failing.detail));
    const action = lastClick ? ` after clicking "${lastClick.detail}"` : "";
    const how = status >= 400 ? `failed (${status})` : status === 0 ? "errored" : `was slow (${(dur / 1000).toFixed(1)}s)`;
    symptomSeed = `Request to ${path} ${how}${action}`;
  } else if (firstError) {
    symptomSeed = `Error during reproduction: ${firstError.detail}`;
  }

  const evidenceSummary: EvidenceSummaryItem[] = [];
  if (failing) {
    evidenceSummary.push({
      kind: "log",
      summary: `Network: ${failing.detail}` + (lastClick ? ` (triggered by "${lastClick.detail}")` : ""),
    });
  }
  if (firstError) evidenceSummary.push({ kind: "log", summary: `Console error: ${firstError.detail}` });

  return {
    symptomSeed,
    anchors: [...anchors],
    lines,
    visibleState: {
      source: "timeline",
      failingRequest: failing?.meta ?? null,
      lastClick: lastClick?.detail ?? null,
      errorCount: events.filter((e) => e.type === "error").length,
      networkCount: network.length,
    },
    evidenceSummary,
  };
}

// --- token extraction for grep anchors ---
// Drop URL noise, English filler, AND common code keywords (so "export" the symptom doesn't match
// every `export function` line). Distinctive tokens (route names, error words) are what we want.
const STOP = new Set([
  "http", "https", "api", "www", "com", "the", "and", "for", "with", "localhost",
  "export", "import", "const", "function", "return", "async", "await", "default",
  "route", "page", "true", "false", "null", "undefined", "type", "interface",
  "string", "number", "boolean", "this", "from", "request",
]);

function pathTokens(url: string): string[] {
  return pathOf(url)
    .split(/[/?=&._-]/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length >= 4 && !STOP.has(s) && !/^\d+$/.test(s));
}
function labelTokens(label: string): string[] {
  return label
    .split(/\s+/)
    .map((s) => s.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((s) => s.length >= 4 && !STOP.has(s));
}
function errorTokens(msg: string): string[] {
  return msg
    .split(/\s+/)
    .map((s) => s.replace(/[^a-z0-9]/gi, "").toLowerCase())
    .filter((s) => s.length >= 5 && !STOP.has(s))
    .slice(0, 4);
}
function pathOf(url: string): string {
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url;
  }
}
