// GET/POST /api/runs/{runId}/intake-package -> return the confirmed package diagnosis + Replicas use.
import { NextRequest, NextResponse } from "next/server";
import { dbSelect } from "@/lib/insforge/db";
import type { IntakePackage } from "@/lib/insforge/types";

export const runtime = "nodejs";

interface IntakePackageRow {
  id: string;
  bug_brief_id: string;
  confirmed_report: Record<string, unknown>;
  chat_history: unknown[];
  media_artifacts: unknown[];
  debug_capture_artifacts: unknown[];
  status: string;
}

async function readPackage(runId: string) {
  const rows = await dbSelect<IntakePackageRow>(
    "intake_packages",
    `run_id=eq.${runId}&status=eq.confirmed&order=created_at.desc&limit=1`
  );
  const pkg = rows[0];
  if (!pkg) return null;
  const result: IntakePackage = {
    runId,
    intakePackageId: pkg.id,
    bugBriefId: pkg.bug_brief_id,
    confirmedReport: pkg.confirmed_report,
    chatHistoryMessageCount: pkg.chat_history?.length ?? 0,
    mediaArtifactCount: pkg.media_artifacts?.length ?? 0,
    debugArtifactCount: pkg.debug_capture_artifacts?.length ?? 0,
    status: "confirmed",
  };
  return result;
}

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const pkg = await readPackage(params.runId);
  if (!pkg) return NextResponse.json({ error: "no confirmed package" }, { status: 404 });
  return NextResponse.json(pkg);
}

export const POST = GET;
