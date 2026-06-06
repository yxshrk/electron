import { getDashboardRuns } from '@/lib/dashboard/read-model';
import type { DashboardRun } from '@/lib/dashboard/read-model';
import { formatDate, statusLabel, statusTone } from '@/lib/dashboard/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Renders the top-level Reflex dashboard run list.
 *
 * @returns Server-rendered table of Reflex runs with source metadata.
 * @sideEffects Reads from InsForge when backend credentials are configured.
 */
export default async function Dashboard() {
  const { runs, source, error } = await getDashboardRuns();
  const diagnosedRuns = runs.filter((run) => run.diagnosis_state === 'diagnosed').length;
  const evidenceCount = runs.reduce((total, run) => total + (run.media_count ?? 0) + (run.chat_message_count ?? 0), 0);
  const prCount = runs.filter((run) => Boolean(run.pr_url)).length;

  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">Demo dashboard</p>
          <h1>Diagnoses Overview</h1>
          <p className="muted">
            One place to inspect every intake, diagnosis, evidence bundle, agent result, and PR.
          </p>
        </div>
        <span className={`pill ${source === 'insforge' ? 'good' : 'warn'}`}>
          {source === 'insforge' ? 'InsForge' : 'Demo fixture'}
        </span>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span className="metric-label">Runs</span>
          <strong>{runs.length}</strong>
          <span className="metric-note">latest 100</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Diagnosed</span>
          <strong>{diagnosedRuns}</strong>
          <span className="metric-note">ready for dispatch</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Evidence items</span>
          <strong>{evidenceCount}</strong>
          <span className="metric-note">chat + media</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">PRs</span>
          <strong>{prCount}</strong>
          <span className="metric-note">opened from agents</span>
        </div>
      </div>

      {error && (
        <div className="panel notice">
          {source === 'insforge' ? error : `Showing fixture data because InsForge is not connected: ${error}`}
        </div>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Diagnosis queue</h2>
            <p className="muted">Click a row to inspect the report, context, attachments, hypotheses, and proof.</p>
          </div>
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">
            <strong>No runs yet</strong>
            <p className="muted">Start from Slack or the recorder, then this page becomes the judge-facing data view.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Diagnosis</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Evidence</th>
                  <th>Hypotheses</th>
                  <th>PR</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a className="row-link" href={`/dashboard/${run.id}`}>
                        <strong>{run.summary ?? 'Captured issue'}</strong>
                        <span>{run.run_key} · {run.repo_url.replace('https://github.com/', '')}</span>
                      </a>
                    </td>
                    <td><span className={`status-pill ${statusTone(run.status)}`}>{statusLabel(run.status)}</span></td>
                    <td>
                      <div className="stacked-cell">
                        <span>{run.source}</span>
                        <span className="muted">{run.mode} · {run.role}</span>
                      </div>
                    </td>
                    <td>{evidenceLabel(run)}</td>
                    <td>{run.hypothesis_count ?? 0}</td>
                    <td>{run.pr_url ? <a className="link" href={run.pr_url}>open PR</a> : <span className="muted">pending</span>}</td>
                    <td className="muted">{formatDate(run.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * Formats a compact evidence count for the run overview.
 *
 * @param run Dashboard run row enriched with evidence counters.
 * @returns Human-readable chat/media count.
 * @sideEffects None.
 */
function evidenceLabel(run: DashboardRun): string {
  const chat = run.chat_message_count ?? 0;
  const media = run.media_count ?? 0;
  if (chat === 0 && media === 0) return '0';
  return `${chat} chat / ${media} media`;
}
