// Client-side capture: instrument a (same-origin) target window so we record a structured timeline
// — clicks, navigation, network calls (url + status + duration), console errors, and uncaught errors.
// This is the high-signal "what actually happened" the diagnosis turns into precise anchors.
// Cross-origin targets can't be instrumented (browser security); fall back to frames+vision there.

export type CaptureEventType = "click" | "navigation" | "network" | "console" | "error";

export interface CaptureEvent {
  tMs: number; // ms since capture start
  type: CaptureEventType;
  detail: string;
  meta?: Record<string, unknown>;
}

export interface CaptureController {
  events: CaptureEvent[];
  stop: () => CaptureEvent[];
  onEvent?: (e: CaptureEvent) => void;
}

/** Instrument `win` (e.g. an iframe's contentWindow). Returns a controller holding the event buffer. */
export function startCapture(win: Window, onEvent?: (e: CaptureEvent) => void): CaptureController {
  const w = win as Window & typeof globalThis;
  const start = performance.now();
  const events: CaptureEvent[] = [];
  const push = (type: CaptureEventType, detail: string, meta?: Record<string, unknown>) => {
    const e: CaptureEvent = { tMs: Math.round(performance.now() - start), type, detail, meta };
    events.push(e);
    onEvent?.(e);
  };

  // ---- network (fetch) ----
  const origFetch = w.fetch;
  w.fetch = async function patched(...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
    const t0 = performance.now();
    try {
      const res = await origFetch.apply(w, args as never);
      const dur = Math.round(performance.now() - t0);
      push("network", `${res.status} ${shortUrl(url)} (${dur}ms)`, { url, status: res.status, durationMs: dur });
      return res;
    } catch (err) {
      const dur = Math.round(performance.now() - t0);
      push("network", `ERR ${shortUrl(url)} (${dur}ms)`, { url, status: 0, durationMs: dur, error: String(err) });
      throw err;
    }
  } as typeof fetch;

  // ---- console.error / warn ----
  const origError = w.console.error;
  w.console.error = function patched(...a: unknown[]) {
    push("console", a.map(String).join(" ").slice(0, 300), { level: "error" });
    return origError.apply(w.console, a as never);
  };

  // ---- uncaught errors + rejections ----
  const onErr = (ev: ErrorEvent) => push("error", ev.message?.slice(0, 300) ?? "error", { source: ev.filename });
  const onRej = (ev: PromiseRejectionEvent) => push("error", `unhandled: ${String(ev.reason).slice(0, 300)}`);
  w.addEventListener("error", onErr);
  w.addEventListener("unhandledrejection", onRej);

  // ---- clicks (capture the label/text the user pressed) ----
  const onClick = (ev: Event) => {
    const t = ev.target as HTMLElement | null;
    const label = (t?.innerText || t?.getAttribute?.("aria-label") || t?.tagName || "").trim().slice(0, 60);
    if (label) push("click", label, { tag: t?.tagName });
  };
  w.document.addEventListener("click", onClick, true);

  // ---- navigation ----
  const onNav = () => push("navigation", w.location?.pathname ?? "");
  w.addEventListener("popstate", onNav);
  w.addEventListener("hashchange", onNav);

  return {
    events,
    onEvent,
    stop() {
      try {
        w.fetch = origFetch;
        w.console.error = origError;
        w.removeEventListener("error", onErr);
        w.removeEventListener("unhandledrejection", onRej);
        w.document.removeEventListener("click", onClick, true);
        w.removeEventListener("popstate", onNav);
        w.removeEventListener("hashchange", onNav);
      } catch {
        /* iframe may be gone */
      }
      return events;
    },
  };
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url, "http://x");
    return u.pathname + (u.search ? u.search.slice(0, 40) : "");
  } catch {
    return url.slice(0, 80);
  }
}
