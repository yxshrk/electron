// Read-only run list. No mutation buttons (confirmation/dispatch live in the recorder/Slack/backend).
import { dbSelect } from "@/lib/insforge/db";
import type { ReflexRunRow } from "@/lib/insforge/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Dashboard() {
  let runs: ReflexRunRow[] = [];
  let error: string | null = null;
  try {
    runs = await dbSelect<ReflexRunRow>("reflex_runs", "order=created_at.desc&limit=100");
  } catch (e) {
    error = String(e);
  }

  return (
    <>
      <h1>Runs</h1>
      {error && <div className="panel" style={{ borderColor: "var(--bad)" }}>{error}</div>}
      <div className="panel">
        {runs.length === 0 ? (
          <p className="muted">No runs yet. Start one from the <a className="link" href="/">home page</a>.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Run</th><th>Mode</th><th>Role</th><th>Status</th><th>Repo</th><th>Created</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><a className="link" href={`/dashboard/${r.id}`}>{r.run_key}</a></td>
                  <td><span className="pill">{r.mode}</span></td>
                  <td>{r.role}</td>
                  <td>{r.status}</td>
                  <td className="muted">{r.repo_url.replace("https://github.com/", "")}</td>
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
