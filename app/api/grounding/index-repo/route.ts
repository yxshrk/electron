// POST /api/grounding/index-repo  { repoUrl }
// Index (or re-index) a repository into pgvector so diagnosis can ground hypotheses in real files.
// Run once per repo before relying on grounded diagnosis (e.g. for the seeded demo repo).
import { NextRequest, NextResponse } from "next/server";
import { indexRepo } from "@/lib/grounding";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_REPO = process.env.DEFAULT_GITHUB_REPO ?? "https://github.com/yxshrk/electron";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { repoUrl?: string };
  const repoUrl = body.repoUrl || DEFAULT_REPO;
  try {
    const result = await indexRepo(repoUrl);
    return NextResponse.json({ status: "indexed", ...result });
  } catch (e) {
    return NextResponse.json({ status: "error", error: String(e) }, { status: 500 });
  }
}
