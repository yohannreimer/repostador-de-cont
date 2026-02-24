import {
  type AITask,
  DEFAULT_GENERATION_PROFILE,
  GENERATION_AUDIENCE_LEVELS,
  GENERATION_CTA_MODES,
  GENERATION_FOCUS_OPTIONS,
  GENERATION_LENGTHS,
  GENERATION_QUALITY_MODES,
  GENERATION_STRATEGIES,
  GENERATION_TARGET_OUTCOMES,
  type GenerationAudienceLevel,
  type GenerationCtaMode,
  type GenerationFocus,
  type GenerationLength,
  type GenerationPerformanceMemory,
  type GenerationProfile,
  type GenerationQualityMode,
  type GenerationStrategy,
  type GenerationTargetOutcome,
  type TaskScoreWeights,
  type TaskGenerationConfig
} from "@authority/shared";
import { z } from "zod";
import { AI_TASKS } from "./aiRoutingService.js";

const strategyEnum = z.enum(
  GENERATION_STRATEGIES as [GenerationStrategy, ...GenerationStrategy[]]
);
const focusEnum = z.enum(
  GENERATION_FOCUS_OPTIONS as [GenerationFocus, ...GenerationFocus[]]
);
const targetOutcomeEnum = z.enum(
  GENERATION_TARGET_OUTCOMES as [GenerationTargetOutcome, ...GenerationTargetOutcome[]]
);
const audienceLevelEnum = z.enum(
  GENERATION_AUDIENCE_LEVELS as [GenerationAudienceLevel, ...GenerationAudienceLevel[]]
);
const lengthEnum = z.enum(GENERATION_LENGTHS as [GenerationLength, ...GenerationLength[]]);
const ctaModeEnum = z.enum(GENERATION_CTA_MODES as [GenerationCtaMode, ...GenerationCtaMode[]]);
const qualityModeEnum = z.enum(
  GENERATION_QUALITY_MODES as [GenerationQualityMode, ...GenerationQualityMode[]]
);

const taskConfigPatchSchema = z
  .object({
    strategy: strategyEnum.optional(),
    focus: focusEnum.optional(),
    targetOutcome: targetOutcomeEnum.optional(),
    audienceLevel: audienceLevelEnum.optional(),
    length: lengthEnum.optional(),
    ctaMode: ctaModeEnum.optional(),
    scoreWeights: z
      .object({
        judge: z.number().min(0.1).max(0.95).optional(),
        heuristic: z.number().min(0.05).max(0.9).optional()
      })
      .strict()
      .optional()
  })
  .strict();

const qualityPatchSchema = z
  .object({
    mode: qualityModeEnum.optional(),
    variationCount: z.number().int().min(1).max(8).optional(),
    refinePasses: z.number().int().min(1).max(3).optional()
  })
  .strict();

const voicePatchSchema = z
  .object({
    identity: z.string().min(3).max(220).optional(),
    writingRules: z.string().min(3).max(800).optional(),
    bannedTerms: z.string().min(0).max(600).optional(),
    signaturePhrases: z.string().min(0).max(600).optional()
  })
  .strict();

const performanceTaskPatchSchema = z
  .object({
    wins: z.string().min(0).max(500).optional(),
    avoid: z.string().min(0).max(500).optional(),
    kpi: z.string().min(0).max(180).optional()
  })
  .strict();

const performancePatchSchema = z
  .object({
    analysis: performanceTaskPatchSchema.optional(),
    reels: performanceTaskPatchSchema.optional(),
    newsletter: performanceTaskPatchSchema.optional(),
    linkedin: performanceTaskPatchSchema.optional(),
    x: performanceTaskPatchSchema.optional()
  })
  .strict();

const generationProfilePatchSchema = z
  .object({
    audience: z.string().min(3).max(220).optional(),
    goal: z.string().min(3).max(240).optional(),
    tone: z.string().min(3).max(180).optional(),
    language: z.string().min(2).max(24).optional(),
    quality: qualityPatchSchema.optional(),
    voice: voicePatchSchema.optional(),
    performanceMemory: performancePatchSchema.optional(),
    tasks: z
      .object(
        Object.fromEntries(
          AI_TASKS.map((task) => [task, taskConfigPatchSchema.optional()])
        ) as Record<AITask, z.ZodOptional<typeof taskConfigPatchSchema>>
      )
      .strict()
      .optional()
  })
  .strict();

