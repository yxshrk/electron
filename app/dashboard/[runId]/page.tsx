// Read-only run detail: confirmed report, evidence, diagnosis, hypotheses, and the run timeline.
import { dbSelect, getRun } from "@/lib/insforge/db";
import type { ReflexRunRow } from "@/lib/insforge/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RunEventRow {
  id: string; event_type: string; status: string | null; title: string; detail: string; created_at: string;
}
interface DiagnosisRow { id: string; symptom: string; role_lens: string }
interface HypothesisRow { id: string; title: string; confidence: number; reproduction_plan: string; expected_failure: string; status: string }
interface MediaRow { id: string; kind: string; source: string; storage_url: string }
interface BriefRow { id: string; actual_behavior: string; where_it_happens: string; status: string }
interface PullRow { id: string; github_url: string; summary: string; verification: string }

export default async function RunDetail({ params }: { params: { runId: string } }) {
  const run = await getRun<ReflexRunRow>(params.runId);
  if (!run) return <div className="panel">Run not found.</div>;

  const [events, media, briefs, diagnoses, pulls] = await Promise.all([
    dbSelect<RunEventRow>("run_events", `run_id=eq.${run.id}&order=created_at.asc&limit=200`),
    dbSelect<MediaRow>("media_artifacts", `run_id=eq.${run.id}&order=created_at.asc`),
    dbSelect<BriefRow>("bug_briefs", `run_id=eq.${run.id}&order=created_at.desc`),
    dbSelect<DiagnosisRow>("diagnoses", `run_id=eq.${run.id}&order=created_at.desc`),
    dbSelect<PullRow>("pull_requests", `run_id=eq.${run.id}&order=created_at.desc`),
  ]);
  const hypotheses = diagnoses[0]
    ? await dbSelect<HypothesisRow>("hypotheses", `diagnosis_id=eq.${diagnoses[0].id}&order=confidence.desc`)
    : [];

  return (
    <>
      <h1>{run.run_key}</h1>
      <p className="muted">
        <span className="pill">{run.mode} mode</span> · {run.role} · {run.status} ·{" "}
        {run.repo_url.replace("https://github.com/", "")}
      </p>

      {briefs[0] && (
        <div className="panel">
          <h2>Confirmed report</h2>
          <table><tbody>
            <tr><th>Where</th><td>{briefs[0].where_it_happens}</td></tr>
            <tr><th>Actual</th><td>{briefs[0].actual_behavior}</td></tr>
            <tr><th>Status</th><td>{briefs[0].status}</td></tr>
          </tbody></table>
        </div>
      )}

      {diagnoses[0] && (
        <div className="panel">
          <h2>Diagnosis</h2>
          <p><strong>{diagnoses[0].symptom}</strong></p>
          <p className="muted">{diagnoses[0].role_lens}</p>
          <table>
            <thead><tr><th>Hypothesis</th><th>Conf.</th><th>Reproduction plan</th><th>Status</th></tr></thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.id}>
                  <td>{h.title}</td>
                  <td>{Math.round(h.confidence * 100)}%</td>
                  <td className="muted">{h.reproduction_plan}</td>
                  <td>{h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {media.length > 0 && (
        <div className="panel">
          <h2>Evidence ({media.length})</h2>
          <table>
            <thead><tr><th>Kind</th><th>Source</th><th>Artifact</th></tr></thead>
            <tbody>
              {media.map((m) => (
                <tr key={m.id}>
                  <td>{m.kind}</td><td>{m.source}</td>
                  <td className="muted"><code>{m.storage_url.split("/").slice(-1)[0]}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pulls[0] && (
        <div className="panel">
          <h2>Pull request</h2>
          <p><a className="link" href={pulls[0].github_url}>{pulls[0].github_url}</a></p>
          <p className="muted">{pulls[0].summary} — {pulls[0].verification}</p>
        </div>
      )}

      <div className="panel">
        <h2>Timeline</h2>
        <ul className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <div><strong>{e.title}</strong> {e.status && <span className="pill">{e.status}</span>}</div>
              {e.detail && <div className="muted">{e.detail}</div>}
              <div className="t">{new Date(e.created_at).toLocaleString()}</div>
            </li>
          ))}
          {events.length === 0 && <li className="muted">No events yet.</li>}
        </ul>
      </div>
    </>
  );
}
