import fs from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import type {
  AITask,
  AnalysisPayload,
  AssetRefineAction,
  GeneratedAssetStatus,
  GeneratedAssetType,
  GeneratedAssetPayload,
  GenerationProfile,
  LinkedinPayload,
  NewsletterPayload,
  ReelsPayload,
  TaskGenerationDiagnostics,
  TranscriptSegment,
  XPostsPayload
} from "@authority/shared";
import { parseSrt } from "./srtParser.js";
import {
  generateLinkedin,
  generateNarrativeAnalysis,
  generateNewsletter,
  generateReels,
  generateXPosts
} from "./generationService.js";
import { enqueueLocalJob } from "../queue/localQueue.js";
import { store } from "../storage/inMemoryStore.js";
import { cloneGenerationProfile } from "./generationProfileService.js";

const REFINABLE_TEXT_ASSETS: GeneratedAssetType[] = [
  "analysis",
  "reels",
  "newsletter",
  "linkedin",
  "x"
];

type DiagnosticsWriter = (
  entry: Parameters<typeof store.upsertGenerationDiagnostics>[0]
) => void;

type JsonPathToken = string | number;

function normalizeEditorInstruction(raw?: string): string {
  if (!raw) {
    return "";
  }

  return raw
    .replace(/[—–]/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 600);
}

function taskByAssetType(type: GeneratedAssetType): AITask {
  if (type === "analysis") {
    return "analysis";
  }
  if (type === "reels") {
    return "reels";
  }
  if (type === "newsletter") {
    return "newsletter";
  }
  if (type === "linkedin") {
    return "linkedin";
  }
  return "x";
}

function assetTypeByTask(task: AITask): GeneratedAssetType {
  if (task === "analysis") {
    return "analysis";
  }
  if (task === "reels") {
    return "reels";
  }
  if (task === "newsletter") {
    return "newsletter";
  }
  if (task === "linkedin") {
    return "linkedin";
  }
  return "x";
}

function diagnosticsByTask(srtAssetId: string, task: AITask): TaskGenerationDiagnostics | null {
  return (
    store
      .listGenerationDiagnostics(srtAssetId)
      .find((entry) => entry.task === task) ?? null
  );
}

function diagnosticsReadyForPublish(entry: TaskGenerationDiagnostics | null): boolean {
  if (!entry) {
    return true;
  }
  const meetsQuality =
    typeof entry.meetsQualityThreshold === "boolean"
      ? entry.meetsQualityThreshold
      : entry.qualityFinal >= entry.qualityThreshold;
  const meetsPublishability =
    typeof entry.meetsPublishabilityThreshold === "boolean"
      ? entry.meetsPublishabilityThreshold
      : true;
  return meetsQuality && meetsPublishability;
}

function outputStatusForTask(srtAssetId: string, task: AITask): GeneratedAssetStatus {
  return diagnosticsReadyForPublish(diagnosticsByTask(srtAssetId, task))
    ? "ready"
    : "pending";
}

function hasBlockingIssuesForTask(srtAssetId: string, task: AITask): boolean {
  return !diagnosticsReadyForPublish(diagnosticsByTask(srtAssetId, task));
}

function tunedProfileForAutoRerun(profile: GenerationProfile, task: AITask): GenerationProfile {
  const next = cloneGenerationProfile(profile);
  next.quality.mode = "max";
  next.quality.variationCount = Math.max(6, next.quality.variationCount);
  next.quality.refinePasses = 3;

  const taskConfig = next.tasks[task];
  taskConfig.scoreWeights.judge = 0.84;
  taskConfig.scoreWeights.heuristic = 0.16;

  if (task === "reels") {
    taskConfig.strategy = "provocative";
    taskConfig.focus = "provocative";
  } else if (task === "newsletter") {
    taskConfig.strategy = "framework";
    taskConfig.focus = "authority";
    taskConfig.length = "long";
  } else if (task === "linkedin") {
    taskConfig.strategy = "contrarian";
    taskConfig.focus = "authority";
  } else if (task === "x") {
    taskConfig.strategy = "provocative";
    taskConfig.focus = "provocative";
  }

  return next;
}

