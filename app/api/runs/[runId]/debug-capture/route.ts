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
import { analyzeDebugCapture } from "@/lib/diagnosis/vision";
import { summarizeTimeline, type CaptureEvent } from "@/lib/diagnosis/timeline";
import type { ImagePart } from "@/lib/ai/gateway";
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

  // Structured capture timeline (clicks / network / console / errors) — the high-signal evidence.
  let events: CaptureEvent[] = [];
  const eventsRaw = form.get("events") as string | null;
  if (eventsRaw) {
    try {
      events = JSON.parse(eventsRaw);
    } catch {
      /* ignore malformed timeline */
    }
  }

  const recordingFile = form.get("recording") as File | null;
  const audioFile = form.get("audio") as File | null;
  const frameFiles = form.getAll("frames").filter((f): f is File => f instanceof File);

  const ids: { recording?: string; audio?: string; frames: string[] } = { frames: [] };
  const visionFrames: ImagePart[] = [];
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
    // Keep the first few frames as base64 for the vision pass (screen recording -> text).
    if (visionFrames.length < 3) {
      const bytes = new Uint8Array(await frame.arrayBuffer());
      visionFrames.push({ base64: Buffer.from(bytes).toString("base64"), mime: frame.type || "image/png" });
    }
    const row = await storeArtifact(runId, frame, "screenshot");
    ids.frames.push(row.id);
    stored++;
  }

  // Two signals, in priority order:
  //  1. the structured timeline (a real failing request beats a guess at a spinner)
  //  2. vision on sampled frames, with a deterministic fallback.
  const timeline = summarizeTimeline(events);
  const segment = await analyzeDebugCapture(
    {
      transcript,
      notes,
      recordingKind,
      frameCount: ids.frames.length,
      hasAudio: Boolean(ids.audio),
      mediaArtifactIds: ids,
    },
    visionFrames
  );

  const symptomSeed = timeline.symptomSeed ?? segment.symptomSeed;
  const evidenceSummary = [...timeline.evidenceSummary, ...segment.evidenceSummary];

  await dbInsert("observations", {
    run_id: runId,
    transcript: transcript ?? "",
    visible_state: {
      ...segment.visibleState,
      ...timeline.visibleState,
      notes: notes ?? "",
      symptomSeed,
      anchors: timeline.anchors, // grep targets for diagnosis grounding
      timeline: timeline.lines,
      evidenceSummary,
      source: events.length > 0 ? "timeline" : "debug_capture",
    },
  });

  await setStatus(runId, "context_stored", {
    eventType: "debug.captured",
    title: "Live debug capture stored",
    detail: `${stored} artifact(s), ${events.length} events · "${symptomSeed}"`,
    payload: { storedArtifacts: stored, eventCount: events.length },
    actor: "recorder",
  });

  return NextResponse.json({ storedArtifacts: stored, eventCount: events.length, status: "stored" });
}
