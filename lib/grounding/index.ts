// Index a repo into pgvector: fetch source -> chunk -> embed -> upsert into code_chunks.
// Re-indexing replaces the repo's existing chunks. Server-only.
import { dbDelete, dbInsertMany } from "@/lib/insforge/db";
import { embed } from "@/lib/ai/gateway";
import { fetchRepoFiles } from "./github";

const CHUNK_LINES = 120;
const EMBED_BATCH = 64;

interface Chunk {
  repo_url: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
}

function chunkFile(repoUrl: string, path: string, language: string, content: string): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const slice = lines.slice(i, i + CHUNK_LINES);
    const text = slice.join("\n").trim();
    if (!text) continue;
    chunks.push({
      repo_url: repoUrl,
      file_path: path,
      language,
      start_line: i + 1,
      end_line: Math.min(i + CHUNK_LINES, lines.length),
      content: text.slice(0, 8000),
    });
  }
  return chunks;
}

export interface IndexResult {
  repoUrl: string;
  files: number;
  chunks: number;
}

export async function indexRepo(repoUrl: string): Promise<IndexResult> {
  const files = await fetchRepoFiles(repoUrl);
  const chunks = files.flatMap((f) => chunkFile(repoUrl, f.path, f.language, f.content));

  await dbDelete("code_chunks", `repo_url=eq.${encodeURIComponent(repoUrl)}`);

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => `${c.file_path}\n${c.content}`));
    const rows = batch.map((c, j) => ({
      ...c,
      embedding: `[${vectors[j].join(",")}]`, // pgvector text literal
    }));
    await dbInsertMany("code_chunks", rows);
  }

  return { repoUrl, files: files.length, chunks: chunks.length };
}