function tunedProfileForRefinement(
  profile: GenerationProfile,
  task: AITask,
  action: AssetRefineAction,
  instruction?: string,
  evidenceOnly = false
): GenerationProfile {
  const next = cloneGenerationProfile(profile);
  const taskConfig = next.tasks[task];

  next.quality.mode = "max";
  next.quality.variationCount = Math.max(5, next.quality.variationCount);
  next.quality.refinePasses = 3;

  if (action === "shorten") {
    taskConfig.length = "short";
  } else if (action === "deepen") {
    taskConfig.length = "long";
    if (task !== "reels") {
      taskConfig.focus = "framework";
      taskConfig.strategy = "framework";
    } else {
      taskConfig.focus = "educational";
      taskConfig.strategy = "educational";
    }
  } else if (action === "provocative") {
    taskConfig.strategy = "provocative";
    taskConfig.focus = "provocative";
    if (task === "reels" || task === "linkedin" || task === "x") {
      taskConfig.targetOutcome = "followers";
    }
  } else {
    taskConfig.length = taskConfig.length === "short" ? "standard" : taskConfig.length;
  }

  const cleanedInstruction = normalizeEditorInstruction(instruction);
  const evidenceDirective = evidenceOnly
    ? "Regenerar estritamente com base no evidence map do SRT. Nao inventar numero, exemplo ou entidade."
    : "";
  if (cleanedInstruction.length > 0) {
    const currentWins = next.performanceMemory[task].wins;
    const mergedWins = [currentWins, `Direcao do editor: ${cleanedInstruction}`, evidenceDirective]
      .filter((value) => value && value.trim().length > 0)
      .join(" | ")
      .slice(0, 500);
    next.performanceMemory[task].wins = mergedWins;
    next.voice.writingRules = `${next.voice.writingRules} Priorize esta direcao do editor: ${cleanedInstruction}`.slice(
      0,
      800
    );
  } else if (evidenceDirective) {
    const currentWins = next.performanceMemory[task].wins;
    next.performanceMemory[task].wins = [currentWins, evidenceDirective]
      .filter((value) => value && value.trim().length > 0)
      .join(" | ")
      .slice(0, 500);
  }

  if (evidenceOnly) {
    next.voice.writingRules = `${next.voice.writingRules} Use apenas fatos presentes no SRT e no evidence map.`.slice(
      0,
      800
    );
  }

  return next;
}

function assertRefinableAssetType(type: GeneratedAssetType): void {
  if (!REFINABLE_TEXT_ASSETS.includes(type)) {
    throw new Error("Asset type does not support AI refinement");
  }
}

function parseBlockPath(path: string): JsonPathToken[] {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("Invalid block path");
  }

  const tokens: JsonPathToken[] = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(trimmed)) !== null) {
    if (match[1]) {
      const key = match[1];
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error("Unsafe block path");
      }
      tokens.push(key);
      continue;
    }

    tokens.push(Number(match[2] ?? 0));
  }

  if (tokens.length === 0) {
    throw new Error("Invalid block path");
  }

  return tokens;
}

function getValueAtPath(root: unknown, tokens: JsonPathToken[]): unknown {
  let current: unknown = root;
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return undefined;
      }
      current = current[token];
      continue;
    }

    if (!current || typeof current !== "object" || !(token in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }

  return current;
}

function setValueAtPath(root: unknown, tokens: JsonPathToken[], value: unknown): boolean {
  if (!root || typeof root !== "object" || tokens.length === 0) {
    return false;
  }

  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (typeof token === "number") {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return false;
      }
      current = current[token];
      continue;
    }

    if (!current || typeof current !== "object") {
      return false;
    }

    const next = (current as Record<string, unknown>)[token];
    if (next === undefined) {
      return false;
    }
    current = next;
  }

  const last = tokens[tokens.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current) || last < 0 || last >= current.length) {
      return false;
    }
    current[last] = value;
    return true;
  }

  if (!current || typeof current !== "object" || !(last in (current as Record<string, unknown>))) {
    return false;
  }

  (current as Record<string, unknown>)[last] = value;
  return true;
}

