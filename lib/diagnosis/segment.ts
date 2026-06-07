// "Segment" step: turn raw debug-capture evidence (transcript, notes, frame count) into a
// compact visible_state + evidence summary that the report/diagnosis steps consume.
// Deterministic by design (shared-contracts: the live stage must not depend on prompt drift).
// A model path can replace this later via OPENROUTER_API_KEY without changing the interface.
import type { EvidenceSummaryItem } from "@/lib/insforge/types";

export interface DebugCaptureInput {
  transcript?: string;
  notes?: string;
  recordingKind?: "screen_recording" | "video";
  frameCount: number;
  hasAudio: boolean;
  mediaArtifactIds: { recording?: string; audio?: string; frames: string[] };
}

export interface SegmentResult {
  visibleState: Record<string, unknown>;
  evidenceSummary: EvidenceSummaryItem[];
  /** Short natural-language symptom seed used by report + diagnosis. */
  symptomSeed: string;
}

const EXPORT_HANG_RX = /(export|report).*(hang|spin|stuck|freeze|crash|timeout|slow|never)/i;

export function segmentDebugCapture(input: DebugCaptureInput): SegmentResult {
  const text = `${input.transcript ?? ""}\n${input.notes ?? ""}`.trim();
  const isExportHang = EXPORT_HANG_RX.test(text);

  const evidenceSummary: EvidenceSummaryItem[] = [];
  if (input.mediaArtifactIds.recording) {
    evidenceSummary.push({
      kind: input.recordingKind ?? "screen_recording",
      mediaArtifactId: input.mediaArtifactIds.recording,
      summary: isExportHang
        ? "Screen recording shows export clicked, spinner shown, then the UI stops responding."
        : "Screen recording of the reproduction the user described.",
    });
  }
  input.mediaArtifactIds.frames.forEach((id, i) => {
    evidenceSummary.push({
      kind: "screenshot",
      mediaArtifactId: id,
      summary: isExportHang
        ? `Frame ${i + 1}: report/export view in a stuck loading state.`
        : `Frame ${i + 1} captured during reproduction.`,
    });
  });
  if (input.mediaArtifactIds.audio) {
    evidenceSummary.push({
      kind: "audio_recording",
      mediaArtifactId: input.mediaArtifactIds.audio,
      summary: "Narration captured while reproducing the issue.",
    });
  }
  if (input.transcript) {
    evidenceSummary.push({ kind: "transcript", summary: input.transcript.slice(0, 280) });
  }

  const visibleState = {
    screen: isExportHang ? "report export" : "unknown",
    ui: isExportHang ? "spinner active / unresponsive" : "see transcript",
    frames_captured: input.frameCount,
    has_audio: input.hasAudio,
    has_transcript: Boolean(input.transcript),
  };

  const symptomSeed = isExportHang
    ? "Report export hangs on large datasets"
    : firstSentence(text) || "User-reported issue captured via live reproduction";

  return { visibleState, evidenceSummary, symptomSeed };
}

function firstSentence(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = s.match(/^.{0,160}?[.!?](\s|$)/);
  return (m ? m[0] : s.slice(0, 160)).trim();
}
