/**
 * Wraps every /dashboard route with a persistent left sidebar.
 *
 * @param children Dashboard page content.
 * @returns Layout with sidebar navigation alongside the page body.
 * @sideEffects None.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-shell">
      <aside className="sidebar" aria-label="Dashboard navigation">
        <p className="sidebar-eyebrow">Reflex</p>
        <nav className="sidebar-nav">
          <a className="sidebar-link" href="/dashboard">Diagnoses</a>
          <a className="sidebar-link" href="/dashboard?view=needs_confirmation">Needs confirmation</a>
          <a className="sidebar-link" href="/dashboard?view=diagnosed">Diagnosed</a>
          <a className="sidebar-link" href="/dashboard?view=pr_opened">PR opened</a>
          <a className="sidebar-link" href="/dashboard?view=failed">Failed</a>
        </nav>
      </aside>
      <div className="dashboard-main">{children}</div>
    </div>
  );
}
