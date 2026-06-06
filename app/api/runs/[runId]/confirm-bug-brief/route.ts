// POST /api/runs/{runId}/confirm-bug-brief
// Confirms a draft (optionally edited), creates the intake_packages row, and gates the run at
// package_confirmed. Diagnosis + Replicas must consume the confirmed package, not the raw draft (C3).
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelect, dbUpdate, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { shortKey } from "@/lib/ids";
import type { BugBriefRow, IntakePackage, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

interface ConfirmBody {
  bugBriefId?: string;
  editedFields?: Record<string, unknown>;
  additionalMediaArtifactIds?: string[];
  confirmedBy?: string;
}

interface ObservationRow {
  visible_state: { symptomSeed?: string };
}

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const body = ((await req.json().catch(() => ({}))) ?? {}) as ConfirmBody;

  // Resolve the brief (explicit id, else the latest needs_confirmation draft).
  const briefRows = body.bugBriefId
    ? await dbSelect<BugBriefRow>("bug_briefs", `id=eq.${body.bugBriefId}&limit=1`)
    : await dbSelect<BugBriefRow>(
        "bug_briefs",
        `run_id=eq.${runId}&order=created_at.desc&limit=1`
      );
  const brief = briefRows[0];
  if (!brief) return NextResponse.json({ error: "no bug brief to confirm" }, { status: 400 });

  const confirmedReport: Record<string, unknown> = {
    whereItHappens: brief.where_it_happens,
    actualBehavior: brief.actual_behavior,
    expectedBehavior: brief.expected_behavior,
    reproductionContext: brief.reproduction_context,
    affectedSurface: brief.affected_surface,
    evidenceSummary: brief.evidence_summary,
    agentPromptPreview: brief.agent_prompt_preview,
    ...(body.editedFields ?? {}),
  };

  // Carry the canonical symptom seed forward so diagnosis stays deterministic.
  const obs = await dbSelect<ObservationRow>(
    "observations",
    `run_id=eq.${runId}&order=created_at.desc&limit=1`
  );
  confirmedReport.symptomSeed =
    obs[0]?.visible_state?.symptomSeed ?? brief.actual_behavior;

  const media = await dbSelect<{ id: string; source: string }>(
    "media_artifacts",
    `run_id=eq.${runId}&select=id,source`
  );
  const debugArtifacts = media.filter((m) => m.source === "debug_capture");

  const nowIso = new Date().toISOString();
  await dbUpdate<BugBriefRow>("bug_briefs", `id=eq.${brief.id}`, {
    status: "confirmed",
    confirmed_at: nowIso,
  });

  const pkg = await dbInsert<{ id: string }>("intake_packages", {
    run_id: runId,
    bug_brief_id: brief.id,
    package_key: shortKey("pkg"),
    chat_history: [],
    media_artifacts: media.map((m) => m.id),
    debug_capture_artifacts: debugArtifacts.map((m) => m.id),
    confirmed_report: confirmedReport,
    status: "confirmed",
    confirmed_by: body.confirmedBy ?? null,
    confirmed_at: nowIso,
  });

  await setStatus(runId, "package_confirmed", {
    eventType: "package.confirmed",
    title: "Intake package confirmed",
    detail: "Report confirmed; diagnosis can run.",
    payload: { intakePackageId: pkg.id, bugBriefId: brief.id },
    actor: body.confirmedBy ?? "user",
  });

  const result: IntakePackage = {
    runId,
    intakePackageId: pkg.id,
    bugBriefId: brief.id,
    confirmedReport,
    chatHistoryMessageCount: 0,
    mediaArtifactCount: media.length,
    debugArtifactCount: debugArtifacts.length,
    status: "confirmed",
  };

  // Cascade: confirm → diagnose → (auto) dispatch to Luke. One human "Confirm" runs the back half.
  // Guarded so confirmation still succeeds even if diagnosis is slow/unavailable.
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  let diagnosis: unknown = null;
  try {
    const dg = await fetch(`${origin}/api/runs/${runId}/diagnose`, { method: "POST" });
    if (dg.ok) diagnosis = await dg.json();
  } catch {
    /* diagnosis can be retried via POST /diagnose */
  }

  return NextResponse.json({ ...result, diagnosis });
}
