// Thin typed wrapper over the InsForge PostgREST-style Database REST API.
// Docs: `npx @insforge/cli docs db rest-api`. Server-only (uses the admin key).
import { insforgeConfig } from "./env";

/**
 * Builds authenticated InsForge request headers.
 *
 * @param extra Optional headers merged into the base JSON/admin headers.
 * @returns Headers for InsForge REST requests.
 * @sideEffects Reads InsForge environment configuration.
 */
function headers(extra?: Record<string, string>): Record<string, string> {
  const { serviceKey } = insforgeConfig();
  return {
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Builds an InsForge database records URL.
 *
 * @param table Database table name.
 * @param query Optional raw PostgREST query string.
 * @returns Absolute records API URL.
 * @sideEffects Reads InsForge environment configuration.
 */
function recordsUrl(table: string, query?: string): string {
  const { projectUrl } = insforgeConfig();
  const qs = query ? `?${query}` : "";
  return `${projectUrl}/api/database/records/${table}${qs}`;
}

/**
 * Throws a concise InsForge error when a REST response is not successful.
 *
 * @param res Fetch response from InsForge.
 * @param op Operation label used in the error message.
 * @returns Nothing when the response is successful.
 * @sideEffects Reads up to 500 characters from failed response bodies.
 */
async function ensureOk(res: Response, op: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`InsForge ${op} failed (${res.status}): ${body.slice(0, 500)}`);
  }
}

/**
 * Selects rows from one InsForge table.
 *
 * @param table Database table name.
 * @param query Optional raw PostgREST query string, such as `run_id=eq.${id}&order=created_at.asc`.
 * @returns Selected rows typed by the caller.
 * @sideEffects Performs an InsForge REST read.
 */
export async function dbSelect<T>(table: string, query?: string): Promise<T[]> {
  const res = await fetch(recordsUrl(table, query), { headers: headers(), cache: "no-store" });
  await ensureOk(res, `select ${table}`);
  return (await res.json()) as T[];
}

/**
 * Inserts one row into an InsForge table and returns the created row.
 *
 * @param table Database table name.
 * @param row Row payload to insert.
 * @returns Created row typed by the caller.
 * @sideEffects Performs an InsForge REST write.
 */
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

/**
 * Updates rows matching a PostgREST query and returns the updated rows.
 *
 * @param table Database table name.
 * @param query Raw PostgREST filter query.
 * @param patch Partial row fields to update.
 * @returns Updated rows typed by the caller.
 * @sideEffects Performs an InsForge REST write.
 */
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

/**
 * Deletes rows matching a PostgREST query.
 *
 * @param table Database table name.
 * @param query Raw PostgREST filter query.
 * @returns Nothing after delete completes.
 * @sideEffects Performs an InsForge REST delete.
 */
export async function dbDelete(table: string, query: string): Promise<void> {
  const res = await fetch(recordsUrl(table, query), { method: "DELETE", headers: headers() });
  await ensureOk(res, `delete ${table}`);
}

/**
 * Calls an InsForge Postgres RPC function.
 *
 * @param fn Postgres function name.
 * @param args JSON arguments passed to the function; vector args should be encoded as strings.
 * @returns RPC result typed by the caller.
 * @sideEffects Performs an InsForge REST RPC call.
 */
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

/**
 * Inserts many rows into one InsForge table.
 *
 * @param table Database table name.
 * @param rows Row payloads to insert.
 * @returns Nothing after insert completes.
 * @sideEffects Performs an InsForge REST write unless the input is empty.
 */
export async function dbInsertMany(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(recordsUrl(table), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(rows),
  });
  await ensureOk(res, `insert-many ${table}`);
}

/**
 * Fetches one Reflex run by UUID primary key.
 *
 * @param runId Reflex run UUID.
 * @returns Matching run row or null.
 * @sideEffects Performs an InsForge REST read.
 */
export async function getRun<T>(runId: string): Promise<T | null> {
  const rows = await dbSelect<T>("reflex_runs", `id=eq.${runId}&limit=1`);
  return rows[0] ?? null;
}
