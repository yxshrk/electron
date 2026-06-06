// Draft a confirmable bug report from segmented evidence (TECHNICAL_DOCUMENT.md draft-bug-brief).
// The point is a fast confirmation gate before spending diagnosis/agent tokens — placeholders are fine.
import type { AffectedSurface, EvidenceSummaryItem, Role } from "@/lib/insforge/types";
import type { SegmentResult } from "./segment";

export interface DraftInput {
  role: Role;
  repoUrl: string;
  segment: SegmentResult;
  transcript?: string;
  notes?: string;
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

const isExportHang = (s: SegmentResult) => /report export hangs/i.test(s.symptomSeed);

export function draftReport(input: DraftInput): DraftFields {
  const { segment } = input;

  if (isExportHang(segment)) {
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
