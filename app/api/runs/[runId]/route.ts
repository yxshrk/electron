// GET /api/runs/{runId} -> full read-only bundle for the dashboard + Slack detail.
import { NextRequest, NextResponse } from "next/server";
import { dbSelect, getRun } from "@/lib/insforge/db";
import type { ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const [events, media, briefs, packages, diagnoses, pulls] = await Promise.all([
    dbSelect("run_events", `run_id=eq.${runId}&order=created_at.asc&limit=200`),
    dbSelect("media_artifacts", `run_id=eq.${runId}&order=created_at.asc`),
    dbSelect("bug_briefs", `run_id=eq.${runId}&order=created_at.desc`),
    dbSelect("intake_packages", `run_id=eq.${runId}&order=created_at.desc`),
    dbSelect<{ id: string }>("diagnoses", `run_id=eq.${runId}&order=created_at.desc`),
    dbSelect("pull_requests", `run_id=eq.${runId}&order=created_at.desc`),
  ]);

  let hypotheses: unknown[] = [];
  if (diagnoses[0]) {
    hypotheses = await dbSelect(
      "hypotheses",
      `diagnosis_id=eq.${diagnoses[0].id}&order=confidence.desc`
    );
  }

  return NextResponse.json({
    run,
    events,
    media,
    briefs,
    packages,
    diagnoses,
    hypotheses,
    pullRequests: pulls,
  });
}
