-- Authority Distribution Engine - initial schema
-- PostgreSQL 16+

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  plan text not null default 'premium',
  created_at timestamptz not null default now()
);

create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  primary_color text not null,
  secondary_color text not null,
  background_style text not null,
  font_family text not null,
  logo_url text,
  layout_preset text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  default_brand_kit_id uuid references brand_kits(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists srt_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  filename text not null,
  s3_url text,
  language text not null default 'pt-BR',
  duration_sec int,
  status text not null,
  created_at timestamptz not null default now(),
  constraint srt_assets_status_chk
    check (status in ('uploaded', 'parsed', 'processing', 'done', 'failed'))
);

create table if not exists transcript_segments (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  start_ms int not null,
  end_ms int not null,
  text text not null,
  tokens_est int not null,
  idx int not null,
  unique (srt_asset_id, idx)
);

create table if not exists narrative_analysis (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  thesis text not null,
  topics jsonb not null,
  audience_guess jsonb not null,
  content_type text not null,
  polarity_score int not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint narrative_analysis_content_type_chk
    check (content_type in ('educational', 'provocative', 'story', 'framework')),
  constraint narrative_analysis_polarity_chk
    check (polarity_score between 0 and 10)
);

create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  start_ms int not null,
  end_ms int not null,
  hook_strength int not null,
  clarity int not null,
  insight_density int not null,
  reason text not null,
  quote text,
  constraint highlights_hook_strength_chk check (hook_strength between 0 and 10),
  constraint highlights_clarity_chk check (clarity between 0 and 10),
  constraint highlights_insight_density_chk check (insight_density between 0 and 10)
);

create table if not exists generated_assets (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  type text not null,
  version int not null default 1,
  payload jsonb not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint generated_assets_type_chk
    check (type in ('reels', 'newsletter', 'linkedin', 'x', 'carousel', 'covers', 'analysis')),
  constraint generated_assets_status_chk
    check (status in ('pending', 'ready', 'failed'))
);

create table if not exists rendered_files (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  kind text not null,
  idx int,
  url text not null,
  width int,
  height int,
  created_at timestamptz not null default now(),
  constraint rendered_files_kind_chk
    check (kind in ('carousel_slide', 'cover_newsletter', 'cover_linkedin', 'zip'))
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  srt_asset_id uuid not null references srt_assets(id) on delete cascade,
  name text not null,
  status text not null,
  attempts int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint jobs_status_chk check (status in ('queued', 'running', 'succeeded', 'failed'))
);

create table if not exists ai_routing (
  task text primary key,
  provider text not null,
  model text not null,
  temperature double precision not null,
  updated_at timestamptz not null default now(),
  constraint ai_routing_task_chk
    check (task in ('analysis', 'reels', 'newsletter', 'linkedin', 'x')),
  constraint ai_routing_provider_chk
    check (provider in ('heuristic', 'openai', 'openrouter'))
);

create table if not exists ai_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  version int not null,
  name text not null,
  system_prompt text not null,
  user_prompt_template text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint ai_prompt_versions_task_chk
    check (task in ('analysis', 'reels', 'newsletter', 'linkedin', 'x')),
  unique (task, version)
);

create index if not exists idx_srt_assets_project on srt_assets(project_id);
create index if not exists idx_transcript_segments_srt on transcript_segments(srt_asset_id);
create index if not exists idx_jobs_srt_created_at on jobs(srt_asset_id, created_at desc);
create unique index if not exists idx_ai_prompt_active_per_task on ai_prompt_versions(task) where is_active = true;
