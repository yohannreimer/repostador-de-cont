import type { AIProvider } from "@authority/shared";
import { config } from "../config.js";

interface JsonCompletionInput {
  provider: Exclude<AIProvider, "heuristic">;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface JsonCompletionUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
}

export interface JsonCompletionResult {
  output: Record<string, unknown>;
  usage: JsonCompletionUsage;
}

interface ModelPriceHint {
  pattern: RegExp;
  promptPerMillionUsd: number;
  completionPerMillionUsd: number;
}

const OPENAI_PRICE_HINTS: ModelPriceHint[] = [
  { pattern: /gpt-5(\.1)?$/i, promptPerMillionUsd: 5, completionPerMillionUsd: 15 },
  { pattern: /gpt-5-mini/i, promptPerMillionUsd: 0.5, completionPerMillionUsd: 2 },
  { pattern: /o4-mini/i, promptPerMillionUsd: 3, completionPerMillionUsd: 12 },
  { pattern: /gpt-4\.1|gpt-4o/i, promptPerMillionUsd: 5, completionPerMillionUsd: 15 }
];

const OPENROUTER_PRICE_HINTS: ModelPriceHint[] = [
  { pattern: /claude-sonnet-4\.5/i, promptPerMillionUsd: 3, completionPerMillionUsd: 15 },
  { pattern: /claude-3\.7|claude-3\.5/i, promptPerMillionUsd: 3, completionPerMillionUsd: 15 },
  { pattern: /claude-opus/i, promptPerMillionUsd: 15, completionPerMillionUsd: 75 },
  { pattern: /gemini-2\.5-pro/i, promptPerMillionUsd: 2.5, completionPerMillionUsd: 10 },
  { pattern: /gemini-2\.5-flash/i, promptPerMillionUsd: 0.35, completionPerMillionUsd: 1.4 },
  { pattern: /gpt-5(\.1)?$/i, promptPerMillionUsd: 5, completionPerMillionUsd: 15 },
  { pattern: /gpt-5-mini/i, promptPerMillionUsd: 0.5, completionPerMillionUsd: 2 },
  { pattern: /deepseek-v3|deepseek-r1/i, promptPerMillionUsd: 0.55, completionPerMillionUsd: 2.2 }
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return number;
}

function resolveModelPriceHint(
  provider: Exclude<AIProvider, "heuristic">,
  model: string
): ModelPriceHint | null {
  const source = provider === "openai" ? OPENAI_PRICE_HINTS : OPENROUTER_PRICE_HINTS;
  return source.find((item) => item.pattern.test(model)) ?? null;
}

function estimateCostUsd(
  provider: Exclude<AIProvider, "heuristic">,
  model: string,
  promptTokens: number | null,
  completionTokens: number | null
): number | null {
  const hint = resolveModelPriceHint(provider, model);
  if (!hint) {
    return null;
  }

  const input = promptTokens ?? 0;
  const output = completionTokens ?? 0;
  const cost =
    (input / 1_000_000) * hint.promptPerMillionUsd +
    (output / 1_000_000) * hint.completionPerMillionUsd;
  if (!Number.isFinite(cost)) {
    return null;
  }

  return Number(cost.toFixed(6));
}

function parseUsageFromResponse(
  provider: Exclude<AIProvider, "heuristic">,
  model: string,
  responseJson: Record<string, unknown>
): JsonCompletionUsage {
  const usageRecord = asRecord(responseJson.usage) ?? {};
  const nestedUsage = asRecord(asRecord(responseJson.data)?.usage) ?? {};

  const promptTokens =
    toNumber(usageRecord.prompt_tokens) ??
    toNumber(usageRecord.input_tokens) ??
    toNumber(usageRecord.promptTokens) ??
    toNumber(nestedUsage.prompt_tokens) ??
    toNumber(nestedUsage.input_tokens) ??
    null;

  const completionTokens =
    toNumber(usageRecord.completion_tokens) ??
    toNumber(usageRecord.output_tokens) ??
    toNumber(usageRecord.completionTokens) ??
    toNumber(nestedUsage.completion_tokens) ??
    toNumber(nestedUsage.output_tokens) ??
    null;

  const totalTokens =
    toNumber(usageRecord.total_tokens) ??
    toNumber(usageRecord.totalTokens) ??
    toNumber(nestedUsage.total_tokens) ??
    ((promptTokens ?? null) !== null && (completionTokens ?? null) !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null);

  const actualCostUsd =
    toNumber(usageRecord.cost) ??
    toNumber(usageRecord.total_cost) ??
    toNumber(usageRecord.cost_usd) ??
    toNumber(responseJson.cost) ??
    toNumber(nestedUsage.cost) ??
    toNumber(nestedUsage.total_cost) ??
    null;

  const estimatedCostUsd = estimateCostUsd(provider, model, promptTokens, completionTokens);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    actualCostUsd
  };
}

function pickStringFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => pickStringFromUnknown(item))
      .filter((item): item is string => Boolean(item));
    if (parts.length > 0) {
      return parts.join("\n").trim();
    }
    return null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return (
    pickStringFromUnknown(record.text) ??
    pickStringFromUnknown(record.content) ??
    pickStringFromUnknown(record.output_text) ??
    pickStringFromUnknown(record.reasoning) ??
    null
  );
}

function extractChoiceErrorMessage(responseJson: Record<string, unknown>): string | null {
  const choices = Array.isArray(responseJson.choices)
    ? (responseJson.choices as Array<Record<string, unknown>>)
    : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const choiceError = asRecord(firstChoice.error);
  if (!choiceError) {
    return null;
  }

  const message = pickStringFromUnknown(choiceError.message);
  const code = pickStringFromUnknown(choiceError.code);
  const isByok = asRecord(responseJson.usage)?.is_byok === true;
  const byokTag = isByok ? " is_byok=true" : "";
  if (message && code) {
    return `Choice error (${code}): ${message}${byokTag}`;
  }
  if (message) {
    return `Choice error: ${message}${byokTag}`;
  }
  return `Choice error without message${byokTag}`;
}

function extractAssistantContent(responseJson: Record<string, unknown>): string | null {
  const choices = Array.isArray(responseJson.choices)
    ? (responseJson.choices as Array<Record<string, unknown>>)
    : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const message = asRecord(firstChoice.message);
  if (!message) {
    return null;
  }

  return (
    pickStringFromUnknown(message.content) ??
    pickStringFromUnknown(message.output_text) ??
    pickStringFromUnknown(message.reasoning) ??
    null
  );
}

function extractJsonText(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith("```") && trimmed.includes("```")) {
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");

    return withoutFence.trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

function normalizeJsonCandidate(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\t/g, " ")
    .trim();
}

function escapeRawNewlinesInsideStrings(content: string): string {
  const text = normalizeJsonCandidate(content);
  if (!text) {
    return text;
  }

  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (inString) {
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        result += ch;
        escaped = true;
        continue;
      }

      if (ch === "\"") {
        result += ch;
        inString = false;
        continue;
      }

      if (ch === "\n") {
        result += "\\n";
        continue;
      }

      if (ch === "\r") {
        if (text[index + 1] === "\n") {
          index += 1;
        }
        result += "\\n";
        continue;
      }

      result += ch;
      continue;
    }

    if (ch === "\"") {
      inString = true;
    }
    result += ch;
  }

  return result;
}

function stripDanglingJsonTail(content: string): string {
  let current = normalizeJsonCandidate(content);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const next = current
      .replace(/,\s*"[^"]*"\s*:\s*$/g, "")
      .replace(/,\s*"[^"]*$/g, "")
      .replace(/,\s*\{[^{}[\]]*$/g, "")
      .replace(/,\s*\[[^[\]{}]*$/g, "")
      .replace(/,\s*[^,\]\}]*$/g, "")
      .trimEnd();
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function stripTrailingCommas(content: string): string {
  let current = content;
  for (let index = 0; index < 5; index += 1) {
    const next = current.replace(/,\s*([}\]])/g, "$1");
    if (next === current) {
      break;
    }
    current = next;
  }

  return current;
}

function removeUnmatchedClosers(content: string): string {
  const text = normalizeJsonCandidate(content);
  if (!text) {
    return text;
  }

  let result = "";
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];

    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      result += ch;
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) {
        continue;
      }

      const expectedOpen = ch === "}" ? "{" : "[";
      const top = stack[stack.length - 1];
      if (top !== expectedOpen) {
        continue;
      }

      stack.pop();
      result += ch;
      continue;
    }

    result += ch;
  }

  return result;
}

function balancedJsonSlice(content: string): string | null {
  const text = normalizeJsonCandidate(content);
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let idx = start; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) {
        continue;
      }

      const top = stack[stack.length - 1];
      const matches = (top === "{" && ch === "}") || (top === "[" && ch === "]");
      if (!matches) {
        continue;
      }

      stack.pop();
      if (stack.length === 0) {
        return text.slice(start, idx + 1).trim();
      }
    }
  }

  return null;
}

