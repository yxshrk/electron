import { getDashboardRuns } from '@/lib/dashboard/read-model';

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

  return (
    <>
      <div className="page-title">
        <div>
          <h1>Reflex Runs</h1>
          <p className="muted">Read-only diagnosis and evidence overview.</p>
        </div>
        <span className={`pill ${source === 'insforge' ? 'good' : 'warn'}`}>
          {source === 'insforge' ? 'InsForge' : 'Demo fixture'}
        </span>
      </div>
      {error && <div className="panel notice">Showing fixture data because InsForge is not connected: {error}</div>}
      <div className="panel">
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Role</th>
                <th>Summary</th>
                <th>Evidence</th>
                <th>PR</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><a className="link" href={`/dashboard/${r.id}`}>{r.run_key}</a></td>
                  <td>{r.status}</td>
                  <td><span className="pill">{r.mode}</span></td>
                  <td>{r.role}</td>
                  <td>{r.summary ?? r.repo_url.replace('https://github.com/', '')}</td>
                  <td>{r.media_count ?? '-'}</td>
                  <td>{r.pr_url ? <a className="link" href={r.pr_url}>open</a> : '-'}</td>
                  <td className="muted">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
