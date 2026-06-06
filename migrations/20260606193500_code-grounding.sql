-- Codebase grounding via pgvector (developer_plans: Yash's diagnostic memory-graph hook).
-- Embeds repo source chunks so diagnosis can ground hypotheses in real files via symptom->file
-- similarity search. Owner: Yash. No BEGIN/COMMIT (backend-managed transaction).

create extension if not exists vector;

create table code_chunks (
  id          uuid primary key default gen_random_uuid(),
  repo_url    text not null,
  file_path   text not null,
  language    text not null default 'unknown',
  start_line  int  not null default 1,
  end_line    int  not null default 1,
  content     text not null,
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);
create index code_chunks_repo_idx on code_chunks(repo_url);
create index code_chunks_embedding_idx on code_chunks using hnsw (embedding vector_cosine_ops);

-- Cosine similarity search, scoped to one repo. Called as an RPC from diagnosis.
create or replace function match_code_chunks(
  query_embedding vector(1536),
  match_repo text,
  match_count int default 5
) returns table (
  id uuid,
  file_path text,
  start_line int,
  end_line int,
  content text,
  similarity float
) language sql stable as $$
  select c.id, c.file_path, c.start_line, c.end_line, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from code_chunks c
  where c.repo_url = match_repo and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