function clonePayload(payload: GeneratedAssetPayload): GeneratedAssetPayload {
  return JSON.parse(JSON.stringify(payload)) as GeneratedAssetPayload;
}

function canonicalToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function lexicalSet(text: string): Set<string> {
  return new Set(
    text
      .split(/\s+/)
      .map((item) => canonicalToken(item))
      .filter((item) => item.length >= 4)
  );
}

function lexicalOverlap(a: string, b: string): number {
  const aSet = lexicalSet(a);
  const bSet = lexicalSet(b);
  if (aSet.size === 0 || bSet.size === 0) {
    return 0;
  }
  let common = 0;
  for (const token of aSet) {
    if (bSet.has(token)) {
      common += 1;
    }
  }
  return common / aSet.size;
}

function extractTextSignalsFromPayload(
  type: GeneratedAssetType,
  payload: GeneratedAssetPayload
): string[] {
  if (type === "analysis") {
    const analysis = payload as AnalysisPayload;
    return [
      analysis.thesis,
      ...(analysis.recommendations ?? []),
      ...(analysis.topics ?? [])
    ].filter((item) => item.trim().length >= 20);
  }

  if (type === "reels") {
    const reels = payload as ReelsPayload;
    return reels.clips
      .flatMap((clip) => [clip.title, clip.caption, clip.whyItWorks])
      .filter((item) => item.trim().length >= 20);
  }

  if (type === "newsletter") {
    const newsletter = payload as NewsletterPayload;
    const sectionTexts = newsletter.sections.flatMap((section) => {
      if (section.type === "application") {
        return section.bullets;
      }
      if (section.type === "insight") {
        return [section.title, section.text];
      }
      return [section.text];
    });
    return [newsletter.headline, newsletter.subheadline, ...sectionTexts].filter(
      (item) => item.trim().length >= 20
    );
  }

  if (type === "linkedin") {
    const linkedin = payload as LinkedinPayload;
    return [linkedin.hook, ...linkedin.body, linkedin.ctaQuestion].filter(
      (item) => item.trim().length >= 20
    );
  }

  if (type === "x") {
    const x = payload as XPostsPayload;
    return [...x.standalone, ...x.thread].filter((item) => item.trim().length >= 20);
  }

  return [];
}

function buildCrossChannelAvoidMemory(
  srtAssetId: string,
  task: AITask,
  profile: GenerationProfile
): GenerationProfile {
  const next = cloneGenerationProfile(profile);
  const sourceSignals = store
    .listGeneratedAssets(srtAssetId)
    .filter((asset) => {
      if (!REFINABLE_TEXT_ASSETS.includes(asset.type)) {
        return false;
      }
      return taskByAssetType(asset.type) !== task;
    })
    .flatMap((asset) => extractTextSignalsFromPayload(asset.type, asset.payload))
    .filter((item) => item.trim().length >= 20)
    .slice(0, 10);

  if (sourceSignals.length === 0) {
    return next;
  }

  const avoidHint = `Evite repetir literalmente estas frases/angulos de outros canais: ${sourceSignals.join(" || ")}`.slice(
    0,
    500
  );
  const existingAvoid = next.performanceMemory[task].avoid;
  next.performanceMemory[task].avoid = [existingAvoid, avoidHint]
    .filter((item) => item && item.trim().length > 0)
    .join(" | ")
    .slice(0, 500);
  return next;
}

