// Ground a symptom in the indexed codebase: embed the symptom and find the nearest code chunks.
// Returns [] (never throws) when the index is empty or no model key is configured, so diagnosis
// degrades gracefully to ungrounded hypotheses.
import { dbRpc } from "@/lib/insforge/db";
import { embed, hasModelKey } from "@/lib/ai/gateway";

export interface GroundedChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  similarity: number;
  snippet: string;
}

interface MatchRow {
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  similarity: number;
}

export async function groundSymptom(
  repoUrl: string,
  symptom: string,
  matchCount = 5
): Promise<GroundedChunk[]> {
  if (!hasModelKey()) return [];
  try {
    const [vec] = await embed([symptom]);
    if (!vec) return [];
    const rows = await dbRpc<MatchRow[]>("match_code_chunks", {
      query_embedding: `[${vec.join(",")}]`,
      match_repo: repoUrl,
      match_count: matchCount,
    });
    return rows.map((r) => ({
      filePath: r.file_path,
      startLine: r.start_line,
      endLine: r.end_line,
      similarity: r.similarity,
      snippet: r.content.slice(0, 240),
    }));
  } catch {
    return [];
  }
}

/** One-line "Candidate files" hint to append to an agent reproduction plan. */
export function groundingHint(chunks: GroundedChunk[]): string {
  if (chunks.length === 0) return "";
  const files = chunks.map((c) => `${c.filePath}:${c.startLine}-${c.endLine}`).slice(0, 4);
  return ` Candidate files (grounded in the repo): ${files.join(", ")}.`;
}
