// Vision pass: sample frames from the screen recording -> InsForge gateway vision model ->
// structured visible_state + symptom. This is the InsForge-native "screen recording -> text" logic
// (the gateway is OpenRouter: vision yes, audio/Whisper no). Falls back to deterministic segmentation
// when no model key is present or the call fails, so the demo never hard-depends on the model.
import { chatJSON, hasModelKey, type ImagePart } from "@/lib/ai/gateway";
import { segmentDebugCapture, type DebugCaptureInput, type SegmentResult } from "./segment";

interface VisionJSON {
  symptom: string;
  screen: string;
  uiState: string;
  affectedSurface: string;
  frameObservations: string[];
}

const SYSTEM =
  "You are a senior engineer triaging a bug from a user's screen recording. " +
  "You are given a few frames plus the user's typed notes/narration. " +
  "Return STRICT JSON with keys: symptom (one concise engineering symptom), screen (what app screen), " +
  "uiState (what the UI is doing, e.g. 'spinner stuck'), affectedSurface (frontend|backend|mobile|infra|unknown), " +
  "frameObservations (array of short strings, one per frame). Do not invent code; describe only what is visible.";

/** Analyze captured frames with the vision model, falling back to deterministic segmentation. */
export async function analyzeDebugCapture(
  base: DebugCaptureInput,
  frames: ImagePart[]
): Promise<SegmentResult & { usedVision: boolean }> {
  const fallback = () => ({ ...segmentDebugCapture(base), usedVision: false });

  if (!hasModelKey() || frames.length === 0) return fallback();

  try {
    const user =
      `User notes: ${base.notes ?? "(none)"}\n` +
      `User narration: ${base.transcript ?? "(none)"}\n` +
      `Frames attached: ${frames.length}. Identify the most likely engineering symptom.`;
    const out = await chatJSON<VisionJSON>({ system: SYSTEM, user, images: frames.slice(0, 3) });

    // Reuse deterministic segmentation for the evidence-summary scaffolding, then overlay vision.
    const seg = segmentDebugCapture(base);
    const evidenceSummary = seg.evidenceSummary.map((e, i) =>
      e.kind === "screenshot" && out.frameObservations[i]
        ? { ...e, summary: out.frameObservations[i] }
        : e
    );

    return {
      symptomSeed: out.symptom?.trim() || seg.symptomSeed,
      visibleState: {
        screen: out.screen,
        ui: out.uiState,
        affectedSurface: out.affectedSurface,
        frames_captured: base.frameCount,
        has_audio: base.hasAudio,
        has_transcript: Boolean(base.transcript),
        source: "vision",
      },
      evidenceSummary,
      usedVision: true,
    };
  } catch {
    return fallback();
  }
}
