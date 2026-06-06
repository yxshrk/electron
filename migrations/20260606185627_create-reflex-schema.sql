-- Reflex MVP schema
-- Source of truth: TECHNICAL_DOCUMENT.md Section 7 + developer_plans/shared-contracts.md.
-- Owner: Yash. This migration matches the current two-entrypoint plan:
-- /reflex-bug-mode and /reflex-debug-mode both produce a confirmed intake package.
-- No BEGIN/COMMIT: InsForge runs each migration in a backend-managed transaction.

create table reflex_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  source text not null default 'slack',
  mode text not null default 'bug',
  role text not null default 'sales_csm',
  repo_url text not null,
  command_text text not null default '',
  slack_channel_id text,
  slack_thread_ts text,
  context_window jsonb not null default '{"messageLimit":100,"attachments":3,"maxPromptChars":6000}'::jsonb,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint reflex_runs_mode_chk check (mode in ('bug', 'debug')),
  constraint reflex_runs_status_chk check (status in (
    'created',
    'context_stored',
    'clarifying',
    'report_drafted',
    'package_confirmed',
    'diagnosed',
    'dispatched',
    'reproduced',
    'fixed',
    'shipped',
    'clarification_failed',
    'diagnosis_failed',
    'dispatch_failed',
    'reproduction_failed',
    'pr_failed'
  ))
);

create table slack_context_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  slack_message_ts text not null,
  slack_user_id text,
  text text not null default '',
  permalink text,
  has_files boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index slack_context_messages_run_id_idx on slack_context_messages(run_id);

create table observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  transcript text not null default '',
  screenshot_url text,
  visible_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index observations_run_id_idx on observations(run_id);

create table media_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  artifact_key text not null unique,
  kind text not null,
  source text not null default 'slack_file',
  storage_url text not null,
  slack_file_id text,
  slack_message_ts text,
  thumbnail_url text,
  summary text,
  safe_to_share boolean not null default false,
  created_at timestamptz not null default now(),
  constraint media_artifacts_kind_chk check (kind in (
    'screenshot',
    'video',
    'screen_recording',
    'audio_recording',
    'transcript',
    'log',
    'other'
  )),
  constraint media_artifacts_source_chk check (source in (
    'slack_file',
    'debug_capture',
    'manual_upload',
    'replicas',
    'manual'
  ))
);
create index media_artifacts_run_id_idx on media_artifacts(run_id);

create table bug_briefs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  brief_key text not null unique,
  where_it_happens text not null,
  actual_behavior text not null,
  expected_behavior text,
  reproduction_context text,
  affected_surface text not null default 'unknown',
  evidence_summary jsonb not null default '[]'::jsonb,
  missing_info jsonb not null default '[]'::jsonb,
  agent_prompt_preview text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint bug_briefs_status_chk check (status in ('draft', 'needs_confirmation', 'confirmed', 'rejected'))
);
create index bug_briefs_run_id_idx on bug_briefs(run_id);

create table intake_packages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  bug_brief_id uuid not null references bug_briefs(id) on delete cascade,
  package_key text not null unique,
  chat_history jsonb not null default '[]'::jsonb,
  media_artifacts jsonb not null default '[]'::jsonb,
  debug_capture_artifacts jsonb not null default '[]'::jsonb,
  confirmed_report jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  confirmed_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint intake_packages_status_chk check (status in ('draft', 'confirmed', 'superseded'))
);
create index intake_packages_run_id_idx on intake_packages(run_id);

create table diagnoses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  bug_brief_id uuid not null references bug_briefs(id) on delete cascade,
  intake_package_id uuid not null references intake_packages(id) on delete cascade,
  symptom text not null,
  role_lens text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index diagnoses_run_id_idx on diagnoses(run_id);

create table hypotheses (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references diagnoses(id) on delete cascade,
  title text not null,
  confidence numeric not null default 0,
  reproduction_plan text not null,
  expected_failure text not null default '',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint hypotheses_status_chk check (status in ('pending', 'running', 'reproduced', 'rejected', 'fixed'))
);
create index hypotheses_diagnosis_id_idx on hypotheses(diagnosis_id);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  hypothesis_id uuid references hypotheses(id) on delete set null,
  provider text not null,
  status text not null default 'pending',
  sandbox_url text,
  logs_url text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index agent_runs_hypothesis_id_idx on agent_runs(hypothesis_id);

create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  github_url text not null,
  root_cause text not null default '',
  summary text not null,
  verification text not null,
  created_at timestamptz not null default now()
);
create index pull_requests_run_id_idx on pull_requests(run_id);
