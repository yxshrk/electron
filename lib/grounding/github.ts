// Fetch source files from a public GitHub repo via the REST API (no local clone).
// Used to build the pgvector code index that grounds hypotheses in real files.
// Honors GITHUB_TOKEN for rate limits when present. Server-only.

const SOURCE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rb", "java", "kt",
  "rs", "php", "c", "cc", "cpp", "h", "hpp", "cs", "sql", "vue", "svelte",
]);

export interface RepoFile {
  path: string;
  language: string;
  content: string;
}

function parseRepo(repoUrl: string): { owner: string; repo: string } {
  const m = repoUrl.replace(/\.git$/, "").match(/github\.com[/:]([^/]+)\/([^/]+)/);
  if (!m) throw new Error(`Not a GitHub URL: ${repoUrl}`);
  return { owner: m[1], repo: m[2] };
}

function gh(headersExtra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "reflex-grounding",
    ...headersExtra,
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

export async function fetchRepoFiles(
  repoUrl: string,
  opts: { maxFiles?: number; maxBytes?: number } = {}
): Promise<RepoFile[]> {
  const maxFiles = opts.maxFiles ?? 40;
  const maxBytes = opts.maxBytes ?? 60_000;
  const { owner, repo } = parseRepo(repoUrl);

  const meta = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: gh() });
  if (!meta.ok) throw new Error(`GitHub repo lookup failed (${meta.status})`);
  const branch = (await meta.json()).default_branch as string;

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: gh() }
  );
  if (!treeRes.ok) throw new Error(`GitHub tree fetch failed (${treeRes.status})`);
  const tree = (await treeRes.json()).tree as Array<{ path: string; type: string; size?: number }>;

  const candidates = tree
    .filter((t) => t.type === "blob")
    .filter((t) => SOURCE_EXT.has(t.path.split(".").pop() ?? ""))
    .filter((t) => !/node_modules|\/dist\/|\/build\/|\.min\./.test(t.path))
    .filter((t) => (t.size ?? 0) <= maxBytes)
    .slice(0, maxFiles);

  const files: RepoFile[] = [];
  for (const c of candidates) {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${c.path}`,
      { headers: gh({ Accept: "text/plain" }) }
    );
    if (!raw.ok) continue;
    const content = await raw.text();
    files.push({ path: c.path, language: c.path.split(".").pop() ?? "unknown", content });
  }
  return files;
}
