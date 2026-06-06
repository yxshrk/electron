// POST /api/runs/{runId}/diagnose
// Consumes the confirmed intake package, writes diagnoses + hypotheses, and returns the
// DispatchInput payloads Luke's dispatch-replicas route consumes (C4).
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { diagnose } from "@/lib/diagnosis/diagnose";
import { groundSymptom, groundingHint } from "@/lib/grounding/search";
import type { DispatchInput, Hypothesis, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

interface IntakePackageRow {
  id: string;
  bug_brief_id: string;
  confirmed_report: { symptomSeed?: string; [k: string]: unknown };
  status: string;
}

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
    result = diagnose({ role: run.role, symptomSeed, confirmedReport: pkg.confirmed_report });
  } catch (e) {
    await setStatus(runId, "diagnosis_failed", {
      eventType: "diagnosis.failed",
      title: "Diagnosis failed",
      detail: String(e),
    });
    return NextResponse.json({ error: "diagnosis failed" }, { status: 500 });
  }

  // Ground the symptom in the indexed codebase (pgvector). Empty if the repo isn't indexed yet.
  const grounded = await groundSymptom(run.repo_url, result.symptom);
  const hint = groundingHint(grounded);
  const groundingEvidence = grounded.map((g) => `code: ${g.filePath}:${g.startLine}-${g.endLine}`);

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

  await setStatus(runId, "diagnosed", {
    eventType: "diagnosis.created",
    title: "Diagnosis ready",
    detail: `${result.symptom} · ${hypotheses.length} hypotheses`,
    payload: { diagnosisId: diag.id, symptom: result.symptom },
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

  return NextResponse.json({
    diagnosisId: diag.id,
    symptom: result.symptom,
    roleLens: result.roleLens,
    hypotheses: result.hypotheses,
    grounding: grounded,
    dispatch,
  });
}
