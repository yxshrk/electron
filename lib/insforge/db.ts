// Thin typed wrapper over the InsForge PostgREST-style Database REST API.
// Docs: `npx @insforge/cli docs db rest-api`. Server-only (uses the admin key).
import { insforgeConfig } from "./env";

function headers(extra?: Record<string, string>): Record<string, string> {
  const { serviceKey } = insforgeConfig();
  return {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function recordsUrl(table: string, query?: string): string {
  const { projectUrl } = insforgeConfig();
  const qs = query ? `?${query}` : "";
  return `${projectUrl}/api/database/records/${table}${qs}`;
}

async function ensureOk(res: Response, op: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`InsForge ${op} failed (${res.status}): ${body.slice(0, 500)}`);
  }
}

/** SELECT rows. `query` is a raw PostgREST query string, e.g. `run_id=eq.${id}&order=created_at.asc`. */
export async function dbSelect<T>(table: string, query?: string): Promise<T[]> {
  const res = await fetch(recordsUrl(table, query), { headers: headers(), cache: "no-store" });
  await ensureOk(res, `select ${table}`);
  return (await res.json()) as T[];
}

/** INSERT a single row and return it. PostgREST requires an array body. */
export async function dbInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(recordsUrl(table), {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify([row]),
  });
  await ensureOk(res, `insert ${table}`);
  const rows = (await res.json()) as T[];
  return rows[0];
}

/** UPDATE rows matching `query` and return them. */
export async function dbUpdate<T>(
  table: string,
  query: string,
  patch: Record<string, unknown>
): Promise<T[]> {
  const res = await fetch(recordsUrl(table, query), {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  await ensureOk(res, `update ${table}`);
  return (await res.json()) as T[];
}

/** DELETE rows matching `query`. */
export async function dbDelete(table: string, query: string): Promise<void> {
  const res = await fetch(recordsUrl(table, query), { method: "DELETE", headers: headers() });
  await ensureOk(res, `delete ${table}`);
}

/** Call a Postgres function (RPC). Args are passed as JSON; vectors as "[..]" strings. */
export async function dbRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { projectUrl } = insforgeConfig();
  const res = await fetch(`${projectUrl}/api/database/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
  });
  await ensureOk(res, `rpc ${fn}`);
  return (await res.json()) as T;
}

/** Bulk insert rows in one request (PostgREST accepts an array body). */
export async function dbInsertMany(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(recordsUrl(table), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(rows),
  });
  await ensureOk(res, `insert-many ${table}`);
}

/** Convenience: fetch a single run by id (or null). */
export async function getRun<T>(runId: string): Promise<T | null> {
  const rows = await dbSelect<T>("reflex_runs", `id=eq.${runId}&limit=1`);
  return rows[0] ?? null;
}
