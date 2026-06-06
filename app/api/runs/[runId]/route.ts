import { NextRequest, NextResponse } from "next/server";
import { getDashboardRunDetail } from "@/lib/dashboard/read-model";

export const runtime = "nodejs";

/**
 * Reads one dashboard run detail bundle by database ID or run key.
 *
 * @param _req Incoming request; unused because the run ID comes from route params.
 * @param params Dynamic route params containing the run ID.
 * @returns JSON detail bundle, or a 404 response when the run cannot be found.
 * @sideEffects Reads from InsForge when credentials are configured.
 */
export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const detail = await getDashboardRunDetail(params.runId);
  if (!detail) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({
    ...detail,
    media: detail.mediaArtifacts,
    briefs: detail.bugBriefs,
    packages: detail.intakePackages,
  });
}