function repairTruncatedJson(content: string): string | null {
  let text = normalizeJsonCandidate(content);
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  text = text.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let idx = 0; idx < text.length; idx += 1) {
    const ch = text[idx];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) {
        continue;
      }

      const top = stack[stack.length - 1];
      const matches = (top === "{" && ch === "}") || (top === "[" && ch === "]");
      if (matches) {
        stack.pop();
      }
    }
  }

  if (inString) {
    while (text.endsWith("\\")) {
      text = text.slice(0, -1);
    }
    text += "\"";
  }

  for (let idx = stack.length - 1; idx >= 0; idx -= 1) {
    text += stack[idx] === "{" ? "}" : "]";
  }

  return text;
}

function parseJsonContent(content: string): Record<string, unknown> {
  const candidates = new Set<string>();
  const normalizedRaw = normalizeJsonCandidate(content);
  const normalizedExtracted = normalizeJsonCandidate(extractJsonText(content));
  const escapedRaw = escapeRawNewlinesInsideStrings(normalizedRaw);
  const escapedExtracted = escapeRawNewlinesInsideStrings(normalizedExtracted);
  const danglingTailRaw = stripDanglingJsonTail(escapedRaw);
  const danglingTailExtracted = stripDanglingJsonTail(escapedExtracted);
  const unmatchedFixedRaw = removeUnmatchedClosers(normalizedRaw);
  const unmatchedFixedExtracted = removeUnmatchedClosers(normalizedExtracted);
  const unmatchedFixedEscapedRaw = removeUnmatchedClosers(escapedRaw);
  const unmatchedFixedEscapedExtracted = removeUnmatchedClosers(escapedExtracted);

  candidates.add(normalizedRaw);
  candidates.add(normalizedExtracted);
  candidates.add(escapedRaw);
  candidates.add(escapedExtracted);
  candidates.add(danglingTailRaw);
  candidates.add(danglingTailExtracted);
  candidates.add(unmatchedFixedRaw);
  candidates.add(unmatchedFixedExtracted);
  candidates.add(unmatchedFixedEscapedRaw);
  candidates.add(unmatchedFixedEscapedExtracted);
  candidates.add(stripTrailingCommas(normalizedRaw));
  candidates.add(stripTrailingCommas(normalizedExtracted));
  candidates.add(stripTrailingCommas(escapedRaw));
  candidates.add(stripTrailingCommas(escapedExtracted));
  candidates.add(stripTrailingCommas(danglingTailRaw));
  candidates.add(stripTrailingCommas(danglingTailExtracted));
  candidates.add(stripTrailingCommas(unmatchedFixedRaw));
  candidates.add(stripTrailingCommas(unmatchedFixedExtracted));
  candidates.add(stripTrailingCommas(unmatchedFixedEscapedRaw));
  candidates.add(stripTrailingCommas(unmatchedFixedEscapedExtracted));

  const balancedRaw = balancedJsonSlice(unmatchedFixedEscapedRaw || unmatchedFixedRaw || content);
  if (balancedRaw) {
    const normalizedBalancedRaw = normalizeJsonCandidate(balancedRaw);
    candidates.add(normalizedBalancedRaw);
    candidates.add(stripTrailingCommas(normalizedBalancedRaw));
    const unmatchedFixedBalancedRaw = removeUnmatchedClosers(normalizedBalancedRaw);
    candidates.add(unmatchedFixedBalancedRaw);
    candidates.add(stripTrailingCommas(unmatchedFixedBalancedRaw));
  }

  const balancedExtracted = balancedJsonSlice(
    unmatchedFixedEscapedExtracted || unmatchedFixedExtracted || extractJsonText(content)
  );
  if (balancedExtracted) {
    const normalizedBalancedExtracted = normalizeJsonCandidate(balancedExtracted);
    candidates.add(normalizedBalancedExtracted);
    candidates.add(stripTrailingCommas(normalizedBalancedExtracted));
    const unmatchedFixedBalancedExtracted = removeUnmatchedClosers(normalizedBalancedExtracted);
    candidates.add(unmatchedFixedBalancedExtracted);
    candidates.add(stripTrailingCommas(unmatchedFixedBalancedExtracted));
  }

  let lastError = "Invalid JSON output";

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "JSON root is not an object";
        continue;
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid JSON output";
    }
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const repaired = repairTruncatedJson(
      stripDanglingJsonTail(
        stripTrailingCommas(removeUnmatchedClosers(escapeRawNewlinesInsideStrings(candidate)))
      )
    );
    if (!repaired) {
      continue;
    }

    try {
      const parsed = JSON.parse(repaired) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "JSON root is not an object";
        continue;
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Invalid JSON output";
    }
  }

  throw new Error(`Invalid JSON output: ${lastError}`);
}

