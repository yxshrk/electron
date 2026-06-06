// Grep grounding: find where the symptom's literal anchors (route, button label, error keyword)
// appear in the repo. Precise for code (exact identifiers) in a way symptom->code embeddings are not.
// Reuses the GitHub file fetch; does a literal in-memory search. Returns [] on any failure.
import { fetchRepoFiles } from "./github";

export interface GrepHit {
  filePath: string;
  line: number;
  snippet: string;
  anchor: string;
}

export async function grepRepo(
  repoUrl: string,
  anchors: string[],
  opts: { maxHits?: number; maxFiles?: number } = {}
): Promise<GrepHit[]> {
  const maxHits = opts.maxHits ?? 8;
  const cleaned = [...new Set(anchors.map((a) => a.toLowerCase().trim()).filter((a) => a.length >= 4))];
  if (cleaned.length === 0) return [];

  try {
    const files = await fetchRepoFiles(repoUrl, { maxFiles: opts.maxFiles ?? 60 });
    const hits: GrepHit[] = [];
    const seen = new Set<string>();
    // Rank anchors by specificity (longer first) so the most distinctive tokens win.
    for (const anchor of cleaned.sort((a, b) => b.length - a.length)) {
      for (const f of files) {
        const lines = f.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].toLowerCase().includes(anchor)) continue;
          const key = `${f.path}:${i + 1}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ filePath: f.path, line: i + 1, snippet: lines[i].trim().slice(0, 160), anchor });
          if (hits.length >= maxHits) return hits;
        }
      }
    }
    return hits;
  } catch {
    return [];
  }
}

/** One-line "Candidate files" hint appended to an agent reproduction plan. */
export function grepHint(hits: GrepHit[]): string {
  if (hits.length === 0) return "";
  const files = [...new Set(hits.map((h) => `${h.filePath}:${h.line}`))].slice(0, 4);
  return ` Candidate files (grep-matched from the captured timeline): ${files.join(", ")}.`;
}
