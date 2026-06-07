// Draft a confirmable bug report from segmented evidence (TECHNICAL_DOCUMENT.md draft-bug-brief).
// The point is a fast confirmation gate before spending diagnosis/agent tokens.
import { chatJSON, hasModelKey, TEXT_MODEL } from "@/lib/ai/gateway";
import type { AffectedSurface, EvidenceSummaryItem, Role } from "@/lib/insforge/types";
import type { SegmentResult } from "./segment";

export interface ReportSlackMessage {
  slack_message_ts: string;
  slack_user_id: string | null;
  text: string;
  has_files: boolean;
}

export interface DraftInput {
  role: Role;
  repoUrl: string;
  segment: SegmentResult;
  transcript?: string;
  notes?: string;
  commandText?: string;
  slackMessages?: ReportSlackMessage[];
  maxPromptChars?: number;
}

export interface DraftFields {
  whereItHappens: string;
  actualBehavior: string;
  expectedBehavior?: string;
  reproductionContext?: string;
  affectedSurface: AffectedSurface;
  evidenceSummary: EvidenceSummaryItem[];
  missingInfo: string[];
  agentPromptPreview: string;
}

export interface ReportModelClient {
  hasModelKey(): boolean;
  chatJSON<T>(args: { system: string; user: string; model?: string; maxTokens?: number }): Promise<T>;
}

interface ModelDraftFields {
  whereItHappens?: unknown;
  actualBehavior?: unknown;
  expectedBehavior?: unknown;
  reproductionContext?: unknown;
  affectedSurface?: unknown;
  evidenceSummary?: unknown;
  missingInfo?: unknown;
  agentPromptPreview?: unknown;
}

const EXPORT_HANG_PATTERN = /(?:report\s+)?export.*(?:hang|stuck|crash|freeze)|(?:hang|stuck|crash|freeze).*(?:report\s+)?export/i;
const SURFACES: AffectedSurface[] = ["frontend", "backend", "mobile", "infra", "unknown"];

export const REPORT_DRAFT_SYSTEM_PROMPT =
  "You are Reflex, a bug-intake assistant for engineering teams. " +
  "Convert messy Slack and debug context into a compact bug report that a human can confirm. " +
  "Do not diagnose root cause yet. Do not propose code changes yet. Do not invent facts. " +
  "If important details are missing, put them in missingInfo. Return only strict JSON.";

const DEFAULT_REPORT_MODEL_CLIENT: ReportModelClient = { hasModelKey, chatJSON };

/**
 * Drafts a confirmable bug report with the configured LLM, falling back to scripted logic.
 *
 * @param input Role, repo, segmented evidence, and optional Slack/debug context.
 * @param client Model client used for testing or OpenRouter at runtime.
 * @returns Report fields shown to the user before confirmation.
 * @sideEffects May call OpenRouter when `OPENROUTER_API_KEY` is configured.
 */
export async function draftReportWithLLM(
  input: DraftInput,
  client: ReportModelClient = DEFAULT_REPORT_MODEL_CLIENT
): Promise<DraftFields> {
  const fallback = () => draftReport(input);
  if (!client.hasModelKey()) return fallback();

  try {
    const modelDraft = await client.chatJSON<ModelDraftFields>({
      system: REPORT_DRAFT_SYSTEM_PROMPT,
      user: buildReportDraftUserPrompt(input),
      model: process.env.REFLEX_REPORT_MODEL || TEXT_MODEL,
      maxTokens: 900,
    });
    return normalizeModelDraft(modelDraft, fallback());
  } catch {
    return fallback();
  }
}

/**
 * Builds the user prompt for LLM report drafting.
 *
 * @param input Role, repo, segmented evidence, and optional Slack/debug context.
 * @returns Prompt containing confirmed run context and the required JSON schema.
 * @sideEffects None.
 */
export function buildReportDraftUserPrompt(input: DraftInput): string {
  const context = limitText(`Run:
- role: ${input.role}
- repoUrl: ${input.repoUrl}
- commandText: ${input.commandText ?? "(none)"}

Observed symptom seed:
${input.segment.symptomSeed}

Transcript:
${input.transcript || "(none)"}

User notes:
${input.notes || "(none)"}

Visible/debug state:
${JSON.stringify(input.segment.visibleState ?? {}, null, 2)}

Slack context:
${formatSlackMessages(input.slackMessages ?? [])}

Evidence summaries:
${JSON.stringify(input.segment.evidenceSummary, null, 2)}`, input.maxPromptChars ?? 6000);

  return `Create a confirmable bug report from this Reflex run.

${context}

Return JSON with exactly these fields:
{
  "whereItHappens": "Product area, page, workflow, or unknown",
  "actualBehavior": "What the user sees happening",
  "expectedBehavior": "What should happen instead, or null",
  "reproductionContext": "Known steps, data shape, browser, customer segment, or null",
  "affectedSurface": "frontend | backend | mobile | infra | unknown",
  "evidenceSummary": [{"kind": "slack_message | screenshot | video | screen_recording | audio_recording | transcript | log | other", "mediaArtifactId": "optional id", "summary": "Short evidence summary"}],
  "missingInfo": ["Short missing detail or question"],
  "agentPromptPreview": "One compact paragraph preview of what will be sent to diagnosis/agent after confirmation"
}`;
}

