// Initial investigation: turn a confirmed report into a structured symptom + ranked hypotheses,
// each with a reproductionPlan + expectedFailure that Luke's Replicas agents can act on (C4).
// Role lens per TECHNICAL_DOCUMENT.md section 5. Scripted fixtures are fallback only.
import { chatJSON, hasModelKey, TEXT_MODEL } from "@/lib/ai/gateway";
import type { Hypothesis, Role } from "@/lib/insforge/types";

export interface DiagnoseInput {
  role: Role;
  symptomSeed: string;
  confirmedReport: Record<string, unknown>;
}

export interface DiagnosisResult {
  symptom: string;
  roleLens: string;
  evidence: string[];
  hypotheses: Array<Hypothesis & { confidence: number }>;
}

export interface DiagnosisModelClient {
  hasModelKey(): boolean;
  chatJSON<T>(args: { system: string; user: string; model?: string; maxTokens?: number }): Promise<T>;
}

interface ModelDiagnosisResult {
  symptom?: unknown;
  roleLens?: unknown;
  evidence?: unknown;
  hypotheses?: unknown;
}

const ROLE_LENS: Record<Role, string> = {
  sales_csm: "Translate the customer-facing complaint into a reproducible engineering fault.",
  ceo: "Broaden the strategic frustration into measurable product/workflow bottlenecks.",
  product: "Treat the report as desired behavior or a workflow gap.",
  engineer: "Preserve technical specificity; skip business translation and go straight to reproduction.",
};

export const DIAGNOSIS_SYSTEM_PROMPT =
  "You are Reflex, a role-aware debugging planner. " +
  "Translate a confirmed bug report and evidence package into an engineering symptom and ranked reproduction hypotheses. " +
  "Stay grounded in the confirmed report and evidence. Do not write code. " +
  "Do not claim a root cause is proven until an agent reproduces it. Return only strict JSON.";

const DEFAULT_DIAGNOSIS_MODEL_CLIENT: DiagnosisModelClient = { hasModelKey, chatJSON };

// Match the export-hang however it's phrased — including the timeline's own vocabulary
// ("...export failed (504)", "...export was slow (4.2s)") so the real captured-timeline path gets
// the rich hypothesis tree, not the generic fallback (Gap 3).
const EXPORT_SIGNAL = "hang|stuck|crash|freeze|spin|slow|timeout|timed|504|fail|unbounded|never";
const EXPORT_HANG_PATTERN = new RegExp(
  `export[\\s\\S]*(?:${EXPORT_SIGNAL})|(?:${EXPORT_SIGNAL})[\\s\\S]*export`,
  "i"
);

/**
 * Produces a role-aware diagnosis and ranked hypotheses from a confirmed report.
 *
 * @param input Confirmed report, role, and symptom seed.
 * @returns Diagnosis result with evidence and actionable hypotheses.
 * @sideEffects None.
 */
export function diagnose(input: DiagnoseInput): DiagnosisResult {
  const roleLens = ROLE_LENS[input.role];

  if (EXPORT_HANG_PATTERN.test(input.symptomSeed)) {
    return {
      symptom: "Report export hangs on large datasets",
      roleLens,
      evidence: [
        "Live recording shows export click, spinner, then an unresponsive UI",
        "Reproduction context: large customer report",
      ],
      hypotheses: [
        {
          id: "hyp_unbounded_query",
          title: "Unbounded report query",
          confidence: 0.72,
          reproductionPlan: "Seed a large dataset (10k+ rows) and trigger the report export.",
          expectedFailure: "Export request exceeds the timeout or the spinner never resolves.",
        },
        {
          id: "hyp_missing_pagination",
          title: "Missing pagination / streaming on export",
          confidence: 0.58,
          reproductionPlan: "Export with a large dataset and watch memory/response growth.",
          expectedFailure: "Response is built fully in memory and stalls before sending.",
        },
        {
          id: "hyp_request_timeout",
          title: "Request timeout mismatch",
          confidence: 0.41,
          reproductionPlan: "Compare server processing time against the client/proxy timeout.",
          expectedFailure: "Backend keeps working after the client/proxy has already timed out.",
        },
      ],
    };
  }

  // Generic single-hypothesis fallback so the spine still runs for any captured symptom.
  return {
    symptom: input.symptomSeed,
    roleLens,
    evidence: ["Derived from the confirmed live-reproduction report"],
    hypotheses: [
      {
        id: "hyp_primary",
        title: "Primary suspected cause from the reproduction",
        confidence: 0.5,
        reproductionPlan: "Follow the recorded reproduction steps in a sandbox and observe the failure.",
        expectedFailure: "The behavior described in the report reproduces deterministically.",
      },
    ],
  };
}

