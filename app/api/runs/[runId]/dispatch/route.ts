// POST /api/runs/{runId}/dispatch
// Gate 2: after the user confirms the DIAGNOSIS in Slack, trigger Luke's Replicas dispatch.
// Builds a DispatchInput from the stored top (or chosen) hypothesis and forwards it to Luke's
// /dispatch-replicas route. This is the single, Slack-confirmed handoff to Replicas — diagnose
// no longer auto-dispatches.
import { NextRequest, NextResponse } from "next/server";
import { dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import type { DispatchInput, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface DiagnosisRow {
  id: string;
  symptom: string;
  intake_package_id: string;
}
interface HypothesisRow {
  id: string;
  title: string;
  reproduction_plan: string;
  expected_failure: string;
  confidence: number;
}

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    hypothesisId?: string;
    provider?: "replicas" | "scripted";
    createPr?: boolean;
  };

  const diags = await dbSelect<DiagnosisRow>(
    "diagnoses",
    `run_id=eq.${runId}&order=created_at.desc&limit=1`
  );
  const diag = diags[0];
  if (!diag) {
    return NextResponse.json({ error: "no diagnosis to dispatch; run diagnose first" }, { status: 400 });
  }

  const hyps = await dbSelect<HypothesisRow>(
    "hypotheses",
    `diagnosis_id=eq.${diag.id}&order=confidence.desc`
  );
  const hyp = body.hypothesisId ? hyps.find((h) => h.id === body.hypothesisId) : hyps[0];
  if (!hyp) return NextResponse.json({ error: "no hypothesis to dispatch" }, { status: 400 });

  // Build the contract Luke's /dispatch-replicas expects (matches agent/replicas/types.ts).
  const input: DispatchInput = {
    runId,
    intakePackageId: diag.intake_package_id,
    repoUrl: run.repo_url,
    role: run.role,
    symptom: diag.symptom,
    hypothesis: {
      id: hyp.id,
      title: hyp.title,
      reproductionPlan: hyp.reproduction_plan, // carries the grep-grounded candidate files
      expectedFailure: hyp.expected_failure,
    },
  };

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  try {
    const res = await fetch(`${origin}/api/runs/${runId}/dispatch-replicas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, provider: body.provider, createPr: body.createPr }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result?.error ?? `dispatch-replicas returned ${res.status}`);

    await setStatus(runId, "dispatched", {
      eventType: "dispatch.started",
      title: "Dispatched to Replicas",
      detail: `${hyp.title} (${result?.provider ?? "replicas"})`,
      payload: { hypothesisId: hyp.id },
      actor: "orchestrator",
    });
    return NextResponse.json({ status: "dispatched", dispatchInput: input, result });
  } catch (e) {
    await setStatus(runId, "dispatch_failed", {
      eventType: "dispatch.failed",
      title: "Dispatch failed",
      detail: String(e),
    });
    return NextResponse.json({ status: "dispatch_failed", error: String(e) }, { status: 502 });
  }
}
