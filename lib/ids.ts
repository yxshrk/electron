import { randomUUID } from "crypto";

/** Short unique key with a readable prefix, e.g. run_lq2k9z_3f1a. */
export function shortKey(prefix: string): string {
  const id = randomUUID().replace(/-/g, "");
  return `${prefix}_${id.slice(0, 6)}_${id.slice(6, 10)}`;
}