function filterUniqueByCrossChannel(
  values: string[],
  crossPool: string[],
  minItems: number,
  overlapThreshold: number
): string[] {
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }

    const duplicatedInPool = crossPool.some((poolItem) => lexicalOverlap(normalized, poolItem) >= overlapThreshold);
    const duplicatedInSelf = result.some((existing) => lexicalOverlap(normalized, existing) >= 0.9);
    if (!duplicatedInPool && !duplicatedInSelf) {
      result.push(normalized);
    }
  }

  if (result.length >= minItems) {
    return result;
  }

  const fallback: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const duplicatedInSelf = fallback.some((existing) => lexicalOverlap(normalized, existing) >= 0.92);
    if (!duplicatedInSelf) {
      fallback.push(normalized);
    }
    if (fallback.length >= minItems) {
      break;
    }
  }
  return fallback;
}

function dedupePayloadCrossChannel(
  srtAssetId: string,
  type: GeneratedAssetType,
  payload: GeneratedAssetPayload
): GeneratedAssetPayload {
  const crossPool = store
    .listGeneratedAssets(srtAssetId)
    .filter((asset) => REFINABLE_TEXT_ASSETS.includes(asset.type) && asset.type !== type)
    .flatMap((asset) => extractTextSignalsFromPayload(asset.type, asset.payload));

  if (crossPool.length === 0) {
    return payload;
  }

  if (type === "newsletter") {
    const newsletter = clonePayload(payload) as NewsletterPayload;
    newsletter.sections = newsletter.sections.map((section) => {
      if (section.type === "application") {
        return {
          type: "application",
          bullets: filterUniqueByCrossChannel(section.bullets, crossPool, 3, 0.86)
        };
      }
      if (section.type === "insight") {
        return {
          ...section,
          text: filterUniqueByCrossChannel([section.text], crossPool, 1, 0.88)[0] ?? section.text
        };
      }
      return section;
    });
    return newsletter;
  }

  if (type === "linkedin") {
    const linkedin = clonePayload(payload) as LinkedinPayload;
    linkedin.body = filterUniqueByCrossChannel(linkedin.body, crossPool, 4, 0.86);
    return linkedin;
  }

  if (type === "x") {
    const xPosts = clonePayload(payload) as XPostsPayload;
    xPosts.standalone = filterUniqueByCrossChannel(xPosts.standalone, crossPool, 3, 0.84);
    xPosts.thread = filterUniqueByCrossChannel(xPosts.thread, crossPool, 4, 0.84);
    return xPosts;
  }

  if (type === "reels") {
    const reels = clonePayload(payload) as ReelsPayload;
    reels.clips = reels.clips.map((clip) => ({
      ...clip,
      caption:
        filterUniqueByCrossChannel([clip.caption], crossPool, 1, 0.9)[0] ??
        clip.caption
    }));
    return reels;
  }

  return payload;
}

async function generatePayloadForType(input: {
  type: GeneratedAssetType;
  segments: TranscriptSegment[];
  analysis: Awaited<ReturnType<typeof generateNarrativeAnalysis>>;
  durationSec: number;
  profile: GenerationProfile;
  srtAssetId: string;
  diagnostics: DiagnosticsWriter;
}): Promise<GeneratedAssetPayload> {
  if (input.type === "analysis") {
    return input.analysis;
  }

  if (input.type === "reels") {
    return generateReels(
      input.segments,
      input.analysis,
      input.durationSec,
      input.profile,
      input.srtAssetId,
      input.diagnostics
    );
  }

  if (input.type === "newsletter") {
    return generateNewsletter(
      input.segments,
      input.analysis,
      input.profile,
      input.srtAssetId,
      input.diagnostics
    );
  }

  if (input.type === "linkedin") {
    return generateLinkedin(
      input.segments,
      input.analysis,
      input.profile,
      input.srtAssetId,
      input.diagnostics
    );
  }

  if (input.type === "x") {
    return generateXPosts(
      input.segments,
      input.analysis,
      input.profile,
      input.srtAssetId,
      input.diagnostics
    );
  }

  throw new Error("Asset type does not support generation");
}

