"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type CaptureController, type CaptureEvent } from "@/lib/capture/instrument";
import type { ReportDraft } from "@/lib/insforge/types";

type Phase = "setup" | "capturing" | "uploading" | "drafting" | "draft" | "working" | "done";

interface DiagnoseResult {
  symptom: string;
  roleLens: string;
  hypotheses: Array<{ id: string; title: string; confidence: number; reproductionPlan: string; expectedFailure: string }>;
  grounding: Array<{ filePath: string; line: number; anchor: string }>;
  dispatch: unknown[];
}

// We always debug our own project; the seeded bug lives at this route. Hardcode it so the recorder
// just embeds + instruments it (console/network/clicks) with no URL entry.
const TARGET = "/test-fixtures/reports";

export default function DebugRecorder({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const [phase, setPhase] = useState<Phase>("setup");
  const [events, setEvents] = useState<CaptureEvent[]>([]);
  const [notes, setNotes] = useState("");
  const [transcript, setTranscript] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instrumented, setInstrumented] = useState(false);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnoseResult | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const captureRef = useRef<CaptureController | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef<Blob | null>(null);
  const framesRef = useRef<Blob[]>([]);
  const speechRef = useRef<{ stop: () => void } | null>(null);

  // Grab a screen frame at the moment an event fires (event-anchored, not blind sampling).
  const captureFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || framesRef.current.length >= 6) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => b && framesRef.current.push(b), "image/png");
  }, []);

  const instrument = useCallback(() => {
    captureRef.current?.stop();
    setEvents([]);
    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      captureRef.current = startCapture(win, (e) => {
        setEvents((prev) => [...prev, e]);
        if (streamRef.current && (e.type === "network" || e.type === "error" || e.type === "click")) captureFrame();
      });
      setInstrumented(true);
      setError(null);
    } catch {
      setInstrumented(false);
      setError("Can't instrument this target (cross-origin). Use a same-origin URL, or rely on frames+notes.");
    }
  }, [captureFrame]);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
    };
  }, []);

  const startScreen = useCallback(async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = display;
      if (videoRef.current) {
        videoRef.current.srcObject = display;
        await videoRef.current.play().catch(() => {});
      }
      const mr = new MediaRecorder(display, { mimeType: pickMime() });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = () => (recordingRef.current = new Blob(chunksRef.current, { type: mr.mimeType }));
      mrRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      setError(`Screen capture declined/failed: ${String(e)} — timeline still records.`);
    }
  }, []);

  const toggleMic = useCallback(() => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown });
    const Ctor = SR.SpeechRecognition || SR.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Web Speech API not available in this browser; type the narration instead.");
      return;
    }
    if (micOn) {
      speechRef.current?.stop();
      setMicOn(false);
      return;
    }
    const rec = new (Ctor as new () => {
      continuous: boolean; interimResults: boolean;
      onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { length: number } }) => void;
      start: () => void; stop: () => void;
    })();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let text = "";
      for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript + " ";
      setTranscript(text.trim());
    };
    rec.start();
    speechRef.current = rec;
    setMicOn(true);
  }, [micOn]);

  const finish = useCallback(async () => {
    setPhase("uploading");
    setError(null);
    captureRef.current?.stop();
    speechRef.current?.stop();
    if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await new Promise((r) => setTimeout(r, 300)); // let onstop flush the blob

    try {
      const fd = new FormData();
      fd.append("events", JSON.stringify(events));
      fd.append("transcript", transcript);
      fd.append("notes", notes);
      fd.append("recordingKind", "screen_recording");
      if (recordingRef.current) fd.append("recording", recordingRef.current, "debug-recording.webm");
      framesRef.current.forEach((f, i) => fd.append("frames", f, `frame-${i + 1}.png`));

      const cap = await fetch(`/api/runs/${runId}/debug-capture`, { method: "POST", body: fd });
      if (!cap.ok) throw new Error(`debug-capture failed: ${await cap.text()}`);

      setPhase("drafting");
      const d = await fetch(`/api/runs/${runId}/draft-bug-brief`, { method: "POST" });
      if (!d.ok) throw new Error(`draft failed: ${await d.text()}`);
      setDraft((await d.json()) as ReportDraft);
      setPhase("draft");
    } catch (e) {
      setError(String(e));
      setPhase("capturing");
    }
  }, [events, notes, transcript, runId]);

  const confirmAndDiagnose = useCallback(async () => {
    setPhase("working");
    try {
      const c = await fetch(`/api/runs/${runId}/confirm-bug-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bugBriefId: draft?.bugBriefId, confirmedBy: "recorder" }),
      });
      if (!c.ok) throw new Error(`confirm failed: ${await c.text()}`);
      const dg = await fetch(`/api/runs/${runId}/diagnose`, { method: "POST" });
      if (!dg.ok) throw new Error(`diagnose failed: ${await dg.text()}`);
      setDiagnosis((await dg.json()) as DiagnoseResult);
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
        Run <code>{runId}</code> · reproduce the bug in the app below — Reflex captures clicks, network,
        and errors into a timeline, then diagnoses + grounds it in the repo.
      </p>
      {error && <div className="panel" style={{ borderColor: "var(--bad)" }}>{error}</div>}

      <div className="panel">
        <div className="row">
          <span className="muted" style={{ flex: 1, fontSize: 13 }}>
            Reproduce the bug in the app below — Reflex captures its console, network, and clicks.
          </span>
          {!recording && <button className="secondary" onClick={startScreen}>+ Screen record</button>}
          <button className="secondary" onClick={toggleMic}>{micOn ? "■ Mic" : "🎤 Mic"}</button>
        </div>
        <iframe
          ref={iframeRef}
          src={TARGET}
          onLoad={instrument}
          style={{ width: "100%", height: 360, border: "1px solid var(--border)", borderRadius: 10, marginTop: 12, background: "#fff" }}
        />
        <video ref={videoRef} muted playsInline style={{ display: recording ? "block" : "none", marginTop: 10 }} />
        <div className="row" style={{ marginTop: 12 }}>
          <span className={`pill ${instrumented ? "good" : "bad"}`}>{instrumented ? "● instrumented" : "not instrumented"}</span>
          <span className="pill">{events.length} events</span>
          {recording && <span className="pill bad">● recording</span>}
          {framesRef.current.length > 0 && <span className="pill">{framesRef.current.length} frames</span>}
          <button onClick={finish} disabled={events.length === 0 && !notes}>Done — diagnose</button>
        </div>

        <label htmlFor="notes">Notes</label>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the timeline won't capture." />
        {transcript && <p className="muted">🎤 {transcript}</p>}
      </div>

      {events.length > 0 && (
        <div className="panel">
          <h2>Captured timeline</h2>
          <ul className="timeline">
            {events.slice(-12).map((e, i) => (
              <li key={i}>
                <span className="t">t={(e.tMs / 1000).toFixed(1)}s</span>{" "}
                <span className="pill">{e.type}</span> {e.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <div className="panel">
          <h2>Reflex understood the bug this way</h2>
          <table><tbody>
            <tr><th>Where</th><td>{draft.whereItHappens}</td></tr>
            <tr><th>Actual</th><td>{draft.actualBehavior}</td></tr>
            <tr><th>Surface</th><td>{draft.affectedSurface}</td></tr>
            <tr><th>Evidence</th><td>{draft.evidenceSummary.map((e) => e.summary).join("; ") || "—"}</td></tr>
          </tbody></table>
          {phase !== "done" && (
            <div className="row" style={{ marginTop: 14 }}>
              <button onClick={confirmAndDiagnose} disabled={phase === "working"}>
                {phase === "working" ? "Working…" : "Confirm & diagnose"}
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
                <tr key={h.id}><td>{h.title}</td><td>{Math.round(h.confidence * 100)}%</td><td className="muted">{h.expectedFailure}</td></tr>
              ))}
            </tbody>
          </table>
          {diagnosis.grounding.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Grounded in: {diagnosis.grounding.map((g) => `${g.filePath}:${g.line}`).slice(0, 4).join(", ")}
            </p>
          )}
          <p className="muted">{diagnosis.dispatch.length} dispatch payload(s) handed to Luke. <a className="link" href={`/dashboard/${runId}`}>See run →</a></p>
        </div>
      )}
    </>
  );
}

function pickMime(): string {
  for (const c of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}
