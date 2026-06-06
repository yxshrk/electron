// POST /api/runs/{runId}/confirm-bug-brief
// Confirms a draft (optionally edited), creates the intake_packages row, then runs the demo
// back-half: diagnosis followed by automatic top-hypothesis dispatch.
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

type AutoDispatchProvider = "replicas" | "scripted";

interface AutoDispatchBody {
  provider?: AutoDispatchProvider;
  createPr: boolean;
}

/**
 * Confirms the latest bug brief and starts diagnosis plus automatic dispatch.
 *
 * @param req HTTP request containing optional edited fields and confirmation metadata.
 * @param params Route params containing the Reflex run ID.
 * @returns Confirmed intake package JSON plus diagnosis and dispatch summaries when available.
 * @sideEffects Updates the bug brief, creates an intake package, writes run status events, and may dispatch an agent.
 */
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
    detail: "Report confirmed; diagnosis and dispatch can run.",
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

  // Cascade: confirm → diagnose → dispatch. One human "Confirm" runs the demo back half.
  // Guarded so confirmation still succeeds even if diagnosis or dispatch needs a retry.
  const origin = req.nextUrl.origin;
  let diagnosis: unknown = null;
  let dispatch: unknown = null;
  try {
    const dg = await fetch(`${origin}/api/runs/${runId}/diagnose`, { method: "POST" });
    if (dg.ok) diagnosis = await dg.json();
  } catch {
    /* diagnosis can be retried via POST /diagnose */
  }

  if (diagnosis && shouldAutoDispatch()) {
    dispatch = await autoDispatchRun(origin, runId);
  }

  return NextResponse.json({ ...result, diagnosis, dispatch });
}

/**
 * Checks whether confirmation should continue from diagnosis into dispatch.
 *
 * @returns True unless `REFLEX_AUTO_DISPATCH` is explicitly set to `false`.
 * @sideEffects Reads environment configuration.
 */
function shouldAutoDispatch(): boolean {
  return process.env.REFLEX_AUTO_DISPATCH !== "false";
}

/**
 * Dispatches the top diagnosed hypothesis through the existing run dispatch route.
 *
 * @param origin Absolute app origin used for internal route calls.
 * @param runId Reflex run ID to dispatch.
 * @returns Parsed dispatch response when the request completes, otherwise an error summary.
 * @sideEffects Calls `/api/runs/{runId}/dispatch`, which may create agent runs, PR rows, and GitHub PRs.
 */
async function autoDispatchRun(origin: string, runId: string): Promise<unknown> {
  try {
    const res = await fetch(`${origin}/api/runs/${runId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(autoDispatchBody()),
    });
    return await res.json().catch(() => ({ status: res.status }));
  } catch (error) {
    return { status: "dispatch_request_failed", error: String(error) };
  }
}

/**
 * Builds the dispatch options used by the Slack-first demo path.
 *
 * @returns Dispatch body for `/api/runs/{runId}/dispatch`.
 * @sideEffects Reads optional dispatch provider and PR creation environment flags.
 */
function autoDispatchBody(): AutoDispatchBody {
  const provider = parseAutoDispatchProvider(process.env.REFLEX_AUTO_DISPATCH_PROVIDER);
  const createPr = process.env.REFLEX_AUTO_DISPATCH_CREATE_PR !== "false";
  return provider ? { provider, createPr } : { createPr };
}

/**
 * Parses the optional auto-dispatch provider override.
 *
 * @param value Raw environment value.
 * @returns A supported provider value, or undefined to let dispatch choose Replicas/scripted fallback.
 * @sideEffects None.
 */
function parseAutoDispatchProvider(value: string | undefined): AutoDispatchProvider | undefined {
  return value === "replicas" || value === "scripted" ? value : undefined;
}
