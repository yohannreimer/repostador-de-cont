import type {
  AIRoute,
  AIRouting,
  AIRoutingResponse,
  AIProvider,
  AITask
} from "@authority/shared";
import type { QueryResultRow } from "pg";
import { config } from "../config.js";
import { initAiPersistenceSchema, queryAiPersistence } from "../storage/postgres.js";

export const AI_TASKS: AITask[] = [
  "analysis",
  "reels",
  "newsletter",
  "linkedin",
  "x"
];

interface PostgresRouteRow extends QueryResultRow {
  task: AITask;
  provider: AIProvider;
  model: string;
  temperature: number;
}

type RouteKind = "generation" | "judge";

type RoutingPatch = Partial<Record<AITask, Partial<AIRoute>>>;

type RoutingPatchInput =
  | RoutingPatch
  | {
      routing?: RoutingPatch;
      judgeRouting?: RoutingPatch;
    };

function defaultModelByProvider(provider: AIProvider): string {
  if (provider === "openai") {
    return "gpt-5-mini";
  }

  if (provider === "openrouter") {
    return "openrouter/auto";
  }

  return "heuristic-v1";
}

function parseProvider(raw: string | undefined, fallback: AIProvider): AIProvider {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "openai" || normalized === "openrouter" || normalized === "heuristic") {
    return normalized;
  }

  return fallback;
}

function parseTemperature(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(1.5, Math.max(0, value));
}

function cloneRouting(routing: AIRouting): AIRouting {
  return JSON.parse(JSON.stringify(routing)) as AIRouting;
}

function preferredJudgeProvider(): AIProvider {
  if (config.ai.openai.apiKey) {
    return "openai";
  }
  if (config.ai.openrouter.apiKey) {
    return "openrouter";
  }
  return "heuristic";
}

function buildInitialRouting(kind: RouteKind): AIRouting {
  const envPrefix = kind === "judge" ? "AI_JUDGE_" : "AI_";
  const fallbackProvider: AIProvider =
    kind === "judge" ? preferredJudgeProvider() : "heuristic";
  const defaultProvider = parseProvider(
    process.env[`${envPrefix}PROVIDER_DEFAULT`] ?? process.env.AI_PROVIDER_DEFAULT,
    fallbackProvider
  );
  const defaultModel =
    process.env[`${envPrefix}MODEL_DEFAULT`]?.trim() ||
    process.env.AI_MODEL_DEFAULT?.trim() ||
    defaultModelByProvider(defaultProvider);
  const defaultTemperature = parseTemperature(
    process.env[`${envPrefix}TEMPERATURE_DEFAULT`] ?? process.env.AI_TEMPERATURE_DEFAULT,
    kind === "judge" ? 0.2 : 0.3
  );

  const entries = AI_TASKS.map((task) => {
    const provider = parseProvider(
      process.env[`${envPrefix}PROVIDER_${task.toUpperCase()}`] ??
        process.env[`AI_PROVIDER_${task.toUpperCase()}`],
      defaultProvider
    );

    const model =
      process.env[`${envPrefix}MODEL_${task.toUpperCase()}`]?.trim() ||
      process.env[`AI_MODEL_${task.toUpperCase()}`]?.trim() ||
      (provider === defaultProvider ? defaultModel : defaultModelByProvider(provider));

    const temperature = parseTemperature(
      process.env[`${envPrefix}TEMPERATURE_${task.toUpperCase()}`] ??
        process.env[`AI_TEMPERATURE_${task.toUpperCase()}`],
      defaultTemperature
    );

    return [
      task,
      {
        provider,
        model,
        temperature
      }
    ] as const;
  });

  return Object.fromEntries(entries) as AIRouting;
}

const routingState: AIRouting = buildInitialRouting("generation");
const judgeRoutingState: AIRouting = buildInitialRouting("judge");

async function ensureRoutingTableDefaults(
  table: "ai_routing" | "ai_judge_routing",
  state: AIRouting
): Promise<void> {
  const rows = await queryAiPersistence<PostgresRouteRow>(
    `select task, provider, model, temperature from ${table}`
  );

  if (!rows) {
    return;
  }

  if (rows.length === 0) {
    for (const task of AI_TASKS) {
      const route = state[task];
      await queryAiPersistence(
        `
          insert into ${table} (task, provider, model, temperature)
          values ($1, $2, $3, $4)
          on conflict (task) do nothing
        `,
        [task, route.provider, route.model, route.temperature]
      );
    }
    return;
  }

  for (const row of rows) {
    state[row.task] = {
      provider: row.provider,
      model: row.model,
      temperature: Math.max(0, Math.min(1.5, row.temperature))
    };
  }
}

