import type {
  AIPreferences,
  AIPreferencesResponse,
  AITask,
  OpenRouterModelFamily,
  OpenRouterModelFamilyByTask
} from "@authority/shared";
import type { QueryResultRow } from "pg";
import { defaultGenerationProfile, mergeGenerationProfile } from "./generationProfileService.js";
import { initAiPersistenceSchema, queryAiPersistence } from "../storage/postgres.js";

const AI_TASKS: AITask[] = ["analysis", "reels", "newsletter", "linkedin", "x"];
const MODEL_FAMILIES: OpenRouterModelFamily[] = [
  "top",
  "claude",
  "gemini",
  "openai",
  "deepseek",
  "others"
];
const PREFERENCES_ID = "global";

interface PreferencesRow extends QueryResultRow {
  id: string;
  payload: unknown;
  updated_at: Date | string;
}

interface UpdatePreferencesPatch {
  generationProfile?: unknown;
  modelFamilyByTask?: unknown;
}

interface PreferencesState {
  preferences: AIPreferences;
  updatedAt: string;
}

function defaultModelFamilyByTask(): OpenRouterModelFamilyByTask {
  return {
    analysis: "top",
    reels: "top",
    newsletter: "top",
    linkedin: "top",
    x: "top"
  };
}

function defaultPreferences(): AIPreferences {
  return {
    generationProfile: defaultGenerationProfile(),
    modelFamilyByTask: defaultModelFamilyByTask()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeModelFamily(raw: unknown, fallback: OpenRouterModelFamily): OpenRouterModelFamily {
  if (typeof raw !== "string") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase() as OpenRouterModelFamily;
  return MODEL_FAMILIES.includes(normalized) ? normalized : fallback;
}

function sanitizeModelFamilyByTask(raw: unknown): OpenRouterModelFamilyByTask {
  const base = defaultModelFamilyByTask();
  if (!isRecord(raw)) {
    return base;
  }

  const next = { ...base };
  for (const task of AI_TASKS) {
    next[task] = sanitizeModelFamily(raw[task], base[task]);
  }
  return next;
}

function normalizePreferences(raw: unknown): AIPreferences {
  const base = defaultPreferences();
  if (!isRecord(raw)) {
    return base;
  }

  const generationProfile = mergeGenerationProfile(base.generationProfile, raw.generationProfile);
  const modelFamilyByTask = sanitizeModelFamilyByTask(raw.modelFamilyByTask);
  return {
    generationProfile,
    modelFamilyByTask
  };
}

function clonePreferences(preferences: AIPreferences): AIPreferences {
  return JSON.parse(JSON.stringify(preferences)) as AIPreferences;
}

const preferencesState: PreferencesState = {
  preferences: defaultPreferences(),
  updatedAt: new Date().toISOString()
};

async function persistPreferences(state: PreferencesState): Promise<void> {
  await queryAiPersistence(
    `
      insert into ai_workspace_preferences (id, payload, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set
        payload = excluded.payload,
        updated_at = now()
    `,
    [PREFERENCES_ID, JSON.stringify(state.preferences)]
  );
}

export async function initializeAiPreferences(): Promise<void> {
  const hasPostgres = await initAiPersistenceSchema();
  if (!hasPostgres) {
    return;
  }

  const rows = await queryAiPersistence<PreferencesRow>(
    `
      select id, payload, updated_at
      from ai_workspace_preferences
      where id = $1
      limit 1
    `,
    [PREFERENCES_ID]
  );

  if (!rows || rows.length === 0) {
    await persistPreferences(preferencesState);
    return;
  }

  const row = rows[0];
  preferencesState.preferences = normalizePreferences(row.payload);
  preferencesState.updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();
}

export function getAiPreferencesResponse(): AIPreferencesResponse {
  return {
    preferences: clonePreferences(preferencesState.preferences),
    updatedAt: preferencesState.updatedAt
  };
}

export async function updateAiPreferences(
  patch: UpdatePreferencesPatch
): Promise<AIPreferencesResponse> {
  const base = preferencesState.preferences;
  const next: AIPreferences = {
    generationProfile:
      patch.generationProfile !== undefined
        ? mergeGenerationProfile(base.generationProfile, patch.generationProfile)
        : base.generationProfile,
    modelFamilyByTask:
      patch.modelFamilyByTask !== undefined
        ? sanitizeModelFamilyByTask(patch.modelFamilyByTask)
        : base.modelFamilyByTask
  };

  preferencesState.preferences = next;
  preferencesState.updatedAt = new Date().toISOString();

  const hasPostgres = await initAiPersistenceSchema();
  if (hasPostgres) {
    await persistPreferences(preferencesState);
  }

  return getAiPreferencesResponse();
}
