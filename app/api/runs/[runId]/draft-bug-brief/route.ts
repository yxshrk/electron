// POST /api/runs/{runId}/draft-bug-brief
// Reads the stored debug-capture (or Slack context) observation and drafts a confirmable report (C2).
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { draftReport } from "@/lib/diagnosis/report";
import { shortKey } from "@/lib/ids";
import type {
  BugBriefRow,
  EvidenceSummaryItem,
  ReflexRunRow,
  ReportDraft,
} from "@/lib/insforge/types";

export const runtime = "nodejs";

interface ObservationRow {
  id: string;
  transcript: string;
  visible_state: {
    symptomSeed?: string;
    evidenceSummary?: EvidenceSummaryItem[];
    notes?: string;
    [k: string]: unknown;
  };
}

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const observations = await dbSelect<ObservationRow>(
    "observations",
    `run_id=eq.${runId}&order=created_at.desc&limit=1`
  );
  const obs = observations[0];
  const symptomSeed = obs?.visible_state?.symptomSeed || obs?.transcript || "Captured issue";
  const segment = {
    visibleState: obs?.visible_state ?? {},
    evidenceSummary: obs?.visible_state?.evidenceSummary ?? [],
    symptomSeed,
  };

  const fields = draftReport({
    role: run.role,
    repoUrl: run.repo_url,
    segment,
    transcript: obs?.transcript,
    notes: obs?.visible_state?.notes,
  });

  const brief = await dbInsert<BugBriefRow>("bug_briefs", {
    run_id: runId,
    brief_key: shortKey("brief"),
    where_it_happens: fields.whereItHappens,
    actual_behavior: fields.actualBehavior,
    expected_behavior: fields.expectedBehavior ?? null,
    reproduction_context: fields.reproductionContext ?? null,
    affected_surface: fields.affectedSurface,
    evidence_summary: fields.evidenceSummary,
    missing_info: fields.missingInfo,
    agent_prompt_preview: fields.agentPromptPreview,
    status: "needs_confirmation",
  });

  await setStatus(runId, "report_drafted", {
    eventType: "report.drafted",
    title: "Bug report drafted",
    detail: fields.actualBehavior,
    payload: { bugBriefId: brief.id, symptomSeed },
  });

  const draft: ReportDraft = {
    runId,
    bugBriefId: brief.id,
    status: "needs_confirmation",
    whereItHappens: fields.whereItHappens,
    actualBehavior: fields.actualBehavior,
    expectedBehavior: fields.expectedBehavior,
    reproductionContext: fields.reproductionContext,
    affectedSurface: fields.affectedSurface,
    evidenceSummary: fields.evidenceSummary,
    missingInfo: fields.missingInfo,
    agentPromptPreview: fields.agentPromptPreview,
  };
  return NextResponse.json(draft);
}
