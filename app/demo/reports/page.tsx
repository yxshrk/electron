"use client";

// The buggy app under test (same-origin so the recorder can instrument its console/network).
// "Export report" on a large dataset hits the unbounded /api/demo/export endpoint and hangs/504s.
import { useState } from "react";

export default function DemoReports() {
  const [rows, setRows] = useState(50000);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function exportReport() {
    setState("loading");
    setMessage("");
    const started = performance.now();
    try {
      const res = await fetch(`/api/demo/export?rows=${rows}`);
      const data = await res.json();
      if (!res.ok) {
        // The buggy app logs the failure — instrumentation will capture this console.error.
        console.error("Export failed:", data.error);
        setState("error");
        setMessage(data.error ?? "Export failed");
      } else {
        setState("ok");
        setMessage(`Exported ${data.rows} rows in ${Math.round(performance.now() - started)}ms`);
      }
    } catch (e) {
      console.error("Export request threw:", e);
      setState("error");
      setMessage(String(e));
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, color: "#e6e8ee", background: "#0b0c10", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 20 }}>Acme Reports</h1>
      <p style={{ color: "#99a0b0" }}>Generate and export a customer report.</p>

      <label style={{ display: "block", margin: "14px 0 4px", color: "#99a0b0", fontSize: 13 }}>Dataset size (rows)</label>
      <select value={rows} onChange={(e) => setRows(Number(e.target.value))}
        style={{ background: "#0f1116", color: "#e6e8ee", border: "1px solid #262a35", borderRadius: 8, padding: "8px 10px" }}>
        <option value={100}>100 (small)</option>
        <option value={5000}>5,000 (medium)</option>
        <option value={50000}>50,000 (large — the broken one)</option>
      </select>

      <div style={{ marginTop: 16 }}>
        <button onClick={exportReport} disabled={state === "loading"}
          style={{ background: "#6ea8fe", color: "#0b0c10", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>
          {state === "loading" ? "Exporting…" : "Export report"}
        </button>
      </div>

      {state === "loading" && <p style={{ color: "#99a0b0", marginTop: 14 }}>⏳ Generating export…</p>}
      {state === "error" && <p style={{ color: "#ff6b6b", marginTop: 14 }}>⚠ {message}</p>}
      {state === "ok" && <p style={{ color: "#3ddc97", marginTop: 14 }}>✓ {message}</p>}
    </div>
  );
}