async function runSelectiveAutoRerun(input: {
  srtAssetId: string;
  segments: TranscriptSegment[];
  analysis: AnalysisPayload;
  durationSec: number;
  profile: GenerationProfile;
  diagnostics: DiagnosticsWriter;
}): Promise<void> {
  const rerunTasks = (["analysis", "reels", "newsletter", "linkedin", "x"] as AITask[]).filter(
    (task) => hasBlockingIssuesForTask(input.srtAssetId, task)
  );

  if (rerunTasks.length === 0) {
    return;
  }

  store.updateSrtAssetStatus(input.srtAssetId, "processing");

  let analysisPayload = input.analysis;
  if (rerunTasks.includes("analysis")) {
    const rerunProfile = tunedProfileForAutoRerun(input.profile, "analysis");
    analysisPayload = await generateNarrativeAnalysis(
      input.segments,
      rerunProfile,
      input.srtAssetId,
      input.diagnostics
    );
    store.upsertGeneratedAsset({
      srtAssetId: input.srtAssetId,
      type: "analysis",
      status: outputStatusForTask(input.srtAssetId, "analysis"),
      payload: analysisPayload
    });
  }

  for (const task of rerunTasks) {
    if (task === "analysis") {
      continue;
    }

    const rerunProfile = tunedProfileForAutoRerun(input.profile, task);
    const type = assetTypeByTask(task);

    let payload: GeneratedAssetPayload;
    if (task === "reels") {
      const nextPayload = await generateReels(
        input.segments,
        analysisPayload,
        input.durationSec,
        rerunProfile,
        input.srtAssetId,
        input.diagnostics
      );
      payload = dedupePayloadCrossChannel(input.srtAssetId, type, nextPayload);
    } else if (task === "newsletter") {
      const nextPayload = await generateNewsletter(
        input.segments,
        analysisPayload,
        rerunProfile,
        input.srtAssetId,
        input.diagnostics
      );
      payload = dedupePayloadCrossChannel(input.srtAssetId, type, nextPayload);
    } else if (task === "linkedin") {
      const nextPayload = await generateLinkedin(
        input.segments,
        analysisPayload,
        rerunProfile,
        input.srtAssetId,
        input.diagnostics
      );
      payload = dedupePayloadCrossChannel(input.srtAssetId, type, nextPayload);
    } else {
      const nextPayload = await generateXPosts(
        input.segments,
        analysisPayload,
        rerunProfile,
        input.srtAssetId,
        input.diagnostics
      );
      payload = dedupePayloadCrossChannel(input.srtAssetId, type, nextPayload);
    }

    store.upsertGeneratedAsset({
      srtAssetId: input.srtAssetId,
      type,
      status: outputStatusForTask(input.srtAssetId, task),
      payload
    });
  }
}

