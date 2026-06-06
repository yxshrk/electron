// POST /api/runs/{runId}/media -> register a media artifact by reference (Slack file metadata).
// Laurence uploads the file to Storage (runs/{runId}/slack/...) and posts the metadata here.
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, getRun } from "@/lib/insforge/db";
import { shortKey } from "@/lib/ids";
import type { MediaArtifactRow, MediaKind, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

const KINDS: MediaKind[] = [
  "screenshot",
  "video",
  "screen_recording",
  "audio_recording",
  "transcript",
  "log",
  "other",
];

interface MediaBody {
  kind?: MediaKind;
  storageUrl?: string;
  slackFileId?: string;
  slackMessageTs?: string;
  thumbnailUrl?: string;
  summary?: string;
}

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as MediaBody;
  if (!body.storageUrl) {
    return NextResponse.json({ error: "storageUrl is required" }, { status: 400 });
  }
  const kind: MediaKind = KINDS.includes(body.kind as MediaKind) ? (body.kind as MediaKind) : "other";

  const row = await dbInsert<MediaArtifactRow>("media_artifacts", {
    run_id: runId,
    artifact_key: shortKey("art"),
    kind,
    source: "slack_file",
    storage_url: body.storageUrl,
    slack_file_id: body.slackFileId ?? null,
    slack_message_ts: body.slackMessageTs ?? null,
    thumbnail_url: body.thumbnailUrl ?? null,
    summary: body.summary ?? null,
    safe_to_share: false,
  });

  return NextResponse.json({ mediaArtifactId: row.id, status: "stored" });
}