/**
 * Drafts a confirmable bug report from captured evidence.
 *
 * @param input Role, repo, segmented evidence, and optional transcript/notes.
 * @returns Report fields shown to the user before confirmation.
 * @sideEffects None.
 */
export function draftReport(input: DraftInput): DraftFields {
  const { segment } = input;

  if (EXPORT_HANG_PATTERN.test(segment.symptomSeed)) {
    return {
      whereItHappens: "Report export screen",
      actualBehavior: "When the user exports a large report, the frontend hangs or stops responding.",
      expectedBehavior: "The export should complete or show progress without hanging.",
      reproductionContext: "Large customer report export from the reporting page.",
      affectedSurface: "frontend",
      evidenceSummary: segment.evidenceSummary,
      missingInfo: ["Exact dataset size is approximate", "Browser/version not captured"],
      agentPromptPreview:
        "Investigate the report export flow. The user reports that exporting a large report hangs. " +
        "Confirm whether the export handler blocks or waits on an unbounded backend response before changing code.",
    };
  }

  // Generic draft from the captured narration/notes.
  const where = input.notes?.slice(0, 80) || "Captured during live reproduction";
  const actual = segment.symptomSeed;
  return {
    whereItHappens: where,
    actualBehavior: actual,
    expectedBehavior: undefined,
    reproductionContext: input.transcript?.slice(0, 200),
    affectedSurface: "unknown",
    evidenceSummary: segment.evidenceSummary,
    missingInfo: ["Expected behavior not stated", "Affected surface inferred"],
    agentPromptPreview: `Investigate: ${actual}. Reproduce from the attached recording before changing code.`,
  };
}

/**
 * Normalizes model output into the report shape persisted by the backend.
 *
 * @param value Raw model JSON.
 * @param fallback Scripted fallback values used for missing or malformed fields.
 * @returns Sanitized report fields.
 * @sideEffects None.
 */
function normalizeModelDraft(value: ModelDraftFields, fallback: DraftFields): DraftFields {
  return {
    whereItHappens: stringField(value.whereItHappens, fallback.whereItHappens),
    actualBehavior: stringField(value.actualBehavior, fallback.actualBehavior),
    expectedBehavior: optionalStringField(value.expectedBehavior),
    reproductionContext: optionalStringField(value.reproductionContext),
    affectedSurface: surfaceField(value.affectedSurface, fallback.affectedSurface),
    evidenceSummary: evidenceField(value.evidenceSummary, fallback.evidenceSummary),
    missingInfo: stringArrayField(value.missingInfo, fallback.missingInfo),
    agentPromptPreview: stringField(value.agentPromptPreview, fallback.agentPromptPreview),
  };
}

/**
 * Formats Slack context for compact prompt inclusion.
 *
 * @param messages Copied Slack messages.
 * @returns Line-oriented message context.
 * @sideEffects None.
 */
function formatSlackMessages(messages: ReportSlackMessage[]): string {
  if (messages.length === 0) return "(none)";
  return messages
    .slice(0, 25)
    .map((message) => {
      const user = message.slack_user_id ?? "unknown";
      const files = message.has_files ? " files=yes" : "";
      return `- ${message.slack_message_ts} ${user}${files}: ${message.text}`;
    })
    .join("\n");
}

/**
 * Trims model prompt context while preserving the schema instructions outside the cap.
 *
 * @param value Full evidence/context text.
 * @param maxChars Maximum context characters to send to the model.
 * @returns Trimmed context with a visible truncation marker when needed.
 * @sideEffects None.
 */
function limitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n[truncated]`;
}

/**
 * Reads a required string from model output.
 *
 * @param value Candidate value.
 * @param fallback Fallback when candidate is absent.
 * @returns Trimmed string.
 * @sideEffects None.
 */
function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Reads an optional string from model output.
 *
 * @param value Candidate value.
 * @returns Trimmed string or undefined.
 * @sideEffects None.
 */
function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads an affected surface from model output.
 *
 * @param value Candidate value.
 * @param fallback Fallback affected surface.
 * @returns Supported affected surface.
 * @sideEffects None.
 */
function surfaceField(value: unknown, fallback: AffectedSurface): AffectedSurface {
  return typeof value === "string" && SURFACES.includes(value as AffectedSurface)
    ? (value as AffectedSurface)
    : fallback;
}

/**
 * Reads evidence summary rows from model output.
 *
 * @param value Candidate model value.
 * @param fallback Fallback evidence rows.
 * @returns Sanitized evidence rows.
 * @sideEffects None.
 */
function evidenceField(value: unknown, fallback: EvidenceSummaryItem[]): EvidenceSummaryItem[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .map((item): EvidenceSummaryItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const summary = optionalStringField(record.summary);
      if (!summary) return null;
      const mediaArtifactId = optionalStringField(record.mediaArtifactId);
      return {
        kind: optionalStringField(record.kind) ?? "other",
        ...(mediaArtifactId ? { mediaArtifactId } : {}),
        summary,
      };
    })
    .filter((item): item is EvidenceSummaryItem => Boolean(item));
  return rows.length > 0 ? rows : fallback;
}

/**
 * Reads a string array from model output.
 *
 * @param value Candidate model value.
 * @param fallback Fallback values.
 * @returns Sanitized string array.
 * @sideEffects None.
 */
function stringArrayField(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return values.length > 0 ? values.map((item) => item.trim()) : fallback;
}
