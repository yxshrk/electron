"use client";

import { useCallback, useRef, useState } from "react";
import type { ReportDraft } from "@/lib/insforge/types";

type Phase =
  | "idle"
  | "recording"
  | "recorded"
  | "uploading"
  | "drafting"
  | "draft"
  | "confirming"
  | "diagnosing"
  | "done";

interface DiagnoseResult {
  symptom: string;
  roleLens: string;
  hypotheses: Array<{ id: string; title: string; confidence: number; reproductionPlan: string; expectedFailure: string }>;
  dispatch: unknown[];
}

export default function DebugRecorder({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const [phase, setPhase] = useState<Phase>("idle");
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef<Blob | null>(null);
  const framesRef = useRef<Blob[]>([]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      let combined = display;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        combined = new MediaStream([...display.getVideoTracks(), ...mic.getAudioTracks()]);
      } catch {
        /* mic optional */
      }
      streamRef.current = combined;
      if (videoRef.current) {
        videoRef.current.srcObject = display;
        await videoRef.current.play().catch(() => {});
      }
      // End recording if the user stops sharing from the browser chrome.
      display.getVideoTracks()[0]?.addEventListener("ended", () => stopRecording());

      const mr = new MediaRecorder(combined, { mimeType: pickMime() });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = () => {
        recordingRef.current = new Blob(chunksRef.current, { type: mr.mimeType });
        setPhase("recorded");
      };
      recorderRef.current = mr;
      mr.start();
      setPhase("recording");
    } catch (e) {
      setError(`Could not start screen capture: ${String(e)}`);
      setPhase("idle");
    }
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) {
        framesRef.current.push(blob);
        setFrameCount(framesRef.current.length);
      }
    }, "image/png");
  }, []);

  const stopRecording = useCallback(() => {
    captureFrame(); // grab a final frame
    recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    stopTracks();
  }, [captureFrame]);

  const finish = useCallback(async () => {
    setPhase("uploading");
    setError(null);
    try {
      const fd = new FormData();
      if (recordingRef.current) fd.append("recording", recordingRef.current, "debug-recording.webm");
      framesRef.current.forEach((f, i) => fd.append("frames", f, `frame-${i + 1}.png`));
      fd.append("transcript", transcript);
      fd.append("notes", notes);
      fd.append("recordingKind", "screen_recording");

      const cap = await fetch(`/api/runs/${runId}/debug-capture`, { method: "POST", body: fd });
      if (!cap.ok) throw new Error(`debug-capture failed: ${await cap.text()}`);

      setPhase("drafting");
      const draftRes = await fetch(`/api/runs/${runId}/draft-bug-brief`, { method: "POST" });
      if (!draftRes.ok) throw new Error(`draft failed: ${await draftRes.text()}`);
      setDraft((await draftRes.json()) as ReportDraft);
      setPhase("draft");
    } catch (e) {
      setError(String(e));
      setPhase("recorded");
    }
  }, [notes, transcript, runId]);

  const confirmAndDiagnose = useCallback(async () => {
    setPhase("confirming");
    setError(null);
    try {
      const confirm = await fetch(`/api/runs/${runId}/confirm-bug-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bugBriefId: draft?.bugBriefId, confirmedBy: "recorder" }),
      });
      if (!confirm.ok) throw new Error(`confirm failed: ${await confirm.text()}`);

      setPhase("diagnosing");
      const diag = await fetch(`/api/runs/${runId}/diagnose`, { method: "POST" });
      if (!diag.ok) throw new Error(`diagnose failed: ${await diag.text()}`);
      setDiagnosis((await diag.json()) as DiagnoseResult);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("draft");
    }
  }, [draft, runId]);

  return (
    <>
      <h1>Live debug recorder</h1>
      <p className="muted">
        Run <code>{runId}</code> · screen + mic capture → <code>/debug-capture</code> → segment →
        diagnose → hand off to Replicas.
      </p>

      {error && <div className="panel" style={{ borderColor: "var(--bad)" }}>{error}</div>}

      <div className="panel">
        <video ref={videoRef} muted playsInline />
        <div className="row" style={{ marginTop: 12 }}>
          {phase === "idle" && <button onClick={startRecording}>Start recording</button>}
          {phase === "recording" && (
            <>
              <button className="secondary" onClick={captureFrame}>Capture frame ({frameCount})</button>
              <button onClick={stopRecording}>Stop</button>
              <span className="pill bad">● recording</span>
            </>
          )}
          {phase === "recorded" && (
            <>
              <button onClick={finish}>Done — send to Reflex</button>
              <span className="pill">{frameCount} frame(s) captured</span>
            </>
          )}
          {(phase === "uploading" || phase === "drafting") && <span className="pill">Uploading & drafting…</span>}
        </div>

        <label htmlFor="notes">Notes (what went wrong)</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Exporting the big report just spins forever and then the page freezes." />
        <label htmlFor="transcript">Transcript (optional)</label>
        <textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)}
          placeholder="Spoken narration, if any." />
      </div>

      {draft && (
        <div className="panel">
          <h2>Reflex understood the bug this way</h2>
          <table>
            <tbody>
              <tr><th>Where</th><td>{draft.whereItHappens}</td></tr>
              <tr><th>Actual</th><td>{draft.actualBehavior}</td></tr>
              <tr><th>Expected</th><td>{draft.expectedBehavior ?? "—"}</td></tr>
              <tr><th>Surface</th><td>{draft.affectedSurface}</td></tr>
              <tr><th>Evidence</th><td>{draft.evidenceSummary.map((e) => e.summary).join("; ") || "—"}</td></tr>
            </tbody>
          </table>
          {phase !== "done" && (
            <div className="row" style={{ marginTop: 14 }}>
              <button onClick={confirmAndDiagnose} disabled={phase === "confirming" || phase === "diagnosing"}>
                {phase === "confirming" || phase === "diagnosing" ? "Working…" : "Confirm & diagnose"}
              </button>
              <a className="link" href={`/dashboard/${runId}`}>Open in dashboard</a>
            </div>
          )}
        </div>
      )}

      {diagnosis && (
        <div className="panel">
          <h2>Diagnosis → ready for Replicas</h2>
          <p><strong>Symptom:</strong> {diagnosis.symptom}</p>
          <p className="muted">{diagnosis.roleLens}</p>
          <table>
            <thead><tr><th>Hypothesis</th><th>Conf.</th><th>Expected failure</th></tr></thead>
            <tbody>
              {diagnosis.hypotheses.map((h) => (
                <tr key={h.id}>
                  <td>{h.title}</td>
                  <td>{Math.round(h.confidence * 100)}%</td>
                  <td className="muted">{h.expectedFailure}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 10 }}>
            {diagnosis.dispatch.length} dispatch payload(s) handed to Luke&apos;s{" "}
            <code>/api/runs/{runId}/dispatch-replicas</code>.
          </p>
          <a className="link" href={`/dashboard/${runId}`}>See full run timeline →</a>
        </div>
      )}
    </>
  );
}

function pickMime(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}
