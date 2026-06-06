import { getDashboardRunDetail } from '@/lib/dashboard/read-model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Renders the evidence, report, diagnosis, agent, PR, and timeline detail for one Reflex run.
 *
 * @param params Dynamic route params containing the run ID.
 * @returns Server-rendered run detail page or a not-found page.
 * @sideEffects Reads from InsForge when backend credentials are configured.
 */
export default async function RunDetail({ params }: { params: { runId: string } }) {
  const detail = await getDashboardRunDetail(params.runId);
  if (!detail) return <div className="panel">Run not found.</div>;

  const {
    source,
    error,
    run,
    events,
    chatHistory,
    mediaArtifacts,
    bugBriefs,
    intakePackages,
    diagnoses,
    hypotheses,
    agentRuns,
    pullRequests
  } = detail;

  return (
    <>
      <div className="page-title">
        <div>
          <h1>{run.run_key}</h1>
          <p className="muted">
            <span className="pill">{run.mode}</span> {run.role} - {run.status} -{' '}
            {run.repo_url.replace('https://github.com/', '')}
          </p>
        </div>
        <span className={`pill ${source === 'insforge' ? 'good' : 'warn'}`}>
          {source === 'insforge' ? 'InsForge' : 'Demo fixture'}
        </span>
      </div>

      {error && <div className="panel notice">Showing fixture data because InsForge is not connected: {error}</div>}

      {bugBriefs[0] && (
        <div className="panel">
          <h2>Confirmed report</h2>
          <table><tbody>
            <tr><th>Where</th><td>{bugBriefs[0].where_it_happens}</td></tr>
            <tr><th>Actual</th><td>{bugBriefs[0].actual_behavior}</td></tr>
            <tr><th>Expected</th><td>{bugBriefs[0].expected_behavior ?? '-'}</td></tr>
            <tr><th>Surface</th><td>{bugBriefs[0].affected_surface}</td></tr>
            <tr><th>Status</th><td>{bugBriefs[0].status}</td></tr>
          </tbody></table>
        </div>
      )}

      {chatHistory.length > 0 && (
        <div className="panel">
          <h2>Slack context</h2>
          <table>
            <thead><tr><th>Timestamp</th><th>User</th><th>Message</th><th>Files</th></tr></thead>
            <tbody>
              {chatHistory.map((message) => (
                <tr key={message.id}>
                  <td className="muted">{message.slack_message_ts}</td>
                  <td>{message.slack_user_id ?? '-'}</td>
                  <td>{message.text}</td>
                  <td>{message.has_files ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {mediaArtifacts.length > 0 && (
        <div className="panel">
          <h2>Evidence ({mediaArtifacts.length})</h2>
          <table>
            <thead><tr><th>Kind</th><th>Source</th><th>Summary</th><th>Artifact</th></tr></thead>
            <tbody>
              {mediaArtifacts.map((m) => (
                <tr key={m.id}>
                  <td>{m.kind}</td><td>{m.source}</td>
                  <td>{m.summary ?? '-'}</td>
                  <td className="muted"><code>{m.storage_url.split('/').slice(-1)[0]}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {intakePackages[0] && (
        <div className="panel">
          <h2>Intake package</h2>
          <pre>{JSON.stringify(intakePackages[0].confirmed_report, null, 2)}</pre>
        </div>
      )}

      {agentRuns.length > 0 && (
        <div className="panel">
          <h2>Agent evidence</h2>
          <table>
            <thead><tr><th>Provider</th><th>Status</th><th>Logs</th><th>Result</th></tr></thead>
            <tbody>
              {agentRuns.map((run) => (
                <tr key={run.id}>
                  <td>{run.provider}</td>
                  <td>{run.status}</td>
                  <td>{run.logs_url ? <a className="link" href={run.logs_url}>logs</a> : '-'}</td>
                  <td><code>{JSON.stringify(run.result)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pullRequests[0] && (
        <div className="panel">
          <h2>Pull request</h2>
          <p><a className="link" href={pullRequests[0].github_url}>{pullRequests[0].github_url}</a></p>
          <p><strong>Root cause:</strong> {pullRequests[0].root_cause}</p>
          <p className="muted">{pullRequests[0].summary} - {pullRequests[0].verification}</p>
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
