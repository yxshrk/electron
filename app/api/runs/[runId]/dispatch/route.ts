// POST /api/runs/{runId}/dispatch
// After the user confirms the report, trigger Luke's Replicas/scripted dispatch.
// Builds a DispatchInput from the stored top (or chosen) hypothesis and forwards it to Luke's
// Replicas/scripted dispatcher. This is the single handoff used by Slack and manual retry paths.
import { NextRequest, NextResponse } from "next/server";
import { dispatchConfirmedHypothesis } from "@/agent/replicas/dispatch";
import { dbSelect, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { persistEvidence } from "@/lib/insforge/evidence";
import type { DispatchInput, EvidencePayload, ReflexRunRow, RunStatus } from "@/lib/insforge/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DISPATCH_STARTED_STATUSES: RunStatus[] = ["dispatched", "reproduced", "fixed", "shipped"];

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

/**
 * Dispatches the top confirmed hypothesis to Replicas or the scripted fallback.
 *
 * @param req Request containing optional hypothesis selection, provider, and PR creation flags.
 * @param params Route params containing the Reflex run ID.
 * @returns Dispatch result JSON or an error response.
 * @sideEffects Writes run status events, may start agent work, and may persist evidence/PR rows.
 */
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (isDispatchAlreadyStarted(run.status)) {
    return NextResponse.json({ status: run.status, idempotent: true });
  }

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

  try {
    const providerLabel = resolveDispatchProvider(body.provider);
    await setStatus(runId, "dispatched", {
      eventType: "dispatch.started",
      title: "Dispatched to Replicas",
      detail: `${hyp.title} (${providerLabel})`,
      payload: { hypothesisId: hyp.id, provider: providerLabel },
      actor: "orchestrator",
    });

    const result = await dispatchConfirmedHypothesis(input, {
      createPr: body.createPr === true,
      preferScriptedFallback: body.provider === "scripted",
    });

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

/**
 * Resolves the provider label shown in the dispatch-started timeline event.
 *
 * @param requestedProvider Optional provider requested by the caller.
 * @returns Provider label that reflects the runtime path the dispatcher can actually use.
 * @sideEffects Reads `REPLICAS_API_KEY` to determine live Replicas availability.
 */
function resolveDispatchProvider(requestedProvider?: "replicas" | "scripted"): "replicas" | "scripted" {
  if (requestedProvider === "scripted") return "scripted";
  return process.env.REPLICAS_API_KEY ? "replicas" : "scripted";
}

/**
 * Checks whether dispatch has already started or completed for a run.
 *
 * @param status Current Reflex run status.
 * @returns True when a repeated dispatch request should be treated as a no-op.
 * @sideEffects None.
 */
function isDispatchAlreadyStarted(status: RunStatus): boolean {
  return DISPATCH_STARTED_STATUSES.includes(status);
}