export async function initializeAiRouting(): Promise<void> {
  const hasPostgres = await initAiPersistenceSchema();
  if (!hasPostgres) {
    return;
  }

  await ensureRoutingTableDefaults("ai_routing", routingState);
  await ensureRoutingTableDefaults("ai_judge_routing", judgeRoutingState);
}

export function getRouteForTask(task: AITask, kind: RouteKind = "generation"): AIRoute {
  const source = kind === "judge" ? judgeRoutingState : routingState;
  return { ...source[task] };
}

export function getJudgeRouteForTask(task: AITask): AIRoute {
  return getRouteForTask(task, "judge");
}

export function isProviderConfigured(provider: AIProvider): boolean {
  if (provider === "heuristic") {
    return true;
  }

  if (provider === "openai") {
    return Boolean(config.ai.openai.apiKey);
  }

  return Boolean(config.ai.openrouter.apiKey);
}

function normalizeRoutingPatchInput(input: RoutingPatchInput): {
  routingPatch: RoutingPatch;
  judgeRoutingPatch: RoutingPatch;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { routingPatch: {}, judgeRoutingPatch: {} };
  }

  if ("routing" in input || "judgeRouting" in input) {
    return {
      routingPatch:
        input.routing && typeof input.routing === "object"
          ? (input.routing as RoutingPatch)
          : {},
      judgeRoutingPatch:
        input.judgeRouting && typeof input.judgeRouting === "object"
          ? (input.judgeRouting as RoutingPatch)
          : {}
    };
  }

  return {
    routingPatch: input as RoutingPatch,
    judgeRoutingPatch: {}
  };
}

function applyRoutingPatch(state: AIRouting, patch: RoutingPatch): void {
  for (const task of AI_TASKS) {
    const nextPatch = patch[task];
    if (!nextPatch) {
      continue;
    }

    const current = state[task];
    const provider = nextPatch.provider ?? current.provider;
    const model = nextPatch.model?.trim() || current.model;

    let temperature = current.temperature;
    if (typeof nextPatch.temperature === "number" && !Number.isNaN(nextPatch.temperature)) {
      temperature = Math.max(0, Math.min(1.5, nextPatch.temperature));
    }

    state[task] = {
      provider,
      model,
      temperature
    };
  }
}

async function persistRoutingState(
  table: "ai_routing" | "ai_judge_routing",
  state: AIRouting
): Promise<void> {
  for (const task of AI_TASKS) {
    const route = state[task];
    await queryAiPersistence(
      `
        insert into ${table} (task, provider, model, temperature)
        values ($1, $2, $3, $4)
        on conflict (task)
        do update set
          provider = excluded.provider,
          model = excluded.model,
          temperature = excluded.temperature,
          updated_at = now()
      `,
      [task, route.provider, route.model, route.temperature]
    );
  }
}

export async function updateAiRouting(
  input: RoutingPatchInput
): Promise<{ routing: AIRouting; judgeRouting: AIRouting }> {
  const { routingPatch, judgeRoutingPatch } = normalizeRoutingPatchInput(input);
  applyRoutingPatch(routingState, routingPatch);
  applyRoutingPatch(judgeRoutingState, judgeRoutingPatch);

  const hasPostgres = await initAiPersistenceSchema();
  if (hasPostgres) {
    await persistRoutingState("ai_routing", routingState);
    await persistRoutingState("ai_judge_routing", judgeRoutingState);
  }

  return {
    routing: cloneRouting(routingState),
    judgeRouting: cloneRouting(judgeRoutingState)
  };
}

export function getAiRoutingResponse(): AIRoutingResponse {
  return {
    routing: cloneRouting(routingState),
    judgeRouting: cloneRouting(judgeRoutingState),
    configuredKeys: {
      openai: Boolean(config.ai.openai.apiKey),
      openrouter: Boolean(config.ai.openrouter.apiKey)
    }
  };
}