/**
 * Produces a role-aware diagnosis with the configured LLM, falling back to scripted logic.
 *
 * @param input Confirmed report, role, and symptom seed.
 * @param client Model client used for testing or OpenRouter at runtime.
 * @returns Diagnosis result with evidence and actionable hypotheses.
 * @sideEffects May call OpenRouter when `OPENROUTER_API_KEY` is configured.
 */
export async function diagnoseWithLLM(
  input: DiagnoseInput,
  client: DiagnosisModelClient = DEFAULT_DIAGNOSIS_MODEL_CLIENT
): Promise<DiagnosisResult> {
  const fallback = () => diagnose(input);
  if (!client.hasModelKey()) return fallback();

  try {
    const modelDiagnosis = await client.chatJSON<ModelDiagnosisResult>({
      system: DIAGNOSIS_SYSTEM_PROMPT,
      user: buildDiagnosisUserPrompt(input),
      model: process.env.REFLEX_DIAGNOSIS_MODEL || TEXT_MODEL,
      maxTokens: 1000,
    });
    return normalizeModelDiagnosis(modelDiagnosis, fallback());
  } catch {
    return fallback();
  }
}

/**
 * Builds the user prompt for LLM diagnosis.
 *
 * @param input Confirmed report, role, and symptom seed.
 * @returns Prompt containing the confirmed report and required JSON schema.
 * @sideEffects None.
 */
export function buildDiagnosisUserPrompt(input: DiagnoseInput): string {
  return `Diagnose this confirmed Reflex intake package.

Run:
- role: ${input.role}
- roleLensInstruction: ${ROLE_LENS[input.role]}

Symptom seed:
${input.symptomSeed}

Confirmed report:
${JSON.stringify(input.confirmedReport, null, 2)}

Return JSON with exactly these fields:
{
  "symptom": "One concise engineering symptom",
  "roleLens": "How the role changed interpretation",
  "evidence": ["Short evidence summary grounded in the confirmed report"],
  "hypotheses": [
    {
      "title": "Short hypothesis",
      "confidence": 0.0,
      "reproductionPlan": "Concrete sandbox reproduction steps",
      "expectedFailure": "What should fail before the fix"
    }
  ]
}`;
}

/**
 * Normalizes model diagnosis output into persisted diagnosis fields.
 *
 * @param value Raw model JSON.
 * @param fallback Scripted fallback values used for missing or malformed fields.
 * @returns Sanitized diagnosis.
 * @sideEffects None.
 */
function normalizeModelDiagnosis(value: ModelDiagnosisResult, fallback: DiagnosisResult): DiagnosisResult {
  const hypotheses = hypothesisField(value.hypotheses, fallback.hypotheses);
  return {
    symptom: stringField(value.symptom, fallback.symptom),
    roleLens: stringField(value.roleLens, fallback.roleLens),
    evidence: stringArrayField(value.evidence, fallback.evidence),
    hypotheses,
  };
}

/**
 * Reads model hypotheses and adds stable IDs.
 *
 * @param value Candidate model hypotheses.
 * @param fallback Fallback hypotheses.
 * @returns Sanitized hypotheses with confidence values.
 * @sideEffects None.
 */
function hypothesisField(value: unknown, fallback: Array<Hypothesis & { confidence: number }>): Array<Hypothesis & { confidence: number }> {
  if (!Array.isArray(value)) return fallback;
  const hypotheses = value
    .map((item, index): (Hypothesis & { confidence: number }) | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const title = stringField(record.title, "").trim();
      if (!title) return null;
      return {
        id: `hyp_${slugify(title) || index + 1}`,
        title,
        confidence: confidenceField(record.confidence),
        reproductionPlan: stringField(record.reproductionPlan, fallback[0]?.reproductionPlan ?? "Reproduce the confirmed issue in a sandbox."),
        expectedFailure: stringField(record.expectedFailure, fallback[0]?.expectedFailure ?? "The confirmed issue reproduces before the fix."),
      };
    })
    .filter((item): item is Hypothesis & { confidence: number } => Boolean(item));
  return hypotheses.length > 0 ? hypotheses : fallback;
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

/**
 * Reads and clamps a confidence value.
 *
 * @param value Candidate numeric value.
 * @returns Confidence between 0 and 1.
 * @sideEffects None.
 */
function confidenceField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/**
 * Converts hypothesis title text into a stable ID suffix.
 *
 * @param value Hypothesis title.
 * @returns Lowercase identifier-safe slug.
 * @sideEffects None.
 */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export { ROLE_LENS };
