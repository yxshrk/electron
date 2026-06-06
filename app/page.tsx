"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = [
  { value: "sales_csm", label: "Sales / CSM" },
  { value: "ceo", label: "CEO / Founder" },
  { value: "product", label: "Product" },
  { value: "engineer", label: "Engineer" },
];

/**
 * Renders the demo entry page for starting a browser-based debug run.
 *
 * @returns Interactive page that creates a debug run and opens the recorder route.
 * @sideEffects Creates a Reflex run through `/api/runs` when the user starts recording.
 */
export default function Home() {
  const router = useRouter();
  const [role, setRole] = useState("sales_csm");
  const [repoUrl, setRepoUrl] = useState("https://github.com/yxshrk/electron");
  const [starting, setStarting] = useState(false);

  /**
   * Creates a debug-mode Reflex run and navigates to its recorder.
   *
   * @returns Nothing after navigation is scheduled.
   * @sideEffects Sends a POST request to `/api/runs` and updates client navigation state.
   */
  async function startDebugRun() {
    setStarting(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "web", mode: "debug", role, repoUrl }),
      });
      const data = await res.json();
      router.push(`/debug/${data.runId}`);
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <h1>Reflex</h1>
      <p className="muted">
        Tag who you are, record the bug while it happens, and Reflex diagnoses the real engineering
        problem and dispatches coder agents to fix it.
      </p>

      <div className="panel">
        <h2>Start a live debug run</h2>
        <p className="muted">
          Debug mode is the screen-recording entry point - a sibling to Slack bug mode. It feeds the
          same backend (<code>/api/runs/&#123;runId&#125;/debug-capture</code>) and converges into the
          same diagnose to dispatch pipeline.
        </p>

        <label htmlFor="role">Your role</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <label htmlFor="repo">Repository</label>
        <input id="repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />

        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={startDebugRun} disabled={starting}>
            {starting ? "Starting..." : "Open recorder"}
          </button>
          <a className="link" href="/dashboard">View runs</a>
        </div>
      </div>
    </>
  );
}
