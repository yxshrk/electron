"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startCapture, type CaptureController, type CaptureEvent } from "@/lib/capture/instrument";
import type { ReportDraft } from "@/lib/insforge/types";

type Phase = "setup" | "capturing" | "uploading" | "drafting" | "draft";

// We always debug our own project; the seeded bug lives at this route. Hardcode it so the recorder
// instruments it (console/network/clicks) with no URL entry. Capture-only: after Done it stores the
// capture + drafts the report; confirmation happens back in Slack (both report and record paths
// confirm there), which kicks off diagnose + dispatch.
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

  const targetWinRef = useRef<Window | null>(null);
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

  // Open the (same-origin) buggy app in its own window and instrument it — no iframe embed.
  const openTarget = useCallback(() => {
    const win = window.open(TARGET, "reflex-target", "popup,width=980,height=720");
    if (!win) {
      setError("Popup blocked — allow popups for this site and click again.");
      return;
    }
    targetWinRef.current = win;
    captureRef.current?.stop();
    setEvents([]);
    const hook = () => {
      try {
        if (win.closed) return;
        if (win.document.readyState !== "complete") {
          window.setTimeout(hook, 150);
          return;
        }
        captureRef.current = startCapture(win, (e) => {
          setEvents((prev) => [...prev, e]);
          if (streamRef.current && (e.type === "network" || e.type === "error" || e.type === "click")) captureFrame();
        });
        setInstrumented(true);
        setError(null);
      } catch {
        setInstrumented(false);
        setError("Couldn't instrument the opened window (it must be same-origin).");
      }
    };
    window.setTimeout(hook, 250);
  }, [captureFrame]);

  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      targetWinRef.current?.close();
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

  return (
    <>
      <h1>Live debug recorder</h1>
      <p className="muted">
        Run <code>{runId}</code> · reproduce the bug — Reflex captures clicks, network, and errors into
        a timeline. Confirm the report in your Slack thread to start diagnosis + the fix.
      </p>
      {error && <div className="panel" style={{ borderColor: "var(--bad)" }}>{error}</div>}

      <div className="panel">
        <div className="row">
          <span className="muted" style={{ flex: 1, fontSize: 13 }}>
            Open the buggy app, reproduce it, then come back and hit Done — Reflex captures its console, network, and clicks.
          </span>
          {!recording && <button className="secondary" onClick={startScreen}>+ Screen record</button>}
          <button className="secondary" onClick={toggleMic}>{micOn ? "■ Mic" : "🎤 Mic"}</button>
        </div>
        {!instrumented ? (
          <button onClick={openTarget} style={{ marginTop: 12 }}>Open the app &amp; start capturing →</button>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            ● Capturing the opened window — reproduce the bug there (Export 50,000 rows), then return and click <strong>Done</strong>.
          </p>
        )}
        <video ref={videoRef} muted playsInline style={{ display: recording ? "block" : "none", marginTop: 10 }} />
        <div className="row" style={{ marginTop: 12 }}>
          <span className={`pill ${instrumented ? "good" : "bad"}`}>{instrumented ? "● instrumented" : "not instrumented"}</span>
          <span className="pill">{events.length} events</span>
          {recording && <span className="pill bad">● recording</span>}
          {framesRef.current.length > 0 && <span className="pill">{framesRef.current.length} frames</span>}
          <button onClick={finish}
            disabled={(events.length === 0 && !notes) || phase === "uploading" || phase === "drafting"}>
            {phase === "uploading" || phase === "drafting" ? "Sending…" : "Done — send to Reflex"}
          </button>
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
          <div className="panel" style={{ borderColor: "var(--accent)", marginTop: 14 }}>
            ✅ Captured &amp; drafted. <strong>Confirm this report in your Slack thread</strong> to start
            diagnosis and the fix — Reflex posts a Confirm / Edit message there. The diagnosis,
            grounding, and Replicas dispatch run after you confirm in Slack.
          </div>
          <a className="link" href={`/dashboard/${runId}`}>Open in dashboard</a>
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
