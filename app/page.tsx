export default function Home() {
  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: 40, lineHeight: 1.6 }}>
      <h1>Reflex</h1>
      <p>From a complaint to a merged PR, without a single ticket written.</p>
      <p>Slack intake is live at <code>/api/slack/reflex-command</code>. Try <code>/reflex</code> in Slack.</p>
    </main>
  );
}
