import { Pool, type QueryResultRow } from "pg";
import { config } from "../config.js";

let pool: Pool | null = null;
let initialized = false;

function canUsePostgres(): boolean {
  return config.ai.persistenceBackend === "postgres" && Boolean(config.databaseUrl);
}

function getPool(): Pool | null {
  if (!canUsePostgres()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000
    });
  }

  return pool;
}

export async function initAiPersistenceSchema(): Promise<boolean> {
  const db = getPool();
  if (!db) {
    return false;
  }

  if (initialized) {
    return true;
  }

  try {
    await db.query(`create extension if not exists "pgcrypto";`);

    await db.query(`
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
    `);

    await db.query(`
      create table if not exists ai_judge_routing (
        task text primary key,
        provider text not null,
        model text not null,
        temperature double precision not null,
        updated_at timestamptz not null default now(),
        constraint ai_judge_routing_task_chk
          check (task in ('analysis', 'reels', 'newsletter', 'linkedin', 'x')),
        constraint ai_judge_routing_provider_chk
          check (provider in ('heuristic', 'openai', 'openrouter'))
      );
    `);

    await db.query(`
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
        unique(task, version)
      );
    `);

    await db.query(`
      create unique index if not exists idx_ai_prompt_active_per_task
      on ai_prompt_versions(task)
      where is_active = true;
    `);

    await db.query(`
      create table if not exists ai_workspace_preferences (
        id text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);

    await db.query(`
      create table if not exists app_store_snapshots (
        id text primary key,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);

    initialized = true;
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown postgres init error";
    console.warn(`[ai] failed to initialize postgres persistence, using memory fallback: ${reason}`);
    return false;
  }
}

export async function queryAiPersistence<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[] | null> {
  const db = getPool();
  if (!db) {
    return null;
  }

  try {
    const result = await db.query<T>(text, values);
    return result.rows;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown postgres query error";
    console.warn(`[ai] postgres query failed, using memory fallback: ${reason}`);
    return null;
  }
}
