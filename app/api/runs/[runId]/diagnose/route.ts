// POST /api/runs/{runId}/diagnose
// Consumes the confirmed intake package, writes diagnoses + hypotheses, and returns the
// DispatchInput payloads Luke's dispatch-replicas route consumes (C4).
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { diagnoseWithLLM } from "@/lib/diagnosis/diagnose";
import { grepRepo, grepHint } from "@/lib/grounding/grep";
import type { DispatchInput, Hypothesis, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

interface IntakePackageRow {
  id: string;
  bug_brief_id: string;
  confirmed_report: { symptomSeed?: string; [k: string]: unknown };
  status: string;
}

/**
 * Generates diagnosis hypotheses from a confirmed intake package.
 *
 * @param _req Unused request body.
 * @param params Dynamic route params containing the run ID.
 * @returns Diagnosis plus dispatch input candidates.
 * @sideEffects Calls the LLM diagnosis path, writes diagnoses/hypotheses, grounds code hints, and updates run status.
 */
export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const pkgs = await dbSelect<IntakePackageRow>(
    "intake_packages",
    `run_id=eq.${runId}&status=eq.confirmed&order=created_at.desc&limit=1`
  );
  const pkg = pkgs[0];
  if (!pkg) {
    return NextResponse.json(
      { error: "no confirmed intake package; confirm the bug brief first" },
      { status: 400 }
    );
  }

  const symptomSeed =
    pkg.confirmed_report?.symptomSeed ||
    (pkg.confirmed_report?.actualBehavior as string) ||
    "Captured issue";

  let result;
  try {
    result = await diagnoseWithLLM({ role: run.role, symptomSeed, confirmedReport: pkg.confirmed_report });
  } catch (e) {
    await setStatus(runId, "diagnosis_failed", {
      eventType: "diagnosis.failed",
      title: "Diagnosis failed",
      detail: String(e),
    });
    return NextResponse.json({ error: "diagnosis failed" }, { status: 500 });
  }

  // Ground the symptom in the codebase by grepping the timeline anchors (route/label/error).
  // More precise than symptom->code embeddings; falls back to symptom words if no timeline.
  const obs = await dbSelect<{ visible_state: { anchors?: string[] } }>(
    "observations",
    `run_id=eq.${runId}&order=created_at.desc&limit=1`
  );
  const anchors = obs[0]?.visible_state?.anchors?.length
    ? obs[0].visible_state.anchors
    : result.symptom.split(/\s+/);
  // Scope the grep to the buggy app we link in the dashboard (the only thing a recording can hit),
  // so grounding points at the same subtree the fix patches. Set REFLEX_GROUNDING_PATH_PREFIX=""
  // to ground against the whole repo (production, where the target is a real customer codebase).
  const pathPrefix = process.env.REFLEX_GROUNDING_PATH_PREFIX ?? "app/test-fixtures";
  const grounded = await grepRepo(run.repo_url, anchors, { pathPrefix });
  const hint = grepHint(grounded);
  const groundingEvidence = grounded.map((g) => `code: ${g.filePath}:${g.line} (${g.anchor})`);

  const diag = await dbInsert<{ id: string }>("diagnoses", {
    run_id: runId,
    bug_brief_id: pkg.bug_brief_id,
    intake_package_id: pkg.id,
    symptom: result.symptom,
    role_lens: result.roleLens,
    evidence: [...result.evidence, ...groundingEvidence],
  });

  const hypotheses: Hypothesis[] = [];
  for (const h of result.hypotheses) {
    // Append grounded candidate files to the agent's reproduction plan (feeds Luke's brief).
    const reproductionPlan = h.reproductionPlan + hint;
    const row = await dbInsert<{ id: string }>("hypotheses", {
      diagnosis_id: diag.id,
      title: h.title,
      confidence: h.confidence,
      reproduction_plan: reproductionPlan,
      expected_failure: h.expectedFailure,
      status: "pending",
    });
    hypotheses.push({
      id: row.id,
      title: h.title,
      reproductionPlan,
      expectedFailure: h.expectedFailure,
    });
  }

  // Enrich the event so Laurence can render the Gate-2 confirmation card straight from the
  // run_events feed (no second fetch). DB hypothesis ids + confidence + grounded files.
  const hypothesesForSlack = hypotheses.map((h, i) => ({
    id: h.id,
    title: h.title,
    confidence: result.hypotheses[i]?.confidence ?? 0,
    reproductionPlan: h.reproductionPlan,
    expectedFailure: h.expectedFailure,
  }));

  await setStatus(runId, "diagnosed", {
    eventType: "diagnosis.created",
    title: "Diagnosis ready",
    detail: `${result.symptom} · ${hypotheses.length} hypotheses`,
    payload: {
      diagnosisId: diag.id,
      symptom: result.symptom,
      roleLens: result.roleLens,
      hypotheses: hypothesesForSlack,
      grounding: grounded.map((g) => ({ filePath: g.filePath, line: g.line })),
    },
  });

  // Build dispatch handoffs for Luke (he owns the actual dispatch-replicas route).
  const dispatch: DispatchInput[] = hypotheses.map((h) => ({
    runId,
    intakePackageId: pkg.id,
    repoUrl: run.repo_url,
    role: run.role,
    symptom: result.symptom,
    hypothesis: h,
  }));

  // Diagnosis is returned to the confirm route and run_events. The confirm route owns the demo
  // auto-dispatch step by calling POST /api/runs/{runId}/dispatch after this succeeds.
  return NextResponse.json({
    diagnosisId: diag.id,
    symptom: result.symptom,
    roleLens: result.roleLens,
    hypotheses: result.hypotheses,
    grounding: grounded,
    dispatch,
  });
}