function getProviderConfig(provider: Exclude<AIProvider, "heuristic">): {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
} {
  if (provider === "openai") {
    return {
      apiKey: config.ai.openai.apiKey,
      baseUrl: config.ai.openai.baseUrl,
      headers: {}
    };
  }

  const headers: Record<string, string> = {};
  if (config.ai.openrouter.httpReferer) {
    headers["HTTP-Referer"] = config.ai.openrouter.httpReferer;
  }
  if (config.ai.openrouter.appName) {
    headers["X-Title"] = config.ai.openrouter.appName;
  }

  return {
    apiKey: config.ai.openrouter.apiKey,
    baseUrl: config.ai.openrouter.baseUrl,
    headers
  };
}

function shouldSendTemperature(
  provider: Exclude<AIProvider, "heuristic">,
  model: string
): boolean {
  // Some reasoning variants reject explicit temperature in chat/completions.
  if (provider === "openai" && /^gpt-5/i.test(model.trim())) {
    return false;
  }
  return true;
}

export async function generateJsonCompletion(
  input: JsonCompletionInput
): Promise<JsonCompletionResult> {
  const providerConfig = getProviderConfig(input.provider);
  if (!providerConfig.apiKey) {
    throw new Error(`Missing API key for provider: ${input.provider}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? config.ai.requestTimeoutMs
  );

  try {
    const basePayload: Record<string, unknown> = {
      model: input.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt }
      ]
    };

    if (Number.isFinite(input.temperature) && shouldSendTemperature(input.provider, input.model)) {
      basePayload.temperature = input.temperature;
    }

    if (typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)) {
      if (input.provider === "openai") {
        basePayload.max_completion_tokens = input.maxTokens;
      } else {
        basePayload.max_tokens = input.maxTokens;
      }
    }

    const requestOnce = async (
      payload: Record<string, unknown>
    ): Promise<{ ok: boolean; status: number; text: string; json: Record<string, unknown> | null }> => {
      const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${providerConfig.apiKey}`,
          ...providerConfig.headers
        },
        body: JSON.stringify(payload)
      });

      const raw = await response.text();
      if (!response.ok) {
        return { ok: false, status: response.status, text: raw, json: null };
      }

      try {
        return { ok: true, status: response.status, text: raw, json: JSON.parse(raw) as Record<string, unknown> };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid json response";
        throw new Error(`LLM request succeeded but returned invalid JSON envelope: ${reason}`);
      }
    };

    let requestResult = await requestOnce(basePayload);
    if (!requestResult.ok) {
      const errorLower = requestResult.text.toLowerCase();
      const unsupportedMaxTokens =
        requestResult.status === 400 &&
        errorLower.includes("unsupported_parameter") &&
        errorLower.includes("max_tokens");
      const unsupportedMaxCompletionTokens =
        requestResult.status === 400 &&
        errorLower.includes("unsupported_parameter") &&
        errorLower.includes("max_completion_tokens");
      const unsupportedTemperature =
        requestResult.status === 400 &&
        (errorLower.includes("unsupported_parameter") || errorLower.includes("unsupported_value")) &&
        errorLower.includes("temperature");

      if (unsupportedMaxTokens || unsupportedMaxCompletionTokens || unsupportedTemperature) {
        const retryPayload: Record<string, unknown> = { ...basePayload };
        if ("max_tokens" in retryPayload) {
          delete retryPayload.max_tokens;
        }
        if ("max_completion_tokens" in retryPayload) {
          delete retryPayload.max_completion_tokens;
        }
        if ("temperature" in retryPayload) {
          delete retryPayload.temperature;
        }
        if (typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens)) {
          if (unsupportedMaxTokens) {
            retryPayload.max_completion_tokens = input.maxTokens;
          } else if (unsupportedMaxCompletionTokens) {
            retryPayload.max_tokens = input.maxTokens;
          }
        }
        requestResult = await requestOnce(retryPayload);
      }
    }

    if (!requestResult.ok || !requestResult.json) {
      throw new Error(
        `LLM request failed (${requestResult.status}): ${requestResult.text.slice(0, 500)}`
      );
    }

    const json = requestResult.json;
    const choiceErrorMessage = extractChoiceErrorMessage(json);
    if (choiceErrorMessage) {
      throw new Error(choiceErrorMessage);
    }

    const content = extractAssistantContent(json);
    if (!content) {
      throw new Error("LLM returned empty content");
    }

    return {
      output: parseJsonContent(content),
      usage: parseUsageFromResponse(input.provider, input.model, json)
    };
  } finally {
    clearTimeout(timeout);
  }
}