function cleanText(value: string, max: number): string {
  return value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function cloneTaskConfig(config: TaskGenerationConfig): TaskGenerationConfig {
  return {
    strategy: config.strategy,
    focus: config.focus,
    targetOutcome: config.targetOutcome,
    audienceLevel: config.audienceLevel,
    length: config.length,
    ctaMode: config.ctaMode,
    scoreWeights: {
      judge: config.scoreWeights.judge,
      heuristic: config.scoreWeights.heuristic
    }
  };
}

function normalizeScoreWeights(
  weights: Partial<TaskScoreWeights> | undefined,
  fallback: TaskScoreWeights
): TaskScoreWeights {
  const judge = typeof weights?.judge === "number" && Number.isFinite(weights.judge)
    ? Math.max(0.1, Math.min(0.95, weights.judge))
    : fallback.judge;
  const heuristic = typeof weights?.heuristic === "number" && Number.isFinite(weights.heuristic)
    ? Math.max(0.05, Math.min(0.9, weights.heuristic))
    : fallback.heuristic;
  const sum = judge + heuristic;
  if (!Number.isFinite(sum) || sum <= 0) {
    return {
      judge: fallback.judge,
      heuristic: fallback.heuristic
    };
  }

  return {
    judge: Number((judge / sum).toFixed(3)),
    heuristic: Number((heuristic / sum).toFixed(3))
  };
}

function mergeTaskConfig(
  base: TaskGenerationConfig,
  patch:
    | (Partial<Omit<TaskGenerationConfig, "scoreWeights">> & {
        scoreWeights?: Partial<TaskScoreWeights>;
      })
    | undefined
): TaskGenerationConfig {
  if (!patch) {
    return cloneTaskConfig(base);
  }

  return {
    strategy: patch.strategy ?? base.strategy,
    focus: patch.focus ?? base.focus,
    targetOutcome: patch.targetOutcome ?? base.targetOutcome,
    audienceLevel: patch.audienceLevel ?? base.audienceLevel,
    length: patch.length ?? base.length,
    ctaMode: patch.ctaMode ?? base.ctaMode,
    scoreWeights: normalizeScoreWeights(patch.scoreWeights, base.scoreWeights)
  };
}

function clonePerformanceMemory(
  memory: GenerationPerformanceMemory
): GenerationPerformanceMemory {
  return {
    analysis: { ...memory.analysis },
    reels: { ...memory.reels },
    newsletter: { ...memory.newsletter },
    linkedin: { ...memory.linkedin },
    x: { ...memory.x }
  };
}

export function cloneGenerationProfile(profile: GenerationProfile): GenerationProfile {
  return {
    audience: profile.audience,
    goal: profile.goal,
    tone: profile.tone,
    language: profile.language,
    quality: {
      mode: profile.quality.mode,
      variationCount: profile.quality.variationCount,
      refinePasses: profile.quality.refinePasses
    },
    voice: {
      identity: profile.voice.identity,
      writingRules: profile.voice.writingRules,
      bannedTerms: profile.voice.bannedTerms,
      signaturePhrases: profile.voice.signaturePhrases
    },
    performanceMemory: clonePerformanceMemory(profile.performanceMemory),
    tasks: {
      analysis: cloneTaskConfig(profile.tasks.analysis),
      reels: cloneTaskConfig(profile.tasks.reels),
      newsletter: cloneTaskConfig(profile.tasks.newsletter),
      linkedin: cloneTaskConfig(profile.tasks.linkedin),
      x: cloneTaskConfig(profile.tasks.x)
    }
  };
}

export function defaultGenerationProfile(): GenerationProfile {
  return cloneGenerationProfile(DEFAULT_GENERATION_PROFILE);
}

export function mergeGenerationProfile(
  baseProfile: GenerationProfile,
  patchInput: unknown
): GenerationProfile {
  const parsed = generationProfilePatchSchema.safeParse(patchInput);
  if (!parsed.success) {
    return cloneGenerationProfile(baseProfile);
  }

  const patch = parsed.data;

  return {
    audience: patch.audience ? cleanText(patch.audience, 220) : baseProfile.audience,
    goal: patch.goal ? cleanText(patch.goal, 240) : baseProfile.goal,
    tone: patch.tone ? cleanText(patch.tone, 180) : baseProfile.tone,
    language: patch.language ? cleanText(patch.language, 24) : baseProfile.language,
    quality: {
      mode: patch.quality?.mode ?? baseProfile.quality.mode,
      variationCount: patch.quality?.variationCount ?? baseProfile.quality.variationCount,
      refinePasses: patch.quality?.refinePasses ?? baseProfile.quality.refinePasses
    },
    voice: {
      identity: patch.voice?.identity
        ? cleanText(patch.voice.identity, 220)
        : baseProfile.voice.identity,
      writingRules: patch.voice?.writingRules
        ? cleanText(patch.voice.writingRules, 800)
        : baseProfile.voice.writingRules,
      bannedTerms:
        patch.voice?.bannedTerms !== undefined
          ? cleanText(patch.voice.bannedTerms, 600)
          : baseProfile.voice.bannedTerms,
      signaturePhrases:
        patch.voice?.signaturePhrases !== undefined
          ? cleanText(patch.voice.signaturePhrases, 600)
          : baseProfile.voice.signaturePhrases
    },
    performanceMemory: {
      analysis: {
        wins:
          patch.performanceMemory?.analysis?.wins !== undefined
            ? cleanText(patch.performanceMemory.analysis.wins, 500)
            : baseProfile.performanceMemory.analysis.wins,
        avoid:
          patch.performanceMemory?.analysis?.avoid !== undefined
            ? cleanText(patch.performanceMemory.analysis.avoid, 500)
            : baseProfile.performanceMemory.analysis.avoid,
        kpi:
          patch.performanceMemory?.analysis?.kpi !== undefined
            ? cleanText(patch.performanceMemory.analysis.kpi, 180)
            : baseProfile.performanceMemory.analysis.kpi
      },
      reels: {
        wins:
          patch.performanceMemory?.reels?.wins !== undefined
            ? cleanText(patch.performanceMemory.reels.wins, 500)
            : baseProfile.performanceMemory.reels.wins,
        avoid:
          patch.performanceMemory?.reels?.avoid !== undefined
            ? cleanText(patch.performanceMemory.reels.avoid, 500)
            : baseProfile.performanceMemory.reels.avoid,
        kpi:
          patch.performanceMemory?.reels?.kpi !== undefined
            ? cleanText(patch.performanceMemory.reels.kpi, 180)
            : baseProfile.performanceMemory.reels.kpi
      },
      newsletter: {
        wins:
          patch.performanceMemory?.newsletter?.wins !== undefined
            ? cleanText(patch.performanceMemory.newsletter.wins, 500)
            : baseProfile.performanceMemory.newsletter.wins,
        avoid:
          patch.performanceMemory?.newsletter?.avoid !== undefined
            ? cleanText(patch.performanceMemory.newsletter.avoid, 500)
            : baseProfile.performanceMemory.newsletter.avoid,
        kpi:
          patch.performanceMemory?.newsletter?.kpi !== undefined
            ? cleanText(patch.performanceMemory.newsletter.kpi, 180)
            : baseProfile.performanceMemory.newsletter.kpi
      },
      linkedin: {
        wins:
          patch.performanceMemory?.linkedin?.wins !== undefined
            ? cleanText(patch.performanceMemory.linkedin.wins, 500)
            : baseProfile.performanceMemory.linkedin.wins,
        avoid:
          patch.performanceMemory?.linkedin?.avoid !== undefined
            ? cleanText(patch.performanceMemory.linkedin.avoid, 500)
            : baseProfile.performanceMemory.linkedin.avoid,
        kpi:
          patch.performanceMemory?.linkedin?.kpi !== undefined
            ? cleanText(patch.performanceMemory.linkedin.kpi, 180)
            : baseProfile.performanceMemory.linkedin.kpi
      },
      x: {
        wins:
          patch.performanceMemory?.x?.wins !== undefined
            ? cleanText(patch.performanceMemory.x.wins, 500)
            : baseProfile.performanceMemory.x.wins,
        avoid:
          patch.performanceMemory?.x?.avoid !== undefined
            ? cleanText(patch.performanceMemory.x.avoid, 500)
            : baseProfile.performanceMemory.x.avoid,
        kpi:
          patch.performanceMemory?.x?.kpi !== undefined
            ? cleanText(patch.performanceMemory.x.kpi, 180)
            : baseProfile.performanceMemory.x.kpi
      }
    },
    tasks: {
      analysis: mergeTaskConfig(baseProfile.tasks.analysis, patch.tasks?.analysis),
      reels: mergeTaskConfig(baseProfile.tasks.reels, patch.tasks?.reels),
      newsletter: mergeTaskConfig(baseProfile.tasks.newsletter, patch.tasks?.newsletter),
      linkedin: mergeTaskConfig(baseProfile.tasks.linkedin, patch.tasks?.linkedin),
      x: mergeTaskConfig(baseProfile.tasks.x, patch.tasks?.x)
    }
  };
}

export function resolveGenerationProfile(input: unknown): GenerationProfile {
  return mergeGenerationProfile(defaultGenerationProfile(), input);
}
