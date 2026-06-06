// Run async work AFTER the HTTP response without it being killed.
// - On Vercel (serverless): use waitUntil so the function stays alive until the promise settles.
// - Locally (long-running `next dev`): fire-and-forget is fine.
// Slack requires an ack within 3s, but gather→draft and confirm→diagnose take longer, so the real
// work has to run in the background — this keeps that reliable on both runtimes.

export function background(promise: Promise<unknown>): void {
  const p = Promise.resolve(promise).catch((err) => {
    console.error('Reflex background task failed', err);
  });

  if (process.env.VERCEL) {
    import('@vercel/functions')
      .then(({ waitUntil }) => waitUntil(p))
      .catch(() => { /* fall through: promise already running */ });
  }
  // local dev: the persistent server keeps `p` alive on its own.
}