function enqueueTextGeneration(srtAssetId: string): void {
  const recordDiagnostics = (
    entry: Parameters<typeof store.upsertGenerationDiagnostics>[0]
  ): void => {
    store.upsertGenerationDiagnostics(entry);
  };

  enqueueLocalJob(srtAssetId, "analyze_narrative", async () => {
    const asset = store.getSrtAsset(srtAssetId);
    if (!asset) {
      throw new Error("SRT asset not found");
    }

    const segments = store.getSegments(srtAssetId);
    if (segments.length === 0) {
      throw new Error("No transcript segments available");
    }

    store.updateSrtAssetStatus(srtAssetId, "processing");

    const generationProfile = asset.generationProfile;
    const analysis = await generateNarrativeAnalysis(
      segments,
      generationProfile,
      srtAssetId,
      recordDiagnostics
    );
    store.upsertGeneratedAsset({
      srtAssetId,
      type: "analysis",
      status: outputStatusForTask(srtAssetId, "analysis"),
      payload: analysis
    });

    enqueueLocalJob(srtAssetId, "generate_reels", async () => {
      const currentAsset = store.getSrtAsset(srtAssetId);
      if (!currentAsset) {
        throw new Error("SRT asset not found");
      }

      const reelsProfile = buildCrossChannelAvoidMemory(
        srtAssetId,
        "reels",
        currentAsset.generationProfile
      );
      const reels = await generateReels(
        segments,
        analysis,
        currentAsset.durationSec ?? 0,
        reelsProfile,
        srtAssetId,
        recordDiagnostics
      );
      const dedupedReels = dedupePayloadCrossChannel(srtAssetId, "reels", reels);
      store.upsertGeneratedAsset({
        srtAssetId,
        type: "reels",
        status: outputStatusForTask(srtAssetId, "reels"),
        payload: dedupedReels
      });

      enqueueLocalJob(srtAssetId, "generate_newsletter", async () => {
        const latestAsset = store.getSrtAsset(srtAssetId);
        if (!latestAsset) {
          throw new Error("SRT asset not found");
        }

        const newsletterProfile = buildCrossChannelAvoidMemory(
          srtAssetId,
          "newsletter",
          latestAsset.generationProfile
        );
        const newsletter = await generateNewsletter(
          segments,
          analysis,
          newsletterProfile,
          srtAssetId,
          recordDiagnostics
        );
        const dedupedNewsletter = dedupePayloadCrossChannel(
          srtAssetId,
          "newsletter",
          newsletter
        );
        store.upsertGeneratedAsset({
          srtAssetId,
          type: "newsletter",
          status: outputStatusForTask(srtAssetId, "newsletter"),
          payload: dedupedNewsletter
        });

        enqueueLocalJob(srtAssetId, "generate_linkedin", async () => {
          const activeAsset = store.getSrtAsset(srtAssetId);
          if (!activeAsset) {
            throw new Error("SRT asset not found");
          }

          const linkedinProfile = buildCrossChannelAvoidMemory(
            srtAssetId,
            "linkedin",
            activeAsset.generationProfile
          );
          const linkedin = await generateLinkedin(
            segments,
            analysis,
            linkedinProfile,
            srtAssetId,
            recordDiagnostics
          );
          const dedupedLinkedin = dedupePayloadCrossChannel(
            srtAssetId,
            "linkedin",
            linkedin
          );
          store.upsertGeneratedAsset({
            srtAssetId,
            type: "linkedin",
            status: outputStatusForTask(srtAssetId, "linkedin"),
            payload: dedupedLinkedin
          });

          enqueueLocalJob(srtAssetId, "generate_x_posts", async () => {
            const readyAsset = store.getSrtAsset(srtAssetId);
            if (!readyAsset) {
              throw new Error("SRT asset not found");
            }

            const xProfile = buildCrossChannelAvoidMemory(
              srtAssetId,
              "x",
              readyAsset.generationProfile
            );
            const xPosts = await generateXPosts(
              segments,
              analysis,
              xProfile,
              srtAssetId,
              recordDiagnostics
            );
            const dedupedX = dedupePayloadCrossChannel(srtAssetId, "x", xPosts);
            store.upsertGeneratedAsset({
              srtAssetId,
              type: "x",
              status: outputStatusForTask(srtAssetId, "x"),
              payload: dedupedX
            });

            await runSelectiveAutoRerun({
              srtAssetId,
              segments,
              analysis,
              durationSec: readyAsset.durationSec ?? 0,
              profile: readyAsset.generationProfile,
              diagnostics: recordDiagnostics
            });

            store.updateSrtAssetStatus(srtAssetId, "done");
          });
        });
      });
    });
  });
}

export function enqueueSrtProcessing(srtAssetId: string): void {
  enqueueLocalJob(srtAssetId, "parse_srt", async () => {
    const asset = store.getSrtAsset(srtAssetId);
    if (!asset) {
      throw new Error("SRT asset not found");
    }

    store.updateSrtAssetStatus(srtAssetId, "processing");

    const raw = await fs.readFile(asset.filePath, "utf8");
    const parsed = parseSrt(raw, asset.language);

    const segments: TranscriptSegment[] = parsed.segments.map((segment) => ({
      id: uuidv4(),
      srtAssetId,
      idx: segment.idx,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      tokensEst: segment.tokensEst
    }));

    store.replaceSegments(srtAssetId, segments);
    store.updateSrtAssetStatus(srtAssetId, "parsed");
    enqueueTextGeneration(srtAssetId);
  });
}

