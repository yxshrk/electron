// Server-only InsForge config. Never import this from a client component.
// The service key is a full-access admin key (shared-contracts.md §8).

export interface InsforgeConfig {
  projectUrl: string;
  serviceKey: string;
}

export function insforgeConfig(): InsforgeConfig {
  const projectUrl = process.env.INSFORGE_PROJECT_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_KEY;
  if (!projectUrl || !serviceKey) {
    throw new Error(
      "Missing INSFORGE_PROJECT_URL or INSFORGE_SERVICE_KEY. Copy .env.example to .env.local and fill them in."
    );
  }
  return { projectUrl: projectUrl.replace(/\/$/, ""), serviceKey };
}

export const EVIDENCE_BUCKET = "reflex-evidence";
