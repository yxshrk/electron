import { getDashboardRuns } from '@/lib/dashboard/read-model';
import {
  actorLabel,
  DASHBOARD_RUN_FILTERS,
  dashboardOwners,
  evidenceLabel,
  evidenceTotalCount,
  filterDashboardRuns,
  formatDate,
  parseDashboardRunFilter,
  statusLabel,
  statusTone,
  type DashboardRunFilter
} from '@/lib/dashboard/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Renders the top-level Reflex dashboard run list.
 *
 * @param props Search parameters used to filter the diagnosis queue.
 * @returns Server-rendered table of Reflex runs with source metadata.
 * @sideEffects Reads from InsForge when backend credentials are configured.
 */
export default async function Dashboard({
  searchParams
}: {
  searchParams?: { view?: string; owner?: string };
}) {
  const { runs, source, error } = await getDashboardRuns();
  const activeFilter = parseDashboardRunFilter(searchParams?.view);
  const ownerOptions = dashboardOwners(runs);
  const activeOwner = ownerOptions.includes(searchParams?.owner ?? '') ? searchParams?.owner : undefined;
  const filteredRuns = filterDashboardRuns(runs, activeFilter, activeOwner);
  const diagnosedRuns = filteredRuns.filter((run) => run.diagnosis_state === 'diagnosed').length;
  const evidenceCount = filteredRuns.reduce((total, run) => total + evidenceTotalCount(run), 0);
  const prCount = filteredRuns.filter((run) => Boolean(run.pr_url)).length;

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
          <strong>{filteredRuns.length}</strong>
          <span className="metric-note">{filteredRuns.length === runs.length ? 'latest 100' : `filtered from ${runs.length}`}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Diagnosed</span>
          <strong>{diagnosedRuns}</strong>
          <span className="metric-note">ready for dispatch</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Evidence items</span>
          <strong>{evidenceCount}</strong>
          <span className="metric-note">chat + media + debug</span>
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
            <p className="muted">Filter the queue, then click a row to inspect the report, context, attachments, hypotheses, and proof.</p>
          </div>
        </div>
        <div className="filter-bar" aria-label="Dashboard filters">
          <div className="filter-group">
            {DASHBOARD_RUN_FILTERS.map((filter) => (
              <a
                aria-current={activeFilter === filter.value ? 'page' : undefined}
                className={`filter-chip ${activeFilter === filter.value ? 'active' : ''}`}
                href={dashboardHref(filter.value, activeOwner)}
                key={filter.value}
              >
                {filter.label}
              </a>
            ))}
          </div>
          {ownerOptions.length > 0 && (
            <div className="filter-group owner-filter" aria-label="Owner filters">
              <span className="filter-label">Owner</span>
              <a
                aria-current={!activeOwner ? 'page' : undefined}
                className={`filter-chip ${!activeOwner ? 'active' : ''}`}
                href={dashboardHref(activeFilter)}
              >
                All
              </a>
              {ownerOptions.map((owner) => (
                <a
                  aria-current={activeOwner === owner ? 'page' : undefined}
                  className={`filter-chip ${activeOwner === owner ? 'active' : ''}`}
                  href={dashboardHref(activeFilter, owner)}
                  key={owner}
                >
                  {actorLabel(owner)}
                </a>
              ))}
            </div>
          )}
        </div>
        {runs.length === 0 ? (
          <div className="empty-state">
            <strong>No runs yet</strong>
            <p className="muted">Start from Slack or the recorder, then this page becomes the judge-facing data view.</p>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="empty-state">
            <strong>No runs match this filter</strong>
            <p className="muted">Switch back to All to see the full queue.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>Diagnosis</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Evidence</th>
                  <th>Hypotheses</th>
                  <th>PR</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a className="row-link" href={`/dashboard/${run.id}`}>
                        <strong>{run.summary ?? 'Captured issue'}</strong>
                        <span>{run.run_key} · {run.repo_url.replace('https://github.com/', '')}</span>
                      </a>
                    </td>
                    <td><span className="owner-pill">{actorLabel(run.started_by)}</span></td>
                    <td><span className={`status-pill ${statusTone(run.status)}`}>{statusLabel(run.status)}</span></td>
                    <td>
                      <div className="badge-row">
                        <span className="pill">{run.source}</span>
                        <span className="pill">{run.mode}</span>
                        <span className="pill">{run.role}</span>
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
 * Builds a dashboard link for the selected queue and owner filters.
 *
 * @param view Queue filter value.
 * @param owner Optional owner actor filter.
 * @returns Dashboard URL with compact query parameters.
 * @sideEffects None.
 */
function dashboardHref(view: DashboardRunFilter, owner?: string | null): string {
  const params = new URLSearchParams();
  if (view !== 'all') params.set('view', view);
  if (owner) params.set('owner', owner);
  const query = params.toString();
  return query ? `/dashboard?${query}` : '/dashboard';
}
