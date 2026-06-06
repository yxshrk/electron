// Initial investigation: turn a confirmed report into a structured symptom + ranked hypotheses,
// each with a reproductionPlan + expectedFailure that Luke's Replicas agents can act on (C4).
// Role lens per TECHNICAL_DOCUMENT.md §5. Deterministic fixtures keep the demo stable.
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

const ROLE_LENS: Record<Role, string> = {
  sales_csm: "Translate the customer-facing complaint into a reproducible engineering fault.",
  ceo: "Broaden the strategic frustration into measurable product/workflow bottlenecks.",
  product: "Treat the report as desired behavior or a workflow gap.",
  engineer: "Preserve technical specificity; skip business translation and go straight to reproduction.",
};

export function diagnose(input: DiagnoseInput): DiagnosisResult {
  const roleLens = ROLE_LENS[input.role];

  if (/report export hangs/i.test(input.symptomSeed)) {
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

export { ROLE_LENS };
