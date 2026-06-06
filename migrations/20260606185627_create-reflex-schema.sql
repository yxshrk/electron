-- Reflex MVP schema
-- Source of truth: TECHNICAL_DOCUMENT.md §7 (Data Model) + developer_plans/shared-contracts.md
-- Owner: Yash (only Yash writes migrations — shared-contracts §4).
-- No BEGIN/COMMIT: InsForge runs each migration in a backend-managed transaction.

-- 1. capture_sessions — one bug report run; the shared source of truth.
--    status drives the whole pipeline (shared-contracts §2 state machine).
create table capture_sessions (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'web',          -- 'slack' | 'web' | 'manual'
  role          text not null,                         -- 'sales' | 'ceo' | 'product' | 'engineer' (diagnostic lens, §5)
  repo_url      text not null,
  status        text not null default 'created',
  slack_context jsonb,                                 -- { channelId, threadTs, userId } when source='slack' (Laurence → Yash, routes status back)
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  constraint capture_sessions_status_chk check (status in (
    'created','observed','diagnosed','confirmed','dispatched','reproduced','fixed','shipped',
    'diagnosis_failed','dispatch_failed','reproduction_failed','pr_failed'
  ))
);

-- 2. observations — the original source-of-truth report (transcript chunks + media).
--    Laurence uploads media to Storage and inserts the row; Yash reads it for extraction.
create table observations (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references capture_sessions(id) on delete cascade,
  kind          text not null default 'transcript',    -- 'transcript' | 'screenshot' | 'recording'
  transcript    text not null default '',
  storage_key   text,                                  -- InsForge Storage key in bucket 'reflex-evidence'
  screenshot_url text,
  visible_state jsonb not null default '{}'::jsonb,     -- multimodal extraction output (Yash)
  timestamp_ms  bigint,
  created_at    timestamptz not null default now()
);
create index observations_session_id_idx on observations(session_id);

-- 3. diagnoses — role-aware structured symptom + evidence.
create table diagnoses (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references capture_sessions(id) on delete cascade,
  symptom     text not null,
  role_lens   text not null,
  evidence    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index diagnoses_session_id_idx on diagnoses(session_id);

-- 4. hypotheses — ranked candidates; expected_failure feeds DispatchInput (C3).
create table hypotheses (
  id                uuid primary key default gen_random_uuid(),
  diagnosis_id      uuid not null references diagnoses(id) on delete cascade,
  title             text not null,
  confidence        numeric not null default 0,
  reproduction_plan text not null,
  expected_failure  text not null default '',
  status            text not null default 'pending',   -- pending | running | reproduced | rejected | fixed
  created_at        timestamptz not null default now()
);
create index hypotheses_diagnosis_id_idx on hypotheses(diagnosis_id);

-- 5. agent_runs — one Replicas/scripted run per dispatched hypothesis (Luke writes).
create table agent_runs (
  id            uuid primary key default gen_random_uuid(),
  hypothesis_id uuid references hypotheses(id) on delete set null,
  provider      text not null,                         -- 'replicas' | 'scripted' | 'devin'
  status        text not null default 'pending',
  sandbox_url   text,
  logs_url      text,
  result        jsonb not null default '{}'::jsonb,    -- EvidencePayload (C4)
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index agent_runs_hypothesis_id_idx on agent_runs(hypothesis_id);

-- 6. pull_requests — the PR linked back to the source report (Luke writes).
create table pull_requests (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references capture_sessions(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  github_url   text not null,
  root_cause   text not null default '',
  summary      text not null,                          -- fix summary (EvidencePayload.fixSummary)
  verification text not null,
  created_at   timestamptz not null default now()
);
create index pull_requests_session_id_idx on pull_requests(session_id);