export function enqueueAssetRefinement(
  srtAssetId: string,
  type: GeneratedAssetType,
  action: AssetRefineAction,
  instruction?: string
): void {
  assertRefinableAssetType(type);
  const task = taskByAssetType(type);

  enqueueLocalJob(srtAssetId, `refine_${type}_${action}`, async () => {
    const asset = store.getSrtAsset(srtAssetId);
    if (!asset) {
      throw new Error("SRT asset not found");
    }

    const segments = store.getSegments(srtAssetId);
    if (segments.length === 0) {
      throw new Error("No transcript segments available");
    }

    store.updateSrtAssetStatus(srtAssetId, "processing");

    const tunedProfile = tunedProfileForRefinement(
      asset.generationProfile,
      task,
      action,
      instruction
    );
    const recordDiagnostics: DiagnosticsWriter = (entry) => {
      store.upsertGenerationDiagnostics(entry);
    };

    const analysis = await generateNarrativeAnalysis(
      segments,
      tunedProfile,
      srtAssetId,
      recordDiagnostics
    );

    const payload = await generatePayloadForType({
      type,
      segments,
      analysis,
      durationSec: asset.durationSec ?? 0,
      profile: tunedProfile,
      srtAssetId,
      diagnostics: recordDiagnostics
    });

    store.upsertGeneratedAsset({
      srtAssetId,
      type,
      status: outputStatusForTask(srtAssetId, task),
      payload
    });
    store.updateSrtAssetStatus(srtAssetId, "done");
  });
}

export function enqueueAssetBlockRefinement(
  srtAssetId: string,
  type: GeneratedAssetType,
  blockPath: string,
  action: AssetRefineAction,
  instruction?: string,
  evidenceOnly = false
): void {
  assertRefinableAssetType(type);
  const task = taskByAssetType(type);
  const tokens = parseBlockPath(blockPath);

  enqueueLocalJob(srtAssetId, `refine_block_${type}_${action}`, async () => {
    const asset = store.getSrtAsset(srtAssetId);
    if (!asset) {
      throw new Error("SRT asset not found");
    }

    const currentGenerated = store.getGeneratedAssetByType(srtAssetId, type);
    if (!currentGenerated) {
      throw new Error("No generated asset available to refine");
    }

    const segments = store.getSegments(srtAssetId);
    if (segments.length === 0) {
      throw new Error("No transcript segments available");
    }

    store.updateSrtAssetStatus(srtAssetId, "processing");

    const tunedProfile = tunedProfileForRefinement(
      asset.generationProfile,
      task,
      action,
      instruction,
      evidenceOnly
    );
    const recordDiagnostics: DiagnosticsWriter = (entry) => {
      store.upsertGenerationDiagnostics(entry);
    };
    const analysis = await generateNarrativeAnalysis(
      segments,
      tunedProfile,
      srtAssetId,
      recordDiagnostics
    );
    const regeneratedPayload = await generatePayloadForType({
      type,
      segments,
      analysis,
      durationSec: asset.durationSec ?? 0,
      profile: tunedProfile,
      srtAssetId,
      diagnostics: recordDiagnostics
    });

    const nextValue = getValueAtPath(regeneratedPayload, tokens);
    if (nextValue === undefined) {
      throw new Error("Block path not found in regenerated payload");
    }

    const currentPayload = clonePayload(currentGenerated.payload);
    const applied = setValueAtPath(currentPayload, tokens, nextValue);
    if (!applied) {
      throw new Error("Block path not found in current payload");
    }

    store.upsertGeneratedAsset({
      srtAssetId,
      type,
      status: outputStatusForTask(srtAssetId, task),
      payload: currentPayload
    });
    store.updateSrtAssetStatus(srtAssetId, "done");
  });
}
