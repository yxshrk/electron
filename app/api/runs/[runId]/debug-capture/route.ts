// POST /api/runs/{runId}/debug-capture
// The screen-recording (debug mode) ingest. Accepts multipart form-data from the browser recorder:
//   files:  recording (webm), audio (webm), frames (one or more png)
//   fields: transcript, notes, recordingKind
// Uploads each artifact to InsForge Storage, writes media_artifacts + an observation, and segments
// the evidence so draft-bug-brief can converge into the same flow as Slack bug mode.
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { uploadObject } from "@/lib/insforge/storage";
import { segmentDebugCapture } from "@/lib/diagnosis/segment";
import { shortKey } from "@/lib/ids";
import type { MediaArtifactRow, MediaKind, ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";
export const maxDuration = 60;

async function storeArtifact(
  runId: string,
  file: File,
  kind: MediaKind
): Promise<MediaArtifactRow> {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const artifactKey = `${shortKey("art")}.${ext}`;
  const objectKey = `runs/${runId}/debug/${artifactKey}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await uploadObject(objectKey, bytes, file.type || "application/octet-stream");
  return dbInsert<MediaArtifactRow>("media_artifacts", {
    run_id: runId,
    artifact_key: artifactKey,
    kind,
    source: "debug_capture",
    storage_url: stored.storageUrl,
    summary: null,
    safe_to_share: false,
  });
}

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const form = await req.formData();
  const transcript = (form.get("transcript") as string | null)?.trim() || undefined;
  const notes = (form.get("notes") as string | null)?.trim() || undefined;
  const recordingKind =
    (form.get("recordingKind") as string | null) === "video" ? "video" : "screen_recording";

  const recordingFile = form.get("recording") as File | null;
  const audioFile = form.get("audio") as File | null;
  const frameFiles = form.getAll("frames").filter((f): f is File => f instanceof File);

  const ids: { recording?: string; audio?: string; frames: string[] } = { frames: [] };
  let stored = 0;

  if (recordingFile && recordingFile.size > 0) {
    const row = await storeArtifact(runId, recordingFile, recordingKind);
    ids.recording = row.id;
    stored++;
  }
  if (audioFile && audioFile.size > 0) {
    const row = await storeArtifact(runId, audioFile, "audio_recording");
    ids.audio = row.id;
    stored++;
  }
  for (const frame of frameFiles) {
    if (frame.size === 0) continue;
    const row = await storeArtifact(runId, frame, "screenshot");
    ids.frames.push(row.id);
    stored++;
  }

  // Segment the captured evidence into a compact, reusable observation.
  const segment = segmentDebugCapture({
    transcript,
    notes,
    recordingKind,
    frameCount: ids.frames.length,
    hasAudio: Boolean(ids.audio),
    mediaArtifactIds: ids,
  });

  await dbInsert("observations", {
    run_id: runId,
    transcript: transcript ?? "",
    visible_state: {
      ...segment.visibleState,
      notes: notes ?? "",
      symptomSeed: segment.symptomSeed,
      evidenceSummary: segment.evidenceSummary,
      source: "debug_capture",
    },
  });

  await setStatus(runId, "context_stored", {
    eventType: "debug.captured",
    title: "Live debug capture stored",
    detail: `${stored} artifact(s) · "${segment.symptomSeed}"`,
    payload: { storedArtifacts: stored },
    actor: "recorder",
  });

  return NextResponse.json({ storedArtifacts: stored, status: "stored" });
}
