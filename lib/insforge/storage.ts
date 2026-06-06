// Upload artifacts to InsForge Storage (bucket `reflex-evidence`, private).
// Implements the documented upload-strategy flow (handles both local + S3 backends).
// Docs: `npx @insforge/cli docs storage rest-api`. Server-only.
import { insforgeConfig, EVIDENCE_BUCKET } from "./env";

interface UploadStrategy {
  method: "direct" | "presigned";
  uploadUrl: string;
  key: string;
  fields?: Record<string, string>;
  confirmRequired?: boolean;
  confirmUrl?: string;
}

export interface StoredObject {
  bucket: string;
  key: string;
  /** Server-resolvable path for reads (bucket is private; read with the admin key). */
  storageUrl: string;
}

/**
 * Upload bytes to `reflex-evidence/{objectKey}` and return a stored reference.
 * Storage path convention (shared-contracts §7): runs/{runId}/debug/{artifactKey}.
 */
export async function uploadObject(
  objectKey: string,
  bytes: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<StoredObject> {
  const { projectUrl, serviceKey } = insforgeConfig();
  const bucket = EVIDENCE_BUCKET;
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // Step 1: get upload strategy
  const stratRes = await fetch(
    `${projectUrl}/api/storage/buckets/${bucket}/upload-strategy`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: objectKey, contentType, size: data.byteLength }),
    }
  );
  if (!stratRes.ok) {
    const body = await stratRes.text().catch(() => "");
    throw new Error(`storage upload-strategy failed (${stratRes.status}): ${body.slice(0, 300)}`);
  }
  const strategy = (await stratRes.json()) as UploadStrategy;
  const blob = new Blob([data], { type: contentType });

  // Step 2: upload the file
  if (strategy.method === "presigned") {
    const form = new FormData();
    for (const [k, v] of Object.entries(strategy.fields ?? {})) form.append(k, v);
    form.append("file", blob, objectKey);
    const up = await fetch(strategy.uploadUrl, { method: "POST", body: form });
    if (!up.ok) throw new Error(`presigned upload failed (${up.status})`);
    // Step 3: confirm
    if (strategy.confirmRequired && strategy.confirmUrl) {
      const confirm = await fetch(`${projectUrl}${strategy.confirmUrl}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ size: data.byteLength, contentType }),
      });
      if (!confirm.ok) throw new Error(`confirm-upload failed (${confirm.status})`);
    }
  } else {
    // direct (local backend): PUT multipart to the returned uploadUrl
    const form = new FormData();
    form.append("file", blob, objectKey);
    const up = await fetch(`${projectUrl}${strategy.uploadUrl}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${serviceKey}` },
      body: form,
    });
    if (!up.ok) {
      const body = await up.text().catch(() => "");
      throw new Error(`direct upload failed (${up.status}): ${body.slice(0, 300)}`);
    }
  }

  return {
    bucket,
    key: strategy.key,
    storageUrl: `${projectUrl}/api/storage/buckets/${bucket}/objects/${strategy.key}`,
  };
}
