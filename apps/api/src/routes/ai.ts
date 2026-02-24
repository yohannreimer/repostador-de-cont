import { Router } from "express";
import { z } from "zod";
import type { AIRoute, AITask, OpenRouterModelFamily } from "@authority/shared";
import { AI_TASKS, getAiRoutingResponse, updateAiRouting } from "../services/aiRoutingService.js";
import { getAiModels } from "../services/aiModelCatalogService.js";
import {
  getAiPreferencesResponse,
  updateAiPreferences
} from "../services/aiPreferencesService.js";
import {
  activatePromptVersion,
  createPromptVersion,
  getPromptCatalogResponse
} from "../services/promptTemplateService.js";

const routePatchSchema = z
  .object({
    provider: z.enum(["heuristic", "openai", "openrouter"]).optional(),
    model: z.string().min(1).max(120).optional(),
    temperature: z.number().min(0).max(1.5).optional()
  })
  .strict();

const routingPatchSchema = z
  .object(
    Object.fromEntries(
      AI_TASKS.map((task) => [task, routePatchSchema.optional()])
    ) as Record<AITask, z.ZodOptional<typeof routePatchSchema>>
  )
  .strict();

const routingEnvelopeSchema = z
  .object({
    routing: routingPatchSchema.optional(),
    judgeRouting: routingPatchSchema.optional()
  })
  .strict();

const createPromptVersionSchema = z
  .object({
    name: z.string().min(2).max(80),
    systemPrompt: z.string().min(10),
    userPromptTemplate: z.string().min(10),
    activate: z.boolean().optional().default(true)
  })
  .strict();

const activatePromptVersionSchema = z
  .object({
    version: z.number().int().min(1)
  })
  .strict();

const modelsQuerySchema = z.object({
  provider: z.enum(["openai", "openrouter"]),
  force_refresh: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
});

const modelFamilySchema = z.enum([
  "top",
  "claude",
  "gemini",
  "openai",
  "deepseek",
  "others"
] satisfies [OpenRouterModelFamily, ...OpenRouterModelFamily[]]);

const modelFamilyByTaskPatchSchema = z
  .object(
    Object.fromEntries(
      AI_TASKS.map((task) => [task, modelFamilySchema.optional()])
    ) as Record<AITask, z.ZodOptional<typeof modelFamilySchema>>
  )
  .strict();

const preferencesPatchSchema = z
  .object({
    generationProfile: z.unknown().optional(),
    modelFamilyByTask: modelFamilyByTaskPatchSchema.optional()
  })
  .strict()
  .refine(
    (value) => value.generationProfile !== undefined || value.modelFamilyByTask !== undefined,
    {
      message: "At least one field is required"
    }
  );

function parseTask(rawTask: string): AITask | null {
  return AI_TASKS.includes(rawTask as AITask) ? (rawTask as AITask) : null;
}

export const aiRouter = Router();

aiRouter.get("/ai/routing", (_req, res) => {
  return res.json(getAiRoutingResponse());
});

aiRouter.patch("/ai/routing", async (req, res) => {
  const legacyResult = routingPatchSchema.safeParse(req.body);
  const envelopeResult = routingEnvelopeSchema.safeParse(req.body);

  if (!legacyResult.success && !envelopeResult.success) {
    return res.status(400).json({
      error: "Invalid routing payload",
      details: envelopeResult.success
        ? legacyResult.error.flatten()
        : envelopeResult.error.flatten()
    });
  }

  try {
    if (envelopeResult.success && (envelopeResult.data.routing || envelopeResult.data.judgeRouting)) {
      await updateAiRouting({
        routing: envelopeResult.data.routing as Partial<Record<AITask, Partial<AIRoute>>> | undefined,
        judgeRouting:
          envelopeResult.data.judgeRouting as Partial<Record<AITask, Partial<AIRoute>>> | undefined
      });
    } else {
      const patch = legacyResult.data as Partial<Record<AITask, Partial<AIRoute>>>;
      await updateAiRouting(patch);
    }
    return res.json(getAiRoutingResponse());
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to update routing";
    return res.status(500).json({ error: reason });
  }
});

aiRouter.get("/ai/preferences", (_req, res) => {
  return res.json(getAiPreferencesResponse());
});

aiRouter.patch("/ai/preferences", async (req, res) => {
  const result = preferencesPatchSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid preferences payload",
      details: result.error.flatten()
    });
  }

  try {
    const response = await updateAiPreferences({
      generationProfile: result.data.generationProfile,
      modelFamilyByTask: result.data.modelFamilyByTask
    });
    return res.json(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to update preferences";
    return res.status(500).json({ error: reason });
  }
});

aiRouter.get("/ai/models", async (req, res) => {
  const result = modelsQuerySchema.safeParse(req.query);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid models query",
      details: result.error.flatten()
    });
  }

  try {
    const response = await getAiModels(
      result.data.provider,
      result.data.force_refresh === "1" || result.data.force_refresh === "true"
    );
    return res.json(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to fetch model catalog";
    return res.status(500).json({ error: reason });
  }
});

aiRouter.get("/ai/prompts", (_req, res) => {
  return res.json(getPromptCatalogResponse());
});

aiRouter.post("/ai/prompts/:task/versions", async (req, res) => {
  const task = parseTask(req.params.task);
  if (!task) {
    return res.status(400).json({ error: "Invalid task" });
  }

  const result = createPromptVersionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid prompt version payload",
      details: result.error.flatten()
    });
  }

  try {
    const response = await createPromptVersion(task, {
      name: result.data.name,
      systemPrompt: result.data.systemPrompt,
      userPromptTemplate: result.data.userPromptTemplate,
      activate: result.data.activate
    });

    return res.status(201).json(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Failed to create prompt version";
    return res.status(500).json({ error: reason });
  }
});

aiRouter.patch("/ai/prompts/:task/activate", async (req, res) => {
  const task = parseTask(req.params.task);
  if (!task) {
    return res.status(400).json({ error: "Invalid task" });
  }

  const result = activatePromptVersionSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: "Invalid activate payload",
      details: result.error.flatten()
    });
  }

  try {
    const response = await activatePromptVersion(task, result.data.version);
    return res.json(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Prompt activation failed";
    return res.status(404).json({ error: reason });
  }
});
