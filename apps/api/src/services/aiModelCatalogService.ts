import type { AIModelsResponse, AIModelOption } from "@authority/shared";
import { config } from "../config.js";

type ProviderWithCatalog = "openai" | "openrouter";

const CACHE_TTL_MS = 5 * 60_000;

const FALLBACK_MODELS: Record<ProviderWithCatalog, AIModelOption[]> = {
  openai: [
    {
      id: "gpt-5.1",
      name: "GPT-5.1",
      provider: "openai",
      contextLength: null,
      description: "Latest flagship"
    },
    {
      id: "gpt-5",
      name: "GPT-5",
      provider: "openai",
      contextLength: null,
      description: "High quality reasoning and generation"
    },
    {
      id: "gpt-5-mini",
      name: "GPT-5 mini",
      provider: "openai",
      contextLength: null,
      description: "Balanced speed and quality"
    },
    {
      id: "gpt-5-nano",
      name: "GPT-5 nano",
      provider: "openai",
      contextLength: null,
      description: "Low-latency and low-cost"
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      provider: "openai",
      contextLength: null,
      description: "Reasoning-optimized compact model"
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      provider: "openai",
      contextLength: null,
      description: "High quality instruction following"
    }
  ],
  openrouter: [
    {
      id: "openrouter/auto",
      name: "OpenRouter Auto",
      provider: "openrouter",
      contextLength: null,
      description: "Automatic routing to best available model"
    },
    {
      id: "anthropic/claude-sonnet-4.5",
      name: "Claude Sonnet 4.5",
      provider: "openrouter",
      contextLength: null,
      description: "Anthropic"
    },
    {
      id: "anthropic/claude-opus-4.5",
      name: "Claude Opus 4.5",
      provider: "openrouter",
      contextLength: null,
      description: "Anthropic"
    },
    {
      id: "google/gemini-2.5-pro",
      name: "Gemini 2.5 Pro",
      provider: "openrouter",
      contextLength: null,
      description: "Google"
    },
    {
      id: "google/gemini-2.5-flash",
      name: "Gemini 2.5 Flash",
      provider: "openrouter",
      contextLength: null,
      description: "Google"
    },
    {
      id: "openai/gpt-5.1",
      name: "GPT-5.1",
      provider: "openrouter",
      contextLength: null,
      description: "OpenAI via OpenRouter"
    },
    {
      id: "openai/gpt-5-mini",
      name: "GPT-5 mini",
      provider: "openrouter",
      contextLength: null,
      description: "OpenAI via OpenRouter"
    },
    {
      id: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      provider: "openrouter",
      contextLength: null,
      description: "DeepSeek"
    },
    {
      id: "meta-llama/llama-4-maverick",
      name: "Llama 4 Maverick",
      provider: "openrouter",
      contextLength: null,
      description: "Meta"
    },
    {
      id: "x-ai/grok-4-fast",
      name: "Grok 4 Fast",
      provider: "openrouter",
      contextLength: null,
      description: "xAI"
    }
  ]
};

interface CachedCatalog {
  source: "remote" | "fallback";
  cachedAt: number;
  models: AIModelOption[];
}

const catalogCache = new Map<ProviderWithCatalog, CachedCatalog>();

function sortModels(models: AIModelOption[]): AIModelOption[] {
  return [...models].sort((a, b) => a.id.localeCompare(b.id));
}

function buildFallbackResponse(provider: ProviderWithCatalog): AIModelsResponse {
  const now = Date.now();
  const models = sortModels(FALLBACK_MODELS[provider]);

  catalogCache.set(provider, {
    source: "fallback",
    cachedAt: now,
    models
  });

  return {
    provider,
    source: "fallback",
    cachedAt: new Date(now).toISOString(),
    models
  };
}

function buildResponse(provider: ProviderWithCatalog, cached: CachedCatalog): AIModelsResponse {
  return {
    provider,
    source: cached.source,
    cachedAt: new Date(cached.cachedAt).toISOString(),
    models: cached.models
  };
}

async function fetchOpenAiModels(): Promise<AIModelOption[]> {
  if (!config.ai.openai.apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const response = await fetch(`${config.ai.openai.baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${config.ai.openai.apiKey}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI models request failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  const models = (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id))
    .filter((id) => /^(gpt|o\d|o\d-mini)/i.test(id))
    .map((id) => ({
      id,
      name: id,
      provider: "openai" as const,
      contextLength: null,
      description: null
    }));

  if (models.length === 0) {
    throw new Error("OpenAI returned no compatible chat models");
  }

  return sortModels(models);
}

async function fetchOpenRouterModels(): Promise<AIModelOption[]> {
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (config.ai.openrouter.apiKey) {
    headers.Authorization = `Bearer ${config.ai.openrouter.apiKey}`;
  }

  if (config.ai.openrouter.httpReferer) {
    headers["HTTP-Referer"] = config.ai.openrouter.httpReferer;
  }

  if (config.ai.openrouter.appName) {
    headers["X-Title"] = config.ai.openrouter.appName;
  }

  const response = await fetch(`${config.ai.openrouter.baseUrl}/models`, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OpenRouter models request failed (${response.status}): ${text.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      description?: string;
      context_length?: number;
    }>;
  };

  const models = (payload.data ?? [])
    .filter((item) => Boolean(item.id))
    .map((item) => ({
      id: item.id as string,
      name: item.name?.trim() || (item.id as string),
      provider: "openrouter" as const,
      contextLength:
        typeof item.context_length === "number" ? Math.round(item.context_length) : null,
      description: item.description?.trim() || null
    }));

  if (models.length === 0) {
    throw new Error("OpenRouter returned no models");
  }

  return sortModels(models);
}

export async function getAiModels(
  provider: ProviderWithCatalog,
  forceRefresh = false
): Promise<AIModelsResponse> {
  const cached = catalogCache.get(provider);
  const now = Date.now();

  if (!forceRefresh && cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return buildResponse(provider, cached);
  }

  try {
    const models =
      provider === "openai" ? await fetchOpenAiModels() : await fetchOpenRouterModels();

    const nextCached: CachedCatalog = {
      source: "remote",
      cachedAt: now,
      models
    };

    catalogCache.set(provider, nextCached);
    return buildResponse(provider, nextCached);
  } catch (error) {
    if (cached && cached.models.length > 0) {
      return buildResponse(provider, cached);
    }

    const reason = error instanceof Error ? error.message : "unknown model catalog error";
    console.warn(`[ai] model catalog fallback for ${provider}: ${reason}`);
    return buildFallbackResponse(provider);
  }
}
