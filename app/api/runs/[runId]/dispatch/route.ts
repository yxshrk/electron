// POST /api/runs/{runId}/dispatch
// After the user confirms the report, trigger Luke's Replicas/scripted dispatch.
// Builds a DispatchInput from the stored top (or chosen) hypothesis and forwards it to Luke's
// /dispatch-replicas route. This is the single handoff used by Slack and manual retry paths.
import { NextRequest, NextResponse } from "next/server";
import { dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { persistEvidence } from "@/lib/insforge/evidence";
import type { DispatchInput, EvidencePayload, ReflexRunRow } from "@/lib/insforge/types";

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

  const origin = req.nextUrl.origin;
  try {
    const providerLabel = body.provider ?? (process.env.REPLICAS_API_KEY ? "replicas" : "scripted");
    await setStatus(runId, "dispatched", {
      eventType: "dispatch.started",
      title: "Dispatched to Replicas",
      detail: `${hyp.title} (${providerLabel})`,
      payload: { hypothesisId: hyp.id, provider: providerLabel },
      actor: "orchestrator",
    });

    const res = await fetch(`${origin}/api/runs/${runId}/dispatch-replicas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, provider: body.provider, createPr: body.createPr }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result?.error ?? `dispatch-replicas returned ${res.status}`);

    // The scripted fallback returns evidence inline — persist it now so the run advances past
    // `dispatched` (to fixed/shipped) and the PR surfaces. The live Replicas path persists later
    // via /api/replicas/callback. Guarded so a dispatch still succeeds if persistence hiccups.
    if (result?.evidence) {
      try {
        await persistEvidence(result.evidence as EvidencePayload);
      } catch {
        /* evidence can be re-persisted via the callback */
      }
    }
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
