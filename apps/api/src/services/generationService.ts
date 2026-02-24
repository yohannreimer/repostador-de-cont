import type {
  AIProvider,
  AITask,
  AnalysisPayload,
  GenerationCtaMode,
  GenerationLength,
  GenerationProfile,
  GenerationStrategy,
  GenerationTargetOutcome,
  LinkedinPayload,
  NewsletterPayload,
  QualitySubscores,
  ReelsPayload,
  TaskScoreWeights,
  TaskGenerationDiagnostics,
  TaskVariantDiagnostics,
  TranscriptSegment,
  XPostsPayload
} from "@authority/shared";
import { z } from "zod";
import { getRouteForTask, isProviderConfigured } from "./aiRoutingService.js";
import { generateJsonCompletion } from "./llmClient.js";
import { getActivePromptTemplate, renderPromptForTask } from "./promptTemplateService.js";
import { defaultGenerationProfile } from "./generationProfileService.js";

const STOPWORDS = new Set([
  "a",
  "o",
  "as",
  "os",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "ou",
  "que",
  "com",
  "para",
  "por",
  "na",
  "no",
  "nas",
  "nos",
  "em",
  "um",
  "uma",
  "e",
  "ser",
  "se",
  "como",
  "mais",
  "menos",
  "ao",
  "aos",
  "as",
  "a",
  "voce",
  "voces",
  "eu",
  "nos",
  "ele",
  "ela",
  "eles",
  "elas"
]);

const ANALYSIS_SCHEMA = z.object({
  thesis: z.string().min(20).max(1600),
  topics: z.array(z.string().min(3).max(1600)).min(1).max(12),
  contentType: z.enum(["educational", "provocative", "story", "framework"]),
  polarityScore: z.number().min(0).max(10),
  recommendations: z.array(z.string().min(10).max(3000)).min(2).max(10),
  structure: z
    .object({
      problem: z.string().min(8).max(3000),
      tension: z.string().min(8).max(3000),
      insight: z.string().min(8).max(3000),
      application: z.string().min(8).max(3000)
    })
    .optional(),
  retentionMoments: z
    .array(
      z.object({
        text: z.string().min(8).max(2400),
        type: z.string().min(3).max(120),
        whyItGrabs: z.string().min(8).max(2400)
      })
    )
    .max(16)
    .optional(),
  editorialAngles: z
    .array(
      z.object({
        angle: z.string().min(8).max(2000),
        idealChannel: z.string().min(2).max(180),
        format: z.string().min(2).max(260),
        whyStronger: z.string().min(8).max(2400)
      })
    )
    .max(16)
    .optional(),
  weakSpots: z
    .array(
      z.object({
        issue: z.string().min(5).max(2000),
        why: z.string().min(8).max(2400)
      })
    )
    .max(16)
    .optional(),
  qualityScores: z
    .object({
      insightDensity: z.number().min(0).max(10),
      standaloneClarity: z.number().min(0).max(10),
      polarity: z.number().min(0).max(10),
      practicalValue: z.number().min(0).max(10)
    })
    .optional()
});

const NEWSLETTER_SCHEMA = z.object({
  headline: z.string().min(8).max(300),
  subheadline: z.string().min(8).max(2400),
  sections: z
    .array(
      z.union([
        z.object({ type: z.literal("intro"), text: z.string().min(10).max(5000) }),
        z.object({
          type: z.literal("insight"),
          title: z.string().min(3).max(300),
          text: z.string().min(10).max(5000)
        }),
        z.object({
          type: z.literal("application"),
          bullets: z.array(z.string().min(3).max(2400)).min(2).max(16)
        }),
        z.object({ type: z.literal("cta"), text: z.string().min(10).max(2400) })
      ])
    )
    .min(3)
    .max(16)
});

const LINKEDIN_SCHEMA = z.object({
  hook: z.string().min(8).max(2200),
  body: z.array(z.string().min(8).max(3200)).min(2).max(20),
  ctaQuestion: z.string().min(8).max(2000)
});

const X_SCHEMA = z.object({
  standalone: z.array(z.string().min(8).max(280)).min(2).max(12),
  thread: z.array(z.string().min(8).max(280)).min(2).max(16),
  notes: z.object({ style: z.string().min(3).max(300) })
});

const REELS_AI_SCHEMA = z.object({
  clips: z
    .array(
      z.object({
        startIdx: z.number().int().min(1),
        endIdx: z.number().int().min(1),
        title: z.string().min(6).max(220),
        caption: z.string().min(40).max(5000),
        hashtags: z.array(z.string().min(2).max(40)).min(1).max(12),
        whyItWorks: z.string().min(8).max(2400),
        scores: z
          .object({
            hook: z.number().min(0).max(10),
            clarity: z.number().min(0).max(10),
            retention: z.number().min(0).max(10),
            share: z.number().min(0).max(10)
          })
          .optional()
      })
    )
    .min(1)
    .max(5)
});

const REELS_SCOUT_SCHEMA = z.object({
  clips: z
    .array(
      z.object({
        startIdx: z.number().int().min(1),
        endIdx: z.number().int().min(1),
        angle: z.string().min(3).max(40).optional(),
        rationale: z.string().min(8).max(220).optional()
      })
    )
    .min(1)
    .max(5)
});

const REELS_OVERLAY_SCHEMA = z.object({
  clips: z
    .array(
      z.object({
        idx: z.number().int().min(1).max(5),
        title: z.string().min(6).max(220),
        caption: z.string().min(40).max(5000),
        hashtags: z.array(z.string().min(2).max(40)).min(1).max(12),
        whyItWorks: z.string().min(8).max(2400)
      })
    )
    .min(1)
    .max(5)
});

const REELS_FINAL_SCHEMA = z.object({
  clips: z
    .array(
      z.object({
        title: z.string().min(6).max(220),
        start: z.string().min(8).max(24),
        end: z.string().min(8).max(24),
        caption: z.string().min(40).max(5000),
        hashtags: z.array(z.string().min(2).max(40)).min(1).max(12),
        scores: z.object({
          hook: z.number().min(0).max(10),
          clarity: z.number().min(0).max(10),
          retention: z.number().min(0).max(10),
          share: z.number().min(0).max(10)
        }),
        whyItWorks: z.string().min(8).max(2400)
      })
    )
    .min(1)
    .max(5)
});

const QUALITY_SUBSCORES_SCHEMA = z.object({
  clarity: z.number().min(0).max(10),
  depth: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  applicability: z.number().min(0).max(10),
  retentionPotential: z.number().min(0).max(10)
});

const QUALITY_JUDGE_SCHEMA = z.object({
  qualityScore: z.number().min(0).max(10),
  subscores: QUALITY_SUBSCORES_SCHEMA,
  summary: z.string().min(8).max(260),
  weaknesses: z.array(z.string().min(4).max(140)).max(6).optional()
});

type AnyTaskPayload =
  | AnalysisPayload
  | ReelsPayload
  | NewsletterPayload
  | LinkedinPayload
  | XPostsPayload;

interface EvidenceLine {
  idx: number;
  start: string;
  end: string;
  text: string;
  numericTokens: string[];
  lexicalTokens: string[];
}

interface EvidenceMap {
  sourceText: string;
  numbers: Set<string>;
  lexicalTokens: Set<string>;
  lines: EvidenceLine[];
}

interface StringBlock {
  path: string;
  text: string;
}

interface PayloadValidationResult {
  ok: boolean;
  issues: string[];
  attribution: Record<string, unknown>;
}

const DEFAULT_TASK_CONFIG_BY_TASK = defaultGenerationProfile().tasks;
const COERCE_ACCEPTANCE_THRESHOLD: Record<AITask, number> = {
  analysis: 3,
  reels: 3,
  newsletter: 2,
  linkedin: 2,
  x: 2
};

function msToSrtTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor((ms % 60_000) / 1_000)
    .toString()
    .padStart(2, "0");
  const millis = Math.floor(ms % 1_000)
    .toString()
    .padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${millis}`;
}

function cleanToken(token: string): string {
  return token
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function pickTopTopics(segments: TranscriptSegment[], limit = 5): string[] {
  const counter = new Map<string, number>();

  for (const segment of segments) {
    for (const raw of segment.text.split(/\s+/)) {
      const token = cleanToken(raw);
      if (!token || token.length < 4 || STOPWORDS.has(token)) {
        continue;
      }

      counter.set(token, (counter.get(token) ?? 0) + 1);
    }
  }

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function segmentScore(segment: TranscriptSegment): number {
  const lengthScore = Math.min(4, segment.tokensEst / 6);
  const hookBonus = /\?|!/.test(segment.text) ? 2 : 0;
  const numberBonus = /\d/.test(segment.text) ? 1.5 : 0;
  const keywordBonus = /(erro|resultado|estrategia|passo|metodo|segredo|importante)/i.test(
    segment.text
  )
    ? 2
    : 0;

  return Number((lengthScore + hookBonus + numberBonus + keywordBonus).toFixed(2));
}

function takeBestSegments(segments: TranscriptSegment[], count: number): TranscriptSegment[] {
  return [...segments]
    .sort((a, b) => segmentScore(b) - segmentScore(a))
    .slice(0, count)
    .sort((a, b) => a.startMs - b.startMs);
}

function formatTranscriptSegments(segments: TranscriptSegment[], maxChars = Number.POSITIVE_INFINITY): string {
  const lines: string[] = [];
  let charBudget = maxChars;

  for (const segment of segments) {
    const line = `[${segment.idx}] ${msToSrtTimestamp(segment.startMs)}-${msToSrtTimestamp(segment.endMs)}: ${segment.text}`;
    if (charBudget !== Number.POSITIVE_INFINITY && line.length + 1 > charBudget) {
      break;
    }

    lines.push(line);
    if (charBudget !== Number.POSITIVE_INFINITY) {
      charBudget -= line.length + 1;
    }
  }

  return lines.join("\n");
}

function pickCoverageSegments(segments: TranscriptSegment[], targetCount: number): TranscriptSegment[] {
  if (segments.length <= targetCount) {
    return [...segments];
  }

  const safeTarget = Math.max(1, targetCount);
  const selected: TranscriptSegment[] = [];
  const interval = segments.length / safeTarget;

  for (let bucket = 0; bucket < safeTarget; bucket += 1) {
    const start = Math.floor(bucket * interval);
    const end = Math.min(segments.length, Math.floor((bucket + 1) * interval) + 1);
    const slice = segments.slice(start, Math.max(start + 1, end));
    if (slice.length === 0) {
      continue;
    }

    const best = slice.reduce((top, current) =>
      segmentScore(current) > segmentScore(top) ? current : top
    );
    selected.push(best);
  }

  const dedup = new Map<number, TranscriptSegment>();
  selected.forEach((item) => {
    dedup.set(item.idx, item);
  });

  return [...dedup.values()].sort((a, b) => a.startMs - b.startMs);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const clipped = text.slice(0, maxChars).trimEnd();
  const sentenceBreak = Math.max(
    clipped.lastIndexOf(". "),
    clipped.lastIndexOf("! "),
    clipped.lastIndexOf("? "),
    clipped.lastIndexOf("\n")
  );

  if (sentenceBreak >= Math.floor(maxChars * 0.6)) {
    return clipped.slice(0, sentenceBreak + 1).trim();
  }

  const lastSpace = clipped.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxChars * 0.8)) {
    return clipped.slice(0, lastSpace).trim();
  }

  return clipped;
}

function transcriptExcerpt(segments: TranscriptSegment[], maxSegments = 80): string {
  return formatTranscriptSegments(segments.slice(0, maxSegments));
}

function analysisTranscriptExcerpt(segments: TranscriptSegment[], profile: GenerationProfile): string {
  if (segments.length === 0) {
    return "";
  }

  const isMaxMode = profile.quality.mode === "max";
  const maxSegments = isMaxMode ? 160 : 120;
  const coverageTarget = isMaxMode ? 70 : 45;
  const maxChars = isMaxMode ? 42_000 : 28_000;
  const coverage = pickCoverageSegments(segments, Math.min(coverageTarget, segments.length));
  const selectedByIdx = new Map<number, TranscriptSegment>();

  for (const segment of coverage) {
    selectedByIdx.set(segment.idx, segment);
  }

  const ranked = [...segments].sort((a, b) => segmentScore(b) - segmentScore(a));
  for (const segment of ranked) {
    if (selectedByIdx.size >= Math.min(maxSegments, segments.length)) {
      break;
    }

    if (!selectedByIdx.has(segment.idx)) {
      selectedByIdx.set(segment.idx, segment);
    }
  }

  const selected = [...selectedByIdx.values()].sort((a, b) => a.startMs - b.startMs);
  const body = formatTranscriptSegments(selected, maxChars);
  return [
    `META total_segments=${segments.length} selecionados=${selected.length} modo_qualidade=${profile.quality.mode}`,
    "CRITERIO cobertura_total + trechos_de_alto_potencial",
    body
  ].join("\n");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function meetsThreshold(score: number, threshold: number, tolerance = 0.05): boolean {
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) {
    return false;
  }
  return score + tolerance >= threshold;
}

function stripEmDash(text: string): string {
  return text.replace(/[—–]/g, ", ");
}

function stripTrailingTruncationArtifacts(text: string): string {
  let current = text.trim();
  if (!current) {
    return current;
  }

  if (/[.]{3,}|…/.test(current)) {
    current = current.replace(/\s+\S*(?:\.{3,}|…)\s*$/g, "").trim();
    current = current.replace(/(?:\.{3,}|…)\s*$/g, "").trim();
  }

  return current;
}

function stripEllipsisArtifacts(text: string): string {
  return text
    .replace(/(?:\.{3,}|…)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeText(
  text: string,
  maxChars: number,
  minChars = 0,
  fallback = ""
): string {
  const normalized = stripTrailingTruncationArtifacts(
    stripEllipsisArtifacts(stripEmDash(text))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  if (normalized.length < minChars) {
    const fallbackNormalized = stripTrailingTruncationArtifacts(
      stripEllipsisArtifacts(stripEmDash(fallback))
    ).trim();
    return truncate(fallbackNormalized, maxChars);
  }

  return truncate(normalized, maxChars);
}

function extractNumericTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)?%?/g) ?? []).map((item) =>
    item.replace(/,/g, ".").trim()
  );
}

function lexicalTokenSet(text: string): Set<string> {
  const tokens = text
    .split(/\s+/)
    .map((item) => cleanToken(item))
    .filter((item) => item.length >= 4 && !STOPWORDS.has(item));

  return new Set(tokens);
}

function lexicalOverlapRatio(candidate: string, source: string): number {
  const candidateSet = lexicalTokenSet(candidate);
  const sourceSet = lexicalTokenSet(source);

  if (candidateSet.size === 0 || sourceSet.size === 0) {
    return 0;
  }

  let common = 0;
  for (const token of candidateSet) {
    if (sourceSet.has(token)) {
      common += 1;
    }
  }

  return common / candidateSet.size;
}

function countUngroundedNumericTokens(candidate: string, source: string): number {
  const sourceNumbers = new Set(extractNumericTokens(source));
  if (sourceNumbers.size === 0) {
    return extractNumericTokens(candidate).length;
  }

  return extractNumericTokens(candidate).filter((token) => !sourceNumbers.has(token)).length;
}

function countUngroundedNumericTokensFromSet(candidate: string, sourceNumbers: Set<string>): number {
  if (sourceNumbers.size === 0) {
    return extractNumericTokens(candidate).length;
  }

  return extractNumericTokens(candidate).filter((token) => !sourceNumbers.has(token)).length;
}

function containsEllipsisArtifact(text: string): boolean {
  return /(?:\.{3,}|…)/.test(text);
}

function normalizeForNumericGuard(task: AITask, path: string, text: string): string {
  let current = text;
  if (task === "x" && path.startsWith("thread[")) {
    current = current.replace(/^\s*\d+\s*\/\s*\d*\s*/, "");
  }

  if (task === "reels" && path.endsWith(".title")) {
    current = current.replace(/^\s*corte\s+\d+\s*[:.)-]?\s*/i, "");
  }

  return current;
}

function buildEvidenceMap(segments: TranscriptSegment[], maxLines = 80): EvidenceMap {
  const selected = pickCoverageSegments(segments, Math.min(maxLines, Math.max(1, segments.length)));
  const lines = selected.map((segment) => {
    const normalizedText = normalizeText(segment.text, 900, 8, segment.text);
    return {
      idx: segment.idx,
      start: msToSrtTimestamp(segment.startMs),
      end: msToSrtTimestamp(segment.endMs),
      text: normalizedText,
      numericTokens: extractNumericTokens(normalizedText),
      lexicalTokens: [...lexicalTokenSet(normalizedText)]
    };
  });

  const sourceText = segments.map((segment) => segment.text).join(" ");
  const numbers = new Set<string>(extractNumericTokens(sourceText));
  const lexicalTokens = lexicalTokenSet(sourceText);

  for (const line of lines) {
    line.numericTokens.forEach((token) => numbers.add(token));
    line.lexicalTokens.forEach((token) => lexicalTokens.add(token));
  }

  return {
    sourceText,
    numbers,
    lexicalTokens,
    lines
  };
}

function evidenceMapPromptBlock(evidenceMap: EvidenceMap, maxLines = 22): string {
  const numbers = [...evidenceMap.numbers].slice(0, 80).join(", ");
  const lines = evidenceMap.lines
    .slice(0, maxLines)
    .map(
      (line) =>
        `[${line.idx}] ${line.start}-${line.end}: ${normalizeText(line.text, 320, 8, line.text)}`
    )
    .join("\n");

  return [
    "EVIDENCE_MAP:",
    numbers ? `NUMEROS_OBSERVADOS: ${numbers}` : "NUMEROS_OBSERVADOS: nenhum",
    "TRECHOS_PRIORITARIOS:",
    lines || "sem_trechos"
  ].join("\n");
}

function collectTaskStringBlocks(task: AITask, payload: AnyTaskPayload): StringBlock[] {
  if (task === "analysis") {
    const analysis = payload as AnalysisPayload;
    const blocks: StringBlock[] = [
      { path: "thesis", text: analysis.thesis },
      ...analysis.topics.map((topic, idx) => ({ path: `topics[${idx}]`, text: topic })),
      ...analysis.recommendations.map((item, idx) => ({
        path: `recommendations[${idx}]`,
        text: item
      }))
    ];

    if (analysis.structure) {
      blocks.push(
        { path: "structure.problem", text: analysis.structure.problem },
        { path: "structure.tension", text: analysis.structure.tension },
        { path: "structure.insight", text: analysis.structure.insight },
        { path: "structure.application", text: analysis.structure.application }
      );
    }

    (analysis.retentionMoments ?? []).forEach((item, idx) => {
      blocks.push(
        { path: `retentionMoments[${idx}].text`, text: item.text },
        { path: `retentionMoments[${idx}].whyItGrabs`, text: item.whyItGrabs }
      );
    });
    (analysis.editorialAngles ?? []).forEach((item, idx) => {
      blocks.push(
        { path: `editorialAngles[${idx}].angle`, text: item.angle },
        { path: `editorialAngles[${idx}].whyStronger`, text: item.whyStronger }
      );
    });
    (analysis.weakSpots ?? []).forEach((item, idx) => {
      blocks.push(
        { path: `weakSpots[${idx}].issue`, text: item.issue },
        { path: `weakSpots[${idx}].why`, text: item.why }
      );
    });
    return blocks;
  }

  if (task === "reels") {
    const reels = payload as ReelsPayload;
    const blocks: StringBlock[] = [];
    reels.clips.forEach((clip, idx) => {
      blocks.push(
        { path: `clips[${idx}].title`, text: clip.title },
        { path: `clips[${idx}].caption`, text: clip.caption },
        { path: `clips[${idx}].whyItWorks`, text: clip.whyItWorks }
      );
    });
    return blocks;
  }

  if (task === "newsletter") {
    const newsletter = payload as NewsletterPayload;
    const blocks: StringBlock[] = [
      { path: "headline", text: newsletter.headline },
      { path: "subheadline", text: newsletter.subheadline }
    ];
    newsletter.sections.forEach((section, idx) => {
      if (section.type === "application") {
        section.bullets.forEach((bullet, bulletIdx) => {
          blocks.push({ path: `sections[${idx}].bullets[${bulletIdx}]`, text: bullet });
        });
        return;
      }
      if ("title" in section) {
        blocks.push({ path: `sections[${idx}].title`, text: section.title });
      }
      blocks.push({ path: `sections[${idx}].text`, text: section.text });
    });
    return blocks;
  }

  if (task === "linkedin") {
    const linkedin = payload as LinkedinPayload;
    return [
      { path: "hook", text: linkedin.hook },
      ...linkedin.body.map((item, idx) => ({ path: `body[${idx}]`, text: item })),
      { path: "ctaQuestion", text: linkedin.ctaQuestion }
    ];
  }

  const x = payload as XPostsPayload;
  return [
    ...x.standalone.map((item, idx) => ({ path: `standalone[${idx}]`, text: item })),
    ...x.thread.map((item, idx) => ({ path: `thread[${idx}]`, text: item })),
    { path: "notes.style", text: x.notes.style }
  ];
}

function evidenceAttributionForText(text: string, evidenceMap: EvidenceMap): Array<Record<string, unknown>> {
  const normalized = normalizeText(text, 2000, 1, text);
  if (!normalized) {
    return [];
  }

  const scored = evidenceMap.lines
    .map((line) => {
      const overlap = lexicalOverlapRatio(normalized, line.text);
      const numericPenalty = countUngroundedNumericTokensFromSet(normalized, new Set(line.numericTokens));
      const score = overlap * 0.78 + (numericPenalty === 0 ? 0.22 : 0);
      return {
        idx: line.idx,
        start: line.start,
        end: line.end,
        score,
        excerpt: normalizeText(line.text, 220, 8, line.text)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter((item) => item.score >= 0.08);

  return scored.map((item) => ({
    idx: item.idx,
    start: item.start,
    end: item.end,
    score: Number(item.score.toFixed(3)),
    excerpt: item.excerpt
  }));
}

function buildSourceAttribution(task: AITask, payload: AnyTaskPayload, evidenceMap: EvidenceMap): Record<string, unknown> {
  const blocks = collectTaskStringBlocks(task, payload);
  const attribution: Record<string, unknown> = {};
  for (const block of blocks) {
    attribution[block.path] = evidenceAttributionForText(block.text, evidenceMap);
  }
  return attribution;
}

function minByLength(length: GenerationLength, shortValue: number, standardValue: number, longValue: number): number {
  if (length === "short") {
    return shortValue;
  }
  if (length === "long") {
    return longValue;
  }
  return standardValue;
}

function hasCtaIntent(text: string, mode: GenerationCtaMode): boolean {
  const normalized = text.toLowerCase();
  if (mode === "none") {
    return true;
  }
  if (mode === "comment") {
    return /(coment|responda|qual a sua|qual foi|qual dessas|qual destes|qual voce|você|me diz|escreva|me conta|conta aqui|deixa nos comentarios|deixa nos comentários|nos comentarios|nos comentários)/i.test(
      normalized
    );
  }
  if (mode === "share") {
    return /(compartilh|manda para|envia para|envie para|marque alguem|marque alguém|salva esse|salve esse|reposta|repost)/i.test(
      normalized
    );
  }
  if (mode === "dm") {
    return /(direct|dm|inbox|me chama|mensagem privada|chama no privado)/i.test(normalized);
  }
  if (mode === "lead") {
    return /(template|material|guia|diagnostic|diagnóstico|link|aplicar|falar com|checklist|planilha|comenta .*mapa|comente .*mapa|comenta .*material|comente .*material)/i.test(
      normalized
    );
  }
  return false;
}

function toQuestionSentence(text: string): string {
  const normalized = normalizeText(text, 2000, 8).trim();
  if (!normalized) {
    return "Qual metrica concreta voce vai acompanhar na proxima semana?";
  }

  if (/\?\s*$/.test(normalized)) {
    return normalized;
  }

  if (/[.!]\s*$/.test(normalized)) {
    return `${normalized.slice(0, -1)}?`;
  }

  return `${normalized}?`;
}

interface NumericGuardLimits {
  soft: number;
  hard: number;
  payloadOverflowCap: number;
}

function numericGuardLimits(task: AITask): NumericGuardLimits {
  if (task === "analysis") {
    return { soft: 2, hard: 5, payloadOverflowCap: 6 };
  }
  if (task === "reels") {
    return { soft: 2, hard: 4, payloadOverflowCap: 5 };
  }
  if (task === "newsletter") {
    return { soft: 3, hard: 5, payloadOverflowCap: 7 };
  }
  if (task === "linkedin") {
    return { soft: 2, hard: 4, payloadOverflowCap: 5 };
  }
  return { soft: 3, hard: 6, payloadOverflowCap: 7 };
}

function hasIllustrativeNumericContext(text: string): boolean {
  return /(por exemplo|exemplo|hipotetic|simulac|cenario|cenario|suponha|imagine|digamos|estimativa|ilustrativo|caso ficticio)/i.test(
    text
  );
}

function hasHardMetricContext(text: string): boolean {
  return /(mrr|arr|cac|ltv|nps|roi|churn|taxa|convers|fatur|receita|margem|ticket|clientes|contratos|dias|meses|anos|percentual|%|r\$)/i.test(
    text
  );
}

function validatePayloadForTask(
  task: AITask,
  payload: AnyTaskPayload,
  evidenceMap: EvidenceMap,
  segments: TranscriptSegment[],
  taskProfile: GenerationProfile["tasks"][AITask] = DEFAULT_TASK_CONFIG_BY_TASK[task]
): PayloadValidationResult {
  const issues: string[] = [];
  const blocks = collectTaskStringBlocks(task, payload);
  const numericLimits = numericGuardLimits(task);
  let numericSoftOverflowCount = 0;

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) {
      continue;
    }

    if (containsEllipsisArtifact(text)) {
      issues.push(`${block.path}: truncation_artifact`);
      continue;
    }

    const normalizedForGuard = normalizeForNumericGuard(task, block.path, text);
    const ungrounded = countUngroundedNumericTokensFromSet(normalizedForGuard, evidenceMap.numbers);
    const illustrativeContext = hasIllustrativeNumericContext(normalizedForGuard);
    const hardMetricContext = hasHardMetricContext(normalizedForGuard);
    const softLimit = numericLimits.soft + (illustrativeContext ? 1 : 0);
    const hardLimit = numericLimits.hard + (illustrativeContext && !hardMetricContext ? 2 : 0);

    if (ungrounded > hardLimit) {
      issues.push(`${block.path}: numeric_claim_outside_source_hard`);
      continue;
    }

    if (ungrounded > softLimit) {
      numericSoftOverflowCount += 1;
      issues.push(
        `${block.path}: ${
          illustrativeContext && !hardMetricContext
            ? "numeric_claim_example_context"
            : "numeric_claim_outside_source"
        }`
      );
    }
  }

  if (numericSoftOverflowCount >= numericLimits.payloadOverflowCap) {
    issues.push("payload: numeric_claim_outside_source_excessive");
  }

  if (task === "reels") {
    const reels = payload as ReelsPayload;
    const startSet = new Set(segments.map((segment) => msToSrtTimestamp(segment.startMs)));
    const endSet = new Set(segments.map((segment) => msToSrtTimestamp(segment.endMs)));
    const totalDurationSec =
      segments.length > 0
        ? Math.max(1, Math.round((segments[segments.length - 1]?.endMs ?? 0) / 1000))
        : 0;
    const minDurationSec = totalDurationSec >= 90 ? 14 : totalDurationSec >= 45 ? 10 : 6;

    reels.clips.forEach((clip, idx) => {
      const durationMs = (timestampToMs(clip.end) ?? 0) - (timestampToMs(clip.start) ?? 0);
      const durationSec = Math.round(durationMs / 1000);
      const minCaptionChars = minByLength(taskProfile.length, 140, 190, 260);
      const minHashtagCount =
        taskProfile.targetOutcome === "followers" || taskProfile.targetOutcome === "shares"
          ? 5
          : 4;

      if (!startSet.has(clip.start) || !endSet.has(clip.end) || durationMs <= 0) {
        issues.push(`clips[${idx}]: invalid_timestamp_window`);
      }
      if (durationSec < minDurationSec) {
        issues.push(`clips[${idx}]: duration_too_short`);
      }
      if (durationSec > 65) {
        issues.push(`clips[${idx}]: duration_too_long`);
      }
      if (clip.title.trim().length < 16) {
        issues.push(`clips[${idx}]: title_too_short`);
      }
      if (clip.caption.trim().length < minCaptionChars) {
        issues.push(`clips[${idx}]: caption_too_short`);
      }
      if (clip.whyItWorks.trim().length < 90) {
        issues.push(`clips[${idx}]: rationale_too_shallow`);
      }
      if (clip.hashtags.length < minHashtagCount) {
        issues.push(`clips[${idx}]: hashtag_count_low`);
      }
      if (!hasCtaIntent(clip.caption, taskProfile.ctaMode)) {
        issues.push(`clips[${idx}]: missing_cta_intent`);
      }
      const windowText = transcriptWindowTextByTimestamp(segments, clip.start, clip.end);
      if (windowText) {
        const hookStrength = openingHookStrength(windowText);
        if (hookStrength < 2.5) {
          issues.push(`clips[${idx}]: weak_opening_hook`);
        }
      }
    });
  } else if (task === "newsletter") {
    const newsletter = payload as NewsletterPayload;
    const hasApplication = newsletter.sections.some((section) => section.type === "application");
    const hasCta = newsletter.sections.some((section) => section.type === "cta");
    const insightCount = newsletter.sections.filter((section) => section.type === "insight").length;
    const minInsightCount = minByLength(taskProfile.length, 2, 3, 4);
    const applicationSection = newsletter.sections.find((section) => section.type === "application");
    const minBullets = minByLength(taskProfile.length, 3, 4, 5);

    if (!hasApplication) {
      issues.push("sections: missing_application");
    }
    if (!hasCta) {
      issues.push("sections: missing_cta");
    }
    if (newsletter.headline.trim().length < 24) {
      issues.push("headline: too_short");
    }
    if (newsletter.subheadline.trim().length < 48) {
      issues.push("subheadline: too_short");
    }
    if (insightCount < minInsightCount) {
      issues.push("sections: insight_count_low");
    }
    if (applicationSection && applicationSection.bullets.length < minBullets) {
      issues.push("sections: application_bullets_low");
    }
    const insightTexts = newsletter.sections
      .filter((section): section is Extract<NewsletterPayload["sections"][number], { type: "insight" }> => section.type === "insight")
      .map((section) => section.text);
    const repeatedInsightRatio = repeatedTextRatio(insightTexts);
    if (repeatedInsightRatio >= 0.2) {
      issues.push("sections: repeated_insights");
    }
    const mechanismSignals = insightTexts.filter((text) =>
      /(porque|causa|mecanismo|alavanca|efeito|consequencia|logo)/i.test(text)
    ).length;
    if (mechanismSignals < Math.min(2, insightTexts.length)) {
      issues.push("sections: weak_causal_mechanism");
    }
    if (
      applicationSection &&
      applicationSection.type === "application" &&
      applicationSection.bullets.some((bullet) => bullet.trim().length < 28)
    ) {
      issues.push("sections: checklist_bullets_too_generic");
    }
    if (taskProfile.ctaMode !== "none") {
      const ctaSection = newsletter.sections.find((section) => section.type === "cta");
      if (!ctaSection || !hasCtaIntent(ctaSection.text, taskProfile.ctaMode)) {
        issues.push("cta: missing_intent");
      }
    }
  } else if (task === "linkedin") {
    const linkedin = payload as LinkedinPayload;
    const minParagraphs = minByLength(taskProfile.length, 4, 5, 7);
    if (linkedin.body.length < minParagraphs) {
      issues.push("body: too_short_for_linkedin");
    }
    if (linkedin.hook.trim().length < 35) {
      issues.push("hook: too_short");
    }
    if (!/\?\s*$/.test(linkedin.ctaQuestion.trim())) {
      issues.push("ctaQuestion: must_end_with_question");
    }
    const ctaMode = taskProfile.ctaMode === "none" ? "comment" : taskProfile.ctaMode;
    if (!hasCtaIntent(linkedin.ctaQuestion, ctaMode)) {
      issues.push("ctaQuestion: weak_intent");
    }
    const proofSignals = linkedin.body.filter((paragraph) =>
      /(\d|r\$|%|exemplo|caso|dados|metrica|resultado)/i.test(paragraph)
    ).length;
    if (proofSignals < 1) {
      issues.push("body: missing_proof_layer");
    }
    const frameworkSignals = linkedin.body.filter((paragraph) =>
      /(framework|passo|etapa|checklist|1\)|2\)|3\)|primeiro|segundo|terceiro)/i.test(paragraph)
    ).length;
    if (frameworkSignals < 1) {
      issues.push("body: missing_framework_layer");
    }
    if (!/(qual|quanto|quando|em quantos|que metrica|que resultado)/i.test(linkedin.ctaQuestion)) {
      issues.push("ctaQuestion: low_specificity");
    }
  } else if (task === "x") {
    const xPayload = payload as XPostsPayload;
    const minThreadPosts = minByLength(taskProfile.length, 3, 4, 5);
    const minStandalonePosts = minByLength(taskProfile.length, 2, 3, 4);
    const minPostChars = minByLength(taskProfile.length, 45, 65, 85);
    if (xPayload.thread.length < minThreadPosts) {
      issues.push("thread: too_short");
    }
    if (xPayload.standalone.length < minStandalonePosts) {
      issues.push("standalone: too_few");
    }
    [...xPayload.standalone, ...xPayload.thread].forEach((post, idx) => {
      if (post.length > 280) {
        issues.push(`x_post[${idx}]: exceeds_280`);
      }
      if (post.length < minPostChars) {
        issues.push(`x_post[${idx}]: too_short`);
      }
    });
    const ctaPool = [...xPayload.standalone, ...xPayload.thread];
    const hasAnyCta = ctaPool.some((post) => hasCtaIntent(post, taskProfile.ctaMode));
    if (!hasAnyCta) {
      issues.push("x: missing_cta_intent");
    }
  } else if (task === "analysis") {
    const analysis = payload as AnalysisPayload;
    const minTopics = Math.max(2, Math.min(4, Math.ceil(segments.length / 18)));
    const minRetentionMoments = Math.max(1, Math.min(3, Math.ceil(segments.length / 24)));
    const minRecommendations = minByLength(taskProfile.length, 3, 4, 5);
    const minWeakSpots = minByLength(taskProfile.length, 1, 2, 3);
    const minAngles = minByLength(taskProfile.length, 2, 3, 4);
    if (analysis.topics.length < minTopics) {
      issues.push("topics: too_few");
    }
    if ((analysis.retentionMoments?.length ?? 0) < minRetentionMoments) {
      issues.push("retentionMoments: too_few");
    }
    if (analysis.recommendations.length < minRecommendations) {
      issues.push("recommendations: too_few");
    }
    if ((analysis.weakSpots?.length ?? 0) < minWeakSpots) {
      issues.push("weakSpots: too_few");
    }
    if ((analysis.editorialAngles?.length ?? 0) < minAngles) {
      issues.push("editorialAngles: too_few");
    }
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    ok: uniqueIssues.length === 0,
    issues: uniqueIssues.slice(0, 8),
    attribution: buildSourceAttribution(task, payload, evidenceMap)
  };
}

function isBlockingValidationIssue(issue: string): boolean {
  const normalized = issue.toLowerCase();
  if (normalized.includes("missing_cta_intent")) return false;
  if (normalized.includes("weak_intent")) return false;
  if (normalized.includes("low_specificity")) return false;
  if (issue.includes("invalid_timestamp_window")) return true;
  if (issue.includes("duration_too_short")) return true;
  if (issue.includes("duration_too_long")) return true;
  if (issue.includes("truncation_artifact")) return true;
  if (issue.includes("exceeds_280")) return true;
  if (issue.includes("missing_application")) return true;
  if (issue.includes("sections: missing_cta")) return true;
  if (issue.includes("headline: too_short")) return true;
  if (issue.includes("subheadline: too_short")) return true;
  if (issue.includes("hook: too_short")) return true;
  if (issue.includes("must_end_with_question")) return false;
  if (issue.includes("body: too_short_for_linkedin")) return true;
  if (issue.includes("thread: too_short")) return true;
  if (issue.includes("standalone: too_few")) return false;
  if (issue.includes("x_post[") && issue.includes("too_short")) return false;
  if (issue.includes("numeric_claim_outside_source_excessive")) return true;
  if (issue.includes("numeric_claim_outside_source_hard")) return true;

  return false;
}

function blockingValidationIssues(validation: PayloadValidationResult): string[] {
  return validation.issues.filter((issue) => isBlockingValidationIssue(issue));
}

function variantOutputWithEvidence(
  task: AITask,
  payload: AnyTaskPayload,
  evidenceMap: EvidenceMap,
  segments: TranscriptSegment[],
  validation?: PayloadValidationResult,
  taskProfile?: GenerationProfile["tasks"][AITask]
): Record<string, unknown> {
  const base = compactVariantRecord(payload) ?? {};
  const finalValidation =
    validation ?? validatePayloadForTask(task, payload, evidenceMap, segments, taskProfile);
  return {
    ...base,
    _sourceAttribution: finalValidation.attribution,
    _validation: {
      ok: finalValidation.ok,
      issues: finalValidation.issues
    }
  };
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parts[0] ?? trimmed;
}

function splitSentences(text: string): string[] {
  const normalized = normalizeText(text, 5000, 1, text);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 14);
}

function trimLeadingFiller(text: string): string {
  return text
    .replace(
      /^(ent[aã]o|tipo|assim|cara|galera|beleza|bom|olha|veja|vamos la|vamos lá|se eu tivesse um conselho[,.:]?)\s*/i,
      ""
    )
    .trim();
}

function pickSentenceBySignal(
  sentences: string[],
  signalPattern: RegExp,
  fallback = ""
): string {
  if (sentences.length === 0) {
    return fallback;
  }

  const ranked = sentences
    .map((sentence, index) => {
      let score = openingHookStrength(sentence);
      if (signalPattern.test(sentence)) {
        score += 2.2;
      }
      if (/\d|%|r\$/i.test(sentence)) {
        score += 0.9;
      }
      if (/\?|\!/.test(sentence)) {
        score += 0.7;
      }
      if (index === 0) {
        score += 0.35;
      }
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.sentence ?? fallback;
}

function sentenceWithoutTrailingPunctuation(text: string): string {
  return text.replace(/[.!?]+$/g, "").trim();
}

function fitXPostLength(text: string, fallback = ""): string {
  const normalized = normalizeText(text, 1600, 8, fallback);
  if (normalized.length <= 280) {
    return normalized;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const threadPrefixMatch = normalized.match(/^\s*(\d+\s*\/\s*\d+\s*)/);
  const threadPrefix = threadPrefixMatch?.[1]?.trim() ?? "";
  const contentWithoutPrefix = threadPrefix
    ? normalized.slice(threadPrefix.length).trim()
    : normalized;

  const coreSentences = contentWithoutPrefix
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const punchlineScore = (sentence: string): number => {
    let score = 0;
    if (/\d|%|r\$/i.test(sentence)) {
      score += 1.3;
    }
    if (/\b(erro|regra|framework|passo|resultado|prova|cuidado|pare|nunca|evite)\b/i.test(sentence)) {
      score += 1.6;
    }
    if (/\?|!/.test(sentence)) {
      score += 0.8;
    }
    score += Math.min(1.2, sentence.length / 180);
    return score;
  };

  const ordered = coreSentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: punchlineScore(sentence) + (index === 0 ? 0.7 : 0)
    }))
    .sort((a, b) => b.score - a.score);

  const selected: string[] = [];
  for (const candidate of ordered) {
    if (selected.includes(candidate.sentence)) {
      continue;
    }
    selected.push(candidate.sentence);
    if (selected.length >= 2) {
      break;
    }
  }

  const compactBase = [coreSentences[0], ...selected]
    .filter((item): item is string => Boolean(item))
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .join(" ");
  const compactWithPrefix = threadPrefix
    ? `${threadPrefix} ${compactBase}`.trim()
    : compactBase;
  const compact = normalizeText(compactWithPrefix, 280, 8, fallback);

  if (compact.length >= 80) {
    return compact;
  }

  let sequentialCompact = "";
  for (const sentence of sentences) {
    const next = sequentialCompact ? `${sequentialCompact} ${sentence}` : sentence;
    if (next.length > 280) {
      break;
    }
    sequentialCompact = next;
  }
  if (sequentialCompact.length >= 80) {
    return sequentialCompact;
  }

  return normalizeText(normalized, 280, 8, fallback);
}

function dedupeXPosts(posts: string[]): string[] {
  const result: string[] = [];
  for (const post of posts) {
    const normalized = normalizeText(post, 1600, 8);
    if (!normalized) {
      continue;
    }

    const duplicate = result.some((existing) => lexicalOverlapRatio(existing, normalized) >= 0.92);
    if (!duplicate) {
      result.push(normalized);
    }
  }
  return result;
}

function enrichXPostForPublish(post: string, minChars: number, fallbackTail: string): string {
  const normalized = fitXPostLength(post, fallbackTail);
  if (normalized.length >= minChars) {
    return normalized;
  }

  const enriched = fitXPostLength(`${normalized} ${fallbackTail}`.trim(), fallbackTail);
  if (enriched.length >= minChars) {
    return enriched;
  }

  return enriched.length > normalized.length ? enriched : normalized;
}

function normalizeThreadNumbering(posts: string[]): string[] {
  const numbered = posts.filter((post) => /^\s*\d+\s*\/\s*\d+\s+/.test(post));
  if (numbered.length < Math.max(2, Math.ceil(posts.length / 2))) {
    return posts;
  }

  const total = posts.length;
  return posts.map((post, idx) => {
    const content = post.replace(/^\s*\d+\s*\/\s*\d+\s+/, "").trim();
    return fitXPostLength(`${idx + 1}/${total} ${content}`.trim(), content);
  });
}

function sourceAnchoredCaption(sourceText: string, cta: string, fallback = ""): string {
  const sentences = splitSentences(sourceText);
  const fallbackSeed = firstSentence(sourceText) || fallback;
  const hookSeed = trimLeadingFiller(
    pickSentenceBySignal(sentences, PAIN_SIGNAL_PATTERN, fallbackSeed)
  );
  const insightSeed = trimLeadingFiller(
    pickSentenceBySignal(
      sentences.filter((sentence) => lexicalOverlapRatio(sentence, hookSeed) < 0.86),
      /(porque|por isso|quando|se|regra|metodo|framework|resultado|cliente|venda)/i,
      fallbackSeed
    )
  );
  const actionSeed = trimLeadingFiller(
    pickSentenceBySignal(
      sentences.filter(
        (sentence) =>
          lexicalOverlapRatio(sentence, hookSeed) < 0.9 &&
          lexicalOverlapRatio(sentence, insightSeed) < 0.9
      ),
      ACTION_SIGNAL_PATTERN,
      insightSeed || hookSeed || fallbackSeed
    )
  );

  const hookCore = sentenceWithoutTrailingPunctuation(
    normalizeText(hookSeed, 170, 18, fallbackSeed)
  );
  const insightCore = sentenceWithoutTrailingPunctuation(
    normalizeText(insightSeed, 190, 24, hookCore || fallbackSeed)
  );
  const actionCore = sentenceWithoutTrailingPunctuation(
    normalizeText(actionSeed, 170, 22, insightCore || hookCore || fallbackSeed)
  );

  const hookLine = /\?$/.test(hookSeed.trim())
    ? normalizeText(hookSeed, 180, 18, hookCore || fallbackSeed)
    : normalizeText(
        PAIN_SIGNAL_PATTERN.test(hookCore)
          ? `Ponto critico: ${hookCore}.`
          : `Insight que muda o resultado: ${hookCore}.`,
        220,
        18,
        hookCore || fallbackSeed
      );
  const insightLine = normalizeText(
    `No corte: ${insightCore}.`,
    260,
    26,
    insightCore || hookCore || fallbackSeed
  );
  const actionLine = normalizeText(
    ACTION_SIGNAL_PATTERN.test(actionCore)
      ? `Aplicacao imediata: ${actionCore}.`
      : "Aplicacao imediata: execute este ajuste hoje e compare o resultado em 7 dias.",
    260,
    24,
    "Aplicacao imediata: execute este ajuste hoje e compare o resultado em 7 dias."
  );

  const lines = [hookLine, insightLine, actionLine]
    .map((line) => normalizeText(line, 300, 8, line))
    .filter((line, index, arr) => {
      const duplicated = arr
        .slice(0, index)
        .some((existing) => lexicalOverlapRatio(existing, line) >= 0.92);
      return !duplicated;
    });
  if (cta) {
    lines.push(normalizeText(cta, 260, 8, cta));
  }

  return normalizeText(lines.join("\n\n"), 5000, 140, fallbackSeed || fallback);
}

function sourceAnchoredTitle(sourceText: string, fallback = ""): string {
  const sentences = splitSentences(sourceText);
  const seed = trimLeadingFiller(
    pickSentenceBySignal(sentences, STRONG_HOOK_PATTERN, firstSentence(sourceText) || fallback)
  );
  const base = sentenceWithoutTrailingPunctuation(
    normalizeText(seed || sourceText, 200, 8, fallback)
  );
  if (!base) {
    return normalizeText(fallback || sourceText, 220, 6, fallback);
  }

  if (PAIN_SIGNAL_PATTERN.test(base)) {
    return normalizeText(base, 220, 6, fallback);
  }

  if (base.split(/\s+/).length < 6) {
    return normalizeText(`Erro recorrente: ${base}`, 220, 6, fallback);
  }

  return normalizeText(base, 220, 6, fallback);
}

function sourceAnchoredWhyItWorks(sourceText: string, cta: string, fallback = ""): string {
  const opening = firstSentence(sourceText);
  const hookStrength = openingHookStrength(sourceText);
  const hookLabel =
    hookStrength >= 2.8 ? "gancho forte" : hookStrength >= 2.2 ? "gancho claro" : "gancho moderado";
  const hasProofSignal = /(\d|%|r\$|caso|exemplo|resultado|metrica|prova)/i.test(sourceText);
  const proofSentence = hasProofSignal
    ? "O trecho tem sinal concreto que aumenta credibilidade e favorece compartilhamento."
    : "O trecho expõe uma dor real com linguagem direta e permite aplicacao pratica sem contexto externo.";
  const ctaSentence = cta
    ? "O CTA final direciona uma acao objetiva para transformar atencao em interacao qualificada."
    : "A mensagem fecha com proximo passo claro para manter retencao ate o final.";

  return normalizeText(
    `A abertura trabalha ${hookLabel} com frase de impacto: "${opening}". ${proofSentence} ${ctaSentence}`,
    2400,
    120,
    fallback
  );
}

function applyReelsSourceGrounding(
  clip: { title: string; caption: string; whyItWorks: string },
  sourceText: string,
  fallback: { title: string; caption: string; whyItWorks: string } | null,
  cta: string
): { title: string; caption: string; whyItWorks: string } {
  const safeSource = sourceText.trim();
  if (!safeSource) {
    return clip;
  }

  const titleUngroundedNumbers = countUngroundedNumericTokens(clip.title, safeSource);
  const captionUngroundedNumbers = countUngroundedNumericTokens(clip.caption, safeSource);
  const captionOverlap = lexicalOverlapRatio(clip.caption, safeSource);
  const titleOverlap = lexicalOverlapRatio(clip.title, safeSource);
  const titleGeneric = /^corte\s+\d+/i.test(clip.title.trim());
  const captionHasTruncation = containsEllipsisArtifact(clip.caption);

  const shouldRewriteCaption =
    captionUngroundedNumbers > 0 ||
    captionHasTruncation ||
    clip.caption.trim().length < 130 ||
    (clip.caption.length > 220 && captionOverlap >= 0.9);
  const shouldRewriteTitle =
    titleUngroundedNumbers > 0 ||
    titleGeneric ||
    clip.title.trim().length < 16 ||
    (clip.title.length > 80 && titleOverlap >= 0.95);

  const title = shouldRewriteTitle
    ? sourceAnchoredTitle(safeSource, fallback?.title ?? clip.title)
    : normalizeText(clip.title, 220, 6, fallback?.title ?? clip.title);
  const caption = shouldRewriteCaption
    ? sourceAnchoredCaption(safeSource, cta, fallback?.caption ?? clip.caption)
    : normalizeText(clip.caption, 5000, 40, fallback?.caption ?? clip.caption);
  const whyItWorks =
    shouldRewriteCaption || shouldRewriteTitle
      ? sourceAnchoredWhyItWorks(safeSource, cta, fallback?.whyItWorks ?? clip.whyItWorks)
      : normalizeText(
          clip.whyItWorks,
          2400,
          90,
          sourceAnchoredWhyItWorks(safeSource, cta, fallback?.whyItWorks ?? clip.whyItWorks)
        );

  return { title, caption, whyItWorks };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }

        if (typeof item === "number" && Number.isFinite(item)) {
          return String(item).trim();
        }

        const record = asRecord(item);
        if (!record) {
          return null;
        }

        return pickString(
          record.text,
          record.content,
          record.body,
          record.copy,
          record.value,
          record.line,
          record.bullet,
          record.tweet,
          record.post,
          record.title,
          record.headline
        );
      })
      .filter((item): item is string => Boolean(item))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(/[,\n;]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  const record = asRecord(value);
  if (record) {
    const nestedArrays = [
      record.items,
      record.lines,
      record.list,
      record.bullets,
      record.posts,
      record.tweets,
      record.thread,
      record.values
    ];
    for (const nested of nestedArrays) {
      const parsed = asStringArray(nested);
      if (parsed.length > 0) {
        return parsed;
      }
    }

    const single = pickString(
      record.text,
      record.content,
      record.body,
      record.value
    );
    if (single) {
      return asStringArray(single);
    }
  }

  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function unwrapTaskOutput(task: AITask, output: Record<string, unknown>): Record<string, unknown> {
  const direct = asRecord(output);
  if (!direct) {
    return output;
  }

  const wrappers = ["output", "result", "data", "payload", "content", "response", "completion"];
  for (const key of wrappers) {
    const nested = asRecord(direct[key]);
    if (nested) {
      return unwrapTaskOutput(task, nested);
    }
  }

  const taskSpecificKeys: Record<AITask, string[]> = {
    analysis: ["analysis"],
    reels: ["reels", "clips"],
    newsletter: ["newsletter"],
    linkedin: ["linkedin"],
    x: ["x", "posts", "tweets", "twitter"]
  };

  for (const key of taskSpecificKeys[task]) {
    if (key === "clips" && Array.isArray(direct[key])) {
      return { clips: direct[key] as unknown[] };
    }

    const nested = asRecord(direct[key]);
    if (nested) {
      return nested;
    }
  }

  if (task === "x") {
    const postsObject = asRecord(direct.posts);
    if (postsObject) {
      return {
        standalone:
          postsObject.standalone ??
          postsObject.standalonePosts ??
          postsObject.standalone_posts ??
          postsObject.posts,
        thread:
          postsObject.thread ??
          postsObject.threadPosts ??
          postsObject.thread_posts ??
          postsObject.threadTweets,
        notes: postsObject.notes ?? direct.notes
      } as Record<string, unknown>;
    }
  }

  if (task === "newsletter") {
    const newsletterObject = asRecord(direct.newsletter);
    if (newsletterObject) {
      return {
        headline:
          newsletterObject.headline ??
          newsletterObject.title ??
          newsletterObject.bestHeadline ??
          newsletterObject.best_headline,
        subheadline:
          newsletterObject.subheadline ??
          newsletterObject.subtitle ??
          newsletterObject.subTitle ??
          newsletterObject.sub_title,
        sections:
          newsletterObject.sections ??
          newsletterObject.blocks ??
          newsletterObject.structure ??
          newsletterObject.content,
        insights: newsletterObject.insights ?? newsletterObject.keyInsights,
        application:
          newsletterObject.application ??
          newsletterObject.checklist ??
          newsletterObject.steps,
        cta:
          newsletterObject.cta ??
          newsletterObject.callToAction ??
          newsletterObject.call_to_action
      } as Record<string, unknown>;
    }
  }

  return direct;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitListLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((item) => item.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((item) => item.length > 0);
}

function normalizeTimestampToken(raw: string): string | null {
  const cleaned = raw.trim().replace(",", ".");
  const match = cleaned.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }

  const hours = String(Number(match[1] ?? "0")).padStart(2, "0");
  const minutes = String(Number(match[2] ?? "0")).padStart(2, "0");
  const seconds = String(Number(match[3] ?? "0")).padStart(2, "0");
  const msRaw = match[4] ?? "0";
  const millis = msRaw.padEnd(3, "0").slice(0, 3);
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

function timestampToMs(value: string): number | null {
  const normalized = normalizeTimestampToken(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const millis = Number(match[4] ?? 0);
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + millis;
}

function transcriptWindowTextByTimestamp(
  segments: TranscriptSegment[],
  startToken: string,
  endToken: string
): string {
  const startMs = timestampToMs(startToken);
  const endMs = timestampToMs(endToken);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return "";
  }

  const chunks = segments
    .filter((segment) => segment.startMs >= startMs && segment.endMs <= endMs)
    .map((segment) => segment.text);

  return chunks.join(" ").trim();
}

function parseTimestampRange(raw: string): { start: string; end: string } | null {
  const tokens = raw.match(/\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?/g);
  if (!tokens || tokens.length < 2) {
    return null;
  }

  const start = normalizeTimestampToken(tokens[0]);
  const end = normalizeTimestampToken(tokens[1]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

function zodIssueSummary(error: z.ZodError, maxIssues = 3): string {
  const issues = error.issues.slice(0, maxIssues).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });

  return issues.join(" | ");
}

function candidateFingerprint<T>(value: T): string {
  return JSON.stringify(value);
}

function getTaskProfile(
  generationProfile: GenerationProfile | undefined,
  task: AITask
): GenerationProfile["tasks"][AITask] {
  const resolved = generationProfile ?? defaultGenerationProfile();
  return resolved.tasks[task];
}

function promptConfigVariables(
  generationProfile: GenerationProfile | undefined,
  task: AITask
): Record<string, string> {
  const resolved = generationProfile ?? defaultGenerationProfile();
  const taskProfile = getTaskProfile(resolved, task);
  const taskMemory = resolved.performanceMemory[task];

  return {
    audience: resolved.audience,
    goal: resolved.goal,
    tone: resolved.tone,
    language: resolved.language,
    strategy: taskProfile.strategy,
    focus: taskProfile.focus,
    target_outcome: taskProfile.targetOutcome,
    audience_level: taskProfile.audienceLevel,
    length: taskProfile.length,
    cta_mode: taskProfile.ctaMode,
    quality_mode: resolved.quality.mode,
    quality_variations: String(resolved.quality.variationCount),
    quality_refine_passes: String(resolved.quality.refinePasses),
    voice_identity: resolved.voice.identity,
    voice_rules: resolved.voice.writingRules,
    voice_banned_terms: resolved.voice.bannedTerms,
    voice_signature_phrases: resolved.voice.signaturePhrases,
    performance_wins: taskMemory.wins,
    performance_avoid: taskMemory.avoid,
    performance_kpi: taskMemory.kpi,
    generation_profile_json: JSON.stringify(resolved),
    task_profile_json: JSON.stringify(taskProfile),
    performance_memory_json: JSON.stringify(taskMemory)
  };
}

function qualityPlanByProfile(profile: GenerationProfile, task: AITask): {
  variationCount: number;
  refinePasses: number;
} {
  const isMax = profile.quality.mode === "max";
  const minVariations = isMax ? 2 : 1;
  const minRefines = 1;
  const hardVariationCap = isMax ? (task === "analysis" ? 3 : 4) : (task === "analysis" ? 1 : 2);
  const hardRefineCap = isMax ? 3 : 1;
  return {
    variationCount: Math.max(
      minVariations,
      Math.min(hardVariationCap, Math.min(8, profile.quality.variationCount))
    ),
    refinePasses: Math.max(
      minRefines,
      Math.min(hardRefineCap, Math.min(3, profile.quality.refinePasses))
    )
  };
}

function qualityThresholdByProfile(task: AITask, profile: GenerationProfile): number {
  const base = TASK_QUALITY_THRESHOLD[task];
  if (profile.quality.mode !== "max") {
    return base;
  }

  const boost =
    task === "analysis"
      ? 0.4
      : task === "reels"
        ? 0.3
        : task === "newsletter"
          ? 0.25
          : 0.2;

  return roundScore(Math.min(9.2, base + boost));
}

function publishabilityThresholdByProfile(task: AITask, profile: GenerationProfile): number {
  const base = TASK_PUBLISHABILITY_THRESHOLD[task];
  if (profile.quality.mode !== "max") {
    return base;
  }

  const boost =
    task === "analysis"
      ? 0.2
      : task === "reels"
        ? 0.25
        : task === "newsletter"
          ? 0.2
          : 0.15;

  return roundScore(Math.min(9.2, base + boost));
}

function promptControlAppendix(profile: GenerationProfile, task: AITask): string {
  const taskProfile = profile.tasks[task];
  const memory = profile.performanceMemory[task];
  const qualityPlan = qualityPlanByProfile(profile, task);
  return [
    "BLOCO DE CONTROLE EDITORIAL:",
    `- modo_qualidade: ${profile.quality.mode}`,
    `- variacoes_objetivo: ${qualityPlan.variationCount}`,
    `- refine_passes_objetivo: ${qualityPlan.refinePasses}`,
    `- foco_tarefa: ${taskProfile.focus}`,
    `- outcome_tarefa: ${taskProfile.targetOutcome}`,
    `- nivel_publico: ${taskProfile.audienceLevel}`,
    `- voice_identity: ${profile.voice.identity}`,
    `- voice_rules: ${profile.voice.writingRules}`,
    `- voice_banned_terms: ${profile.voice.bannedTerms || "nenhum"}`,
    `- voice_signature_phrases: ${profile.voice.signaturePhrases || "nenhuma"}`,
    `- performance_wins: ${memory.wins || "sem historico"}`,
    `- performance_avoid: ${memory.avoid || "sem historico"}`,
    `- performance_kpi: ${memory.kpi || "nao definido"}`,
    "Regra: nunca usar travessao.",
    "Regra: nunca entregar texto truncado com reticencias."
  ].join("\n");
}

function taskPromptHardRules(task: AITask): string {
  if (task === "analysis") {
    return [
      "BLOCO CRITICO ANALISE:",
      "1) Tese precisa trazer mecanismo causal, nao resumo superficial.",
      "2) Topicos devem ser especificos, sem tokens vagos e sem repeticao.",
      "3) Retention moments precisam citar trechos defensaveis pela transcricao.",
      "4) Recomendacoes devem ser implementaveis em conteudo real.",
      "5) qualityScores acima de 8 so quando houver evidencias claras no texto.",
      "6) JSON alvo deve incluir thesis, topics, contentType, polarityScore, recommendations, structure, retentionMoments, editorialAngles, weakSpots e qualityScores."
    ].join("\n");
  }

  if (task === "reels") {
    return [
      "BLOCO CRITICO REELS:",
      "1) Evite abertura protocolar e trechos sem friccao.",
      "2) Priorize cortes com conflito, alerta, regra ou prova pratica.",
      "3) Nao use titulo generico nem CTA vazio."
    ].join("\n");
  }

  if (task === "x") {
    return [
      "BLOCO CRITICO X:",
      "1) Nao abrevie texto com reticencias.",
      "2) Nao entregue frases truncadas.",
      "3) Cada post precisa fechar uma unidade de pensamento."
    ].join("\n");
  }

  return "";
}

function taskOutputContract(task: AITask): string {
  if (task === "analysis") {
    return [
      "CONTRATO_JSON_ANALYSIS:",
      '{ "thesis": "...", "topics": ["..."], "contentType": "educational|provocative|story|framework", "polarityScore": 0, "recommendations": ["..."], "structure": { "problem": "...", "tension": "...", "insight": "...", "application": "..." }, "retentionMoments": [ { "text": "...", "type": "...", "whyItGrabs": "..." } ], "editorialAngles": [ { "angle": "...", "idealChannel": "...", "format": "...", "whyStronger": "..." } ], "weakSpots": [ { "issue": "...", "why": "..." } ], "qualityScores": { "insightDensity": 0, "standaloneClarity": 0, "polarity": 0, "practicalValue": 0 } }'
    ].join("\n");
  }

  if (task === "reels") {
    return [
      "CONTRATO_JSON_REELS:",
      '{ "clips": [ { "startIdx": 1, "endIdx": 2, "title": "...", "caption": "...", "hashtags": ["#..."], "whyItWorks": "...", "scores": { "hook": 0, "clarity": 0, "retention": 0, "share": 0 } } ] }'
    ].join("\n");
  }

  if (task === "newsletter") {
    return [
      "CONTRATO_JSON_NEWSLETTER:",
      '{ "headline": "...", "subheadline": "...", "sections": [ { "type": "intro", "text": "..." }, { "type": "insight", "title": "...", "text": "..." }, { "type": "application", "bullets": ["..."] }, { "type": "cta", "text": "..." } ] }'
    ].join("\n");
  }

  if (task === "linkedin") {
    return [
      "CONTRATO_JSON_LINKEDIN:",
      '{ "hook": "...", "body": ["..."], "ctaQuestion": "..." }'
    ].join("\n");
  }

  return [
    "CONTRATO_JSON_X:",
    '{ "standalone": ["..."], "thread": ["..."], "notes": { "style": "..." } }'
  ].join("\n");
}

function withPromptControls(
  baseUserPrompt: string,
  profile: GenerationProfile,
  task: AITask,
  evidenceMap?: EvidenceMap
): string {
  const hardRules = taskPromptHardRules(task);
  const outputContract = taskOutputContract(task);
  const evidenceBlock = evidenceMap
    ? `${evidenceMapPromptBlock(evidenceMap)}\nREGRA CRITICA: Nao apresentar numero factual fora do EVIDENCE_MAP. Numeros ilustrativos so com marcador explicito de exemplo hipotetico.`
    : "";
  const appendix = [promptControlAppendix(profile, task), evidenceBlock].filter((item) => item).join("\n");
  if (!hardRules) {
    return `${baseUserPrompt}\n\n${appendix}\n${outputContract}\nINSTRUCAO FINAL: entregue SOMENTE JSON valido no contrato.`;
  }

  return `${baseUserPrompt}\n\n${appendix}\n${hardRules}\n${outputContract}\nINSTRUCAO FINAL: entregue SOMENTE JSON valido no contrato.`;
}

function variationDirective(task: AITask, variantIndex: number, variationCount: number): string {
  if (variantIndex === 0) {
    return `Variacao ${variantIndex + 1}/${variationCount}. Entregue a melhor versao possivel.`;
  }

  if (task === "reels") {
    return `Variacao ${variantIndex + 1}/${variationCount}. Diferencie angulos, evite repeticao semantica e maximize potencial de seguir perfil.`;
  }

  if (task === "newsletter") {
    return `Variacao ${variantIndex + 1}/${variationCount}. Traga estrutura diferente, com profundidade pratica e aplicacao mais forte.`;
  }

  if (task === "linkedin") {
    return `Variacao ${variantIndex + 1}/${variationCount}. Priorize gancho alternativo e progressao argumentativa distinta.`;
  }

  if (task === "x") {
    return `Variacao ${variantIndex + 1}/${variationCount}. Traga novos hooks e thread com progressao diferente.`;
  }

  return `Variacao ${variantIndex + 1}/${variationCount}. Diferencie tese e recomendacoes sem perder fidelidade ao texto.`;
}

function ctaVariantsByMode(
  mode: GenerationCtaMode,
  goal?: string,
  targetOutcome?: GenerationTargetOutcome
): string[] {
  const growthGoal =
    targetOutcome === "followers" ||
    (goal ? /(seguidor|seguidores|audiencia|audiência|alcance|crescer perfil)/i.test(goal) : false);

  if (mode === "comment") {
    return growthGoal
      ? [
          "Comente sua maior trava e a metrica que vai acompanhar pelos proximos 7 dias. Siga para mais recortes praticos.",
          "Comente qual etapa voce vai executar hoje e volte em 7 dias com o resultado. Siga para os proximos cortes.",
          "Comente o seu principal bloqueio e a meta da semana para eu sugerir o proximo passo."
        ]
      : [
          "Comente sua maior trava e o prazo que voce vai usar para testar este passo.",
          "Comente qual acao voce vai executar hoje e que metrica vai medir ate a proxima semana.",
          "Comente o contexto da sua operacao para eu sugerir um proximo passo objetivo."
        ];
  }

  if (mode === "share") {
    return growthGoal
      ? [
          "Compartilhe com quem precisa aplicar isso hoje e siga para receber os proximos cortes.",
          "Envie para um parceiro de operacao e comparem a metrica em 7 dias.",
          "Marque alguem que precisa ajustar este ponto ainda esta semana."
        ]
      : [
          "Compartilhe com um parceiro que precisa aplicar isso hoje.",
          "Envie para o time e definam a metrica de validacao para os proximos 7 dias.",
          "Marque alguem que precisa executar este passo no ciclo atual."
        ];
  }

  if (mode === "dm") {
    return growthGoal
      ? [
          "Me chama no direct com a palavra diagnostico e siga para a serie completa.",
          "Me chama no direct com a palavra mapa que eu envio a estrutura aplicada.",
          "Me chama no direct com a palavra roteiro para receber o passo a passo."
        ]
      : [
          "Me chama no direct com a palavra diagnostico para receber um plano inicial.",
          "Me chama no direct com a palavra mapa e eu envio a estrutura base.",
          "Me chama no direct com a palavra roteiro para iniciar com prioridade."
        ];
  }

  if (mode === "lead") {
    return growthGoal
      ? [
          "Se quiser o template completo, comente material e siga para os proximos.",
          "Comente mapa que eu envio o checklist completo para aplicar hoje.",
          "Comente plano e eu envio o modelo de execucao em etapas."
        ]
      : [
          "Se quiser o template completo, responda este post e eu envio o material.",
          "Comente mapa para receber o checklist com o passo a passo inicial.",
          "Comente plano e eu envio o modelo com estrutura de execucao."
        ];
  }

  return growthGoal
    ? [
        "Se isso te ajudou, siga para os proximos recortes.",
        "Siga para receber a proxima parte com aplicacao por canal.",
        "Siga e salve este conteudo para aplicar no proximo ciclo."
      ]
    : [
        "Aplique este passo no proximo conteudo que voce publicar.",
        "Implemente hoje e compare o resultado em 7 dias.",
        "Execute este ajuste no proximo ciclo e me conte o resultado."
      ];
}

function ctaByMode(mode: GenerationCtaMode, goal?: string, targetOutcome?: GenerationTargetOutcome): string {
  const options = ctaVariantsByMode(mode, goal, targetOutcome);
  return options[0] ?? "";
}

function hashtagsByStrategy(strategy: GenerationStrategy): string[] {
  if (strategy === "provocative") {
    return ["#opiniao", "#autoridade", "#negocios"];
  }

  if (strategy === "educational") {
    return ["#aprendizado", "#conteudoeducativo", "#estrategia"];
  }

  if (strategy === "contrarian") {
    return ["#contrarian", "#marketingsmart", "#posicionamento"];
  }

  if (strategy === "framework") {
    return ["#framework", "#metodo", "#execucao"];
  }

  if (strategy === "storytelling") {
    return ["#storytelling", "#narrativa", "#comunicacao"];
  }

  return ["#conteudo", "#distribuicao", "#crescimento"];
}

function normalizeHashtag(tag: string): string | null {
  const normalized = cleanToken(tag.replace(/^#/, ""));

  if (normalized.length < 3 || normalized.length > 24) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return null;
  }

  return `#${normalized}`;
}

function sanitizeHashtags(tags: string[], fallbackTags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const source of [...tags, ...fallbackTags]) {
    const hashtag = normalizeHashtag(source);
    if (!hashtag || seen.has(hashtag)) {
      continue;
    }

    seen.add(hashtag);
    result.push(hashtag);
    if (result.length >= 8) {
      break;
    }
  }

  if (result.length >= 3) {
    return result;
  }

  return ["#conteudo", "#negocios", "#crescimento"];
}

function resolveReelsClipCount(durationSec: number, length: GenerationLength): number {
  const baseClipCount = durationSec < 240 ? 2 : 3;
  const lengthOffset =
    length === "long" ? (durationSec >= 600 ? 1 : 0) : length === "short" ? -1 : 0;
  return Math.max(2, Math.min(4, baseClipCount + lengthOffset));
}

function resolveReelsDurationPolicy(
  durationSec: number,
  length: GenerationLength,
  targetOutcome: GenerationTargetOutcome = "followers"
): { minDurationMs: number; targetDurationMs: number; maxDurationMs: number } {
  const lengthPreset =
    length === "short"
      ? { min: 16_000, target: 22_000, max: 34_000 }
      : length === "long"
        ? { min: 24_000, target: 34_000, max: 52_000 }
        : { min: 20_000, target: 30_000, max: 45_000 };
  const outcomeOffset =
    targetOutcome === "followers"
      ? { min: -2_000, target: -4_000, max: -4_000 }
      : targetOutcome === "shares"
        ? { min: 0, target: 1_000, max: 2_000 }
        : targetOutcome === "leads"
          ? { min: 2_000, target: 4_000, max: 5_000 }
          : targetOutcome === "authority"
            ? { min: 1_000, target: 3_000, max: 4_000 }
            : { min: 0, target: 0, max: 0 };

  const preset = {
    min: Math.max(10_000, lengthPreset.min + outcomeOffset.min),
    target: Math.max(14_000, lengthPreset.target + outcomeOffset.target),
    max: Math.max(22_000, lengthPreset.max + outcomeOffset.max)
  };

  if (durationSec < 120) {
    return {
      minDurationMs: Math.max(14_000, preset.min - 4_000),
      targetDurationMs: Math.max(18_000, preset.target - 6_000),
      maxDurationMs: Math.max(30_000, preset.max - 6_000)
    };
  }

  return {
    minDurationMs: preset.min,
    targetDurationMs: preset.target,
    maxDurationMs: preset.max
  };
}

function sanitizeTopicList(topics: string[], fallbackTopics: string[]): string[] {
  const unique = new Set<string>();
  const cleaned: string[] = [];

  for (const topic of topics) {
    const normalized = normalizeText(topic, 1600).toLowerCase();
    const tokenized = cleanToken(normalized);
    const normalizedKey = tokenized || normalized;

    if (!normalizedKey || normalizedKey.length < 3) {
      continue;
    }

    if (STOPWORDS.has(normalizedKey)) {
      continue;
    }

    if (isGenericToken(normalized) || isGenericToken(normalizedKey)) {
      continue;
    }

    if (!unique.has(normalizedKey)) {
      unique.add(normalizedKey);
      cleaned.push(normalized);
    }

    if (cleaned.length >= 8) {
      break;
    }
  }

  if (cleaned.length > 0) {
    return cleaned;
  }

  const fallback = fallbackTopics
    .map((item) => normalizeText(item, 1600).toLowerCase())
    .filter((item) => item.length >= 3)
    .filter((item) => !isGenericToken(item))
    .slice(0, 5);

  if (fallback.length > 0) {
    return fallback;
  }

  return ["estrategia", "aquisicao", "narrativa", "oferta", "distribuicao"];
}

function sanitizeRecommendations(
  recommendations: string[],
  fallbackRecommendations: string[]
): string[] {
  const cleaned = recommendations
    .map((item) => normalizeText(item, 3000, 10))
    .filter((item) => item.length >= 12)
    .slice(0, 10);

  if (cleaned.length >= 2) {
    return cleaned;
  }

  return fallbackRecommendations.slice(0, 4);
}

function normalizeAnalysisStructure(
  raw: unknown,
  fallback: NonNullable<AnalysisPayload["structure"]>
): NonNullable<AnalysisPayload["structure"]> {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const value = raw as Record<string, unknown>;
  return {
    problem: normalizeText(
      typeof value.problem === "string" ? value.problem : fallback.problem,
      3000,
      8,
      fallback.problem
    ),
    tension: normalizeText(
      typeof value.tension === "string" ? value.tension : fallback.tension,
      3000,
      8,
      fallback.tension
    ),
    insight: normalizeText(
      typeof value.insight === "string" ? value.insight : fallback.insight,
      3000,
      8,
      fallback.insight
    ),
    application: normalizeText(
      typeof value.application === "string" ? value.application : fallback.application,
      3000,
      8,
      fallback.application
    )
  };
}

function normalizeAnalysisQualityScores(
  raw: unknown,
  fallbackPolarity: number
): NonNullable<AnalysisPayload["qualityScores"]> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const value = raw as Record<string, unknown>;
  const toScore = (field: unknown, fallback: number) => {
    const number = typeof field === "number" ? field : Number(field ?? fallback);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return roundScore(clamp(number, 0, 10));
  };

  return {
    insightDensity: toScore(value.insightDensity, 7),
    standaloneClarity: toScore(value.standaloneClarity, 7),
    polarity: toScore(value.polarity, fallbackPolarity),
    practicalValue: toScore(value.practicalValue, 7)
  };
}

function normalizeRetentionMoments(raw: unknown): NonNullable<AnalysisPayload["retentionMoments"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const value = item as Record<string, unknown>;
      const text = normalizeText(
        typeof value.text === "string" ? value.text : "",
        2400,
        8
      );
      const type = normalizeText(
        typeof value.type === "string" ? value.type : "",
        120,
        3
      ).toLowerCase();
      const whyItGrabs = normalizeText(
        typeof value.whyItGrabs === "string"
          ? value.whyItGrabs
          : typeof value.why_it_grabs === "string"
            ? value.why_it_grabs
            : "",
        2400,
        8
      );

      if (!text || !type || !whyItGrabs) {
        return null;
      }

      return { text, type, whyItGrabs };
    })
    .filter((item): item is NonNullable<AnalysisPayload["retentionMoments"]>[number] => Boolean(item))
    .slice(0, 16);
}

function normalizeEditorialAngles(raw: unknown): NonNullable<AnalysisPayload["editorialAngles"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as Record<string, unknown>;
      const angle = normalizeText(
        typeof value.angle === "string" ? value.angle : "",
        2000,
        8
      );
      const idealChannel = normalizeText(
        typeof value.idealChannel === "string"
          ? value.idealChannel
          : typeof value.ideal_channel === "string"
            ? value.ideal_channel
            : "",
        180,
        2
      );
      const format = normalizeText(
        typeof value.format === "string" ? value.format : "",
        260,
        2
      );
      const whyStronger = normalizeText(
        typeof value.whyStronger === "string"
          ? value.whyStronger
          : typeof value.why_stronger === "string"
            ? value.why_stronger
            : "",
        2400,
        8
      );
      if (!angle || !idealChannel || !format || !whyStronger) {
        return null;
      }
      return { angle, idealChannel, format, whyStronger };
    })
    .filter((item): item is NonNullable<AnalysisPayload["editorialAngles"]>[number] => Boolean(item))
    .slice(0, 16);
}

function normalizeWeakSpots(raw: unknown): NonNullable<AnalysisPayload["weakSpots"]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const value = item as Record<string, unknown>;
      const issue = normalizeText(
        typeof value.issue === "string" ? value.issue : "",
        2000,
        5
      );
      const why = normalizeText(
        typeof value.why === "string" ? value.why : "",
        2400,
        8
      );
      if (!issue || !why) {
        return null;
      }
      return { issue, why };
    })
    .filter((item): item is NonNullable<AnalysisPayload["weakSpots"]>[number] => Boolean(item))
    .slice(0, 16);
}

function normalizeContentType(
  value: unknown,
  fallback: AnalysisPayload["contentType"]
): AnalysisPayload["contentType"] {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "educational") return "educational";
  if (normalized === "provocative") return "provocative";
  if (normalized === "story") return "story";
  if (normalized === "framework") return "framework";

  if (/provoc|polar|contrar/.test(normalized)) return "provocative";
  if (/story|histori|narrat/.test(normalized)) return "story";
  if (/framework|modelo|metod|passo|process/.test(normalized)) return "framework";

  return "educational";
}

function coerceAnalysisOutput(
  output: Record<string, unknown>,
  fallback: AnalysisPayload
): AnalysisPayload {
  const thesisRaw =
    typeof output.thesis === "string"
      ? output.thesis
      : typeof output.mainThesis === "string"
        ? output.mainThesis
        : fallback.thesis;

  const topicsRaw = asStringArray(output.topics);
  const recommendationsRaw = asStringArray(output.recommendations);
  const polarityRaw =
    typeof output.polarityScore === "number"
      ? output.polarityScore
      : Number(output.polarityScore ?? fallback.polarityScore);
  const fallbackStructure =
    fallback.structure ?? {
      problem: "Problema central do conteudo nao explicitado.",
      tension: "Existe friccao entre estado atual e resultado esperado.",
      insight: fallback.thesis,
      application: fallback.recommendations[0] ?? "Transformar a tese em acao concreta."
    };

  const retentionMoments = normalizeRetentionMoments(
    output.retentionMoments ?? output.retention_moments
  );
  const editorialAngles = normalizeEditorialAngles(
    output.editorialAngles ?? output.editorial_angles
  );
  const weakSpots = normalizeWeakSpots(output.weakSpots ?? output.weak_spots);
  const qualityScores = normalizeAnalysisQualityScores(
    output.qualityScores ?? output.scores,
    fallback.polarityScore
  );

  return {
    thesis: normalizeText(thesisRaw, 1600, 20, fallback.thesis),
    topics: sanitizeTopicList(topicsRaw, fallback.topics),
    contentType: normalizeContentType(output.contentType ?? output.content_type, fallback.contentType),
    polarityScore: Math.round(clamp(Number.isFinite(polarityRaw) ? polarityRaw : fallback.polarityScore, 0, 10)),
    recommendations: sanitizeRecommendations(recommendationsRaw, fallback.recommendations),
    structure: normalizeAnalysisStructure(output.structure, fallbackStructure),
    retentionMoments: retentionMoments.length > 0 ? retentionMoments : fallback.retentionMoments,
    editorialAngles: editorialAngles.length > 0 ? editorialAngles : fallback.editorialAngles,
    weakSpots: weakSpots.length > 0 ? weakSpots : fallback.weakSpots,
    qualityScores:
      qualityScores ??
      (fallback.qualityScores
        ? {
            ...fallback.qualityScores
      }
        : undefined)
  };
}

function analysisCoercionSignal(
  output: Record<string, unknown>,
  coerced: AnalysisPayload,
  fallback: AnalysisPayload
): number {
  let signal = 0;

  if (asString(output.thesis) || asString(output.mainThesis)) {
    signal += 2;
  }

  if (asStringArray(output.topics).length >= 3) {
    signal += 1;
  }

  if (asStringArray(output.recommendations).length >= 2) {
    signal += 1;
  }

  if (asRecord(output.structure)) {
    signal += 1;
  }

  if (Array.isArray(output.retentionMoments) || Array.isArray(output.retention_moments)) {
    signal += 1;
  }

  if (coerced.thesis !== fallback.thesis) {
    signal += 1;
  }

  if (JSON.stringify(coerced.topics) !== JSON.stringify(fallback.topics)) {
    signal += 1;
  }

  if (JSON.stringify(coerced.recommendations) !== JSON.stringify(fallback.recommendations)) {
    signal += 1;
  }

  return signal;
}

function coerceLinkedinOutput(
  output: Record<string, unknown>,
  fallback: LinkedinPayload
): { payload: LinkedinPayload; confidence: number } {
  const hook = pickString(
    output.hook,
    output.headline,
    output.title,
    output.opening,
    output.firstLine,
    output.first_line,
    output.openingLine,
    output.opening_line
  );
  const ctaQuestion = pickString(
    output.ctaQuestion,
    output.cta_question,
    output.cta,
    output.question,
    output.finalQuestion,
    output.final_question
  );

  const bodyRaw =
    asStringArray(output.body).length > 0
      ? asStringArray(output.body)
      : asStringArray(output.paragraphs).length > 0
        ? asStringArray(output.paragraphs)
        : asStringArray(output.postBody).length > 0
          ? asStringArray(output.postBody)
          : asStringArray(output.post_body).length > 0
            ? asStringArray(output.post_body)
        : asString(output.body) ?? asString(output.post) ?? asString(output.text) ?? "";

  const body =
    Array.isArray(bodyRaw)
      ? bodyRaw
      : splitParagraphs(bodyRaw).length > 0
        ? splitParagraphs(bodyRaw)
        : splitListLines(bodyRaw);

  let confidence = 0;
  if (hook) confidence += 1;
  if (body.length >= 2) confidence += 1;
  if (ctaQuestion) confidence += 1;

  const payload = sanitizeLinkedinPayload({
    hook: hook ?? fallback.hook,
    body: body.length > 0 ? body : fallback.body,
    ctaQuestion:
      ctaQuestion ??
      body.find((item) => /\?\s*$/.test(item.trim())) ??
      fallback.ctaQuestion
  });

  if (payload.hook !== fallback.hook) confidence += 1;
  if (JSON.stringify(payload.body) !== JSON.stringify(fallback.body)) confidence += 1;
  if (payload.ctaQuestion !== fallback.ctaQuestion) confidence += 1;

  return { payload, confidence };
}

function normalizeNewsletterSectionType(rawType: string | null): "intro" | "insight" | "application" | "cta" | null {
  if (!rawType) {
    return null;
  }

  const value = rawType.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (/intro|abertura|opening|lead|context/.test(value)) {
    return "intro";
  }
  if (/insight|aprendizado|ponto|lesson|argument/.test(value)) {
    return "insight";
  }
  if (/application|aplic|checklist|passo|steps|framework|acao/.test(value)) {
    return "application";
  }
  if (/cta|calltoaction|call_to_action|pergunta|question|fechamento/.test(value)) {
    return "cta";
  }

  return null;
}

function normalizeInsightSection(value: Record<string, unknown>): { title: string; text: string } | null {
  const title = pickString(value.title, value.headline, value.topic, value.name);
  const text = pickString(value.text, value.body, value.insight, value.description);
  if (!title || !text) {
    return null;
  }
  return { title, text };
}

function coerceNewsletterOutput(
  output: Record<string, unknown>,
  fallback: NewsletterPayload
): { payload: NewsletterPayload; confidence: number } {
  const headline = pickString(
    output.headline,
    output.title,
    output.subject,
    output.chosenHeadline,
    output.bestHeadline,
    output.best_headline
  );
  const subheadline = pickString(
    output.subheadline,
    output.subtitle,
    output.dek,
    output.subTitle,
    output.sub_title
  );

  const sections: NewsletterPayload["sections"] = [];
  let confidence = 0;

  const rawSections = asRecordArray(output.sections);
  if (rawSections.length > 0) {
    for (const section of rawSections) {
      const type = normalizeNewsletterSectionType(pickString(section.type, section.kind, section.role));
      if (type === "intro") {
        const text = pickString(section.text, section.body);
        if (text) {
          sections.push({ type: "intro", text });
          confidence += 1;
        }
        continue;
      }

      if (type === "insight") {
        const normalized = normalizeInsightSection(section);
        if (normalized) {
          sections.push({ type: "insight", ...normalized });
          confidence += 1;
        }
        continue;
      }

      if (type === "application") {
        const bullets = asStringArray(
          section.bullets ?? section.items ?? section.steps ?? section.checklist
        );
        if (bullets.length > 0) {
          sections.push({ type: "application", bullets });
          confidence += 1;
        }
        continue;
      }

      if (type === "cta") {
        const text = pickString(
          section.text,
          section.body,
          section.question,
          section.prompt,
          section.callToAction,
          section.call_to_action
        );
        if (text) {
          sections.push({ type: "cta", text });
          confidence += 1;
        }
      }
    }
  }

  if (sections.length === 0) {
    const intro = pickString(output.intro, output.opening, output.lead);
    if (intro) {
      sections.push({ type: "intro", text: intro });
      confidence += 1;
    }

    const insightRecords = asRecordArray(
      output.insights ?? output.keyInsights ?? output.key_insights ?? output.mainInsights
    );
    if (insightRecords.length > 0) {
      for (const item of insightRecords.slice(0, 5)) {
        const normalized = normalizeInsightSection(item);
        if (normalized) {
          sections.push({ type: "insight", ...normalized });
          confidence += 1;
        }
      }
    } else {
      const insightTexts = asStringArray(output.insights ?? output.keyInsights ?? output.key_insights);
      for (const item of insightTexts.slice(0, 5)) {
        sections.push({
          type: "insight",
          title: item.split(/[.!?]/)[0] ?? "Insight",
          text: item
        });
        confidence += 1;
      }
    }

    const bullets = asStringArray(
      (asRecord(output.application) ?? {}).bullets ??
      output.checklist ??
      output.steps ??
      output.framework ??
      output.actionPlan ??
      output.action_plan
    );
    if (bullets.length > 0) {
      sections.push({ type: "application", bullets });
      confidence += 1;
    }

    const cta = pickString(output.cta, output.callToAction, output.call_to_action, output.question);
    if (cta) {
      sections.push({ type: "cta", text: cta });
      confidence += 1;
    }
  }

  if (sections.length < 3) {
    const rawBody = pickString(output.body, output.text, output.newsletter);
    if (rawBody) {
      const paragraphs = splitParagraphs(rawBody);
      if (paragraphs.length > 0) {
        sections.push({ type: "intro", text: paragraphs[0] });
        if (paragraphs[1]) {
          sections.push({ type: "insight", title: "Insight central", text: paragraphs[1] });
        }
        if (paragraphs[2]) {
          sections.push({ type: "cta", text: paragraphs[2] });
        }
        confidence += 1;
      }
    }
  }

  const payload = sanitizeNewsletterPayload({
    headline: headline ?? fallback.headline,
    subheadline: subheadline ?? fallback.subheadline,
    sections: sections.length > 0 ? sections : fallback.sections
  });

  if (payload.headline !== fallback.headline) confidence += 1;
  if (payload.subheadline !== fallback.subheadline) confidence += 1;
  if (JSON.stringify(payload.sections) !== JSON.stringify(fallback.sections)) confidence += 1;

  return { payload, confidence };
}

function coerceXOutput(
  output: Record<string, unknown>,
  fallback: XPostsPayload,
  ctaMode: GenerationCtaMode = "comment",
  length: GenerationLength = "standard"
): { payload: XPostsPayload; confidence: number } {
  const outputNotes = asRecord(output.notes);
  const postsRecord = asRecord(output.posts);
  const standalone = asStringArray(
    output.standalone ??
      output.standalonePosts ??
      output.standalone_posts ??
      postsRecord?.standalone ??
      postsRecord?.standalonePosts ??
      postsRecord?.standalone_posts ??
      output.posts ??
      output.tweets ??
      output.avulsos
  );
  const thread = asStringArray(
    output.thread ??
      output.threadPosts ??
      output.thread_posts ??
      output.threadTweets ??
      output.thread_tweets ??
      output.tweetThread ??
      output.tweet_thread ??
      postsRecord?.thread ??
      postsRecord?.threadPosts ??
      postsRecord?.thread_posts ??
      postsRecord?.threadTweets
  );
  const style = pickString(
    outputNotes?.style,
    output.style,
    output.tone,
    output.voice,
    output.writingStyle,
    output.writing_style
  );

  const standaloneFromThread = standalone.filter((item) => !/^\s*\d+\s*\/\s*\d*/.test(item));
  const inferredThread = standalone.filter((item) => /^\s*\d+\s*\/\s*\d*/.test(item));
  const finalThread = thread.length > 0 ? thread : inferredThread;
  const finalStandalone =
    standaloneFromThread.length > 0 ? standaloneFromThread : standalone;

  const payload = sanitizeXPayload({
    standalone: finalStandalone.length > 0 ? finalStandalone : fallback.standalone,
    thread: finalThread.length > 0 ? finalThread : fallback.thread,
    notes: {
      style: style ?? fallback.notes.style
    }
  }, ctaMode, length);

  let confidence = 0;
  if (standalone.length > 0) confidence += 1;
  if (thread.length > 0) confidence += 1;
  if (style) confidence += 1;
  if (JSON.stringify(payload.standalone) !== JSON.stringify(fallback.standalone)) confidence += 1;
  if (JSON.stringify(payload.thread) !== JSON.stringify(fallback.thread)) confidence += 1;

  return { payload, confidence };
}

function coerceReelsOutput(
  output: Record<string, unknown>,
  fallback: ReelsPayload,
  segments: TranscriptSegment[],
  durationPolicy: { minDurationMs: number; targetDurationMs: number; maxDurationMs: number },
  analysis: AnalysisPayload,
  profile: GenerationProfile,
  durationSec: number,
  clipCount: number
): { payload: ReelsPayload; confidence: number } {
  const arrayFromKey = (key: unknown): Record<string, unknown>[] => {
    if (Array.isArray(key)) {
      return key
        .map((item) => {
          if (typeof item === "string") {
            return { caption: item } as Record<string, unknown>;
          }
          return asRecord(item);
        })
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
    return [];
  };

  const rawCandidates =
    arrayFromKey(output.clips).length > 0
      ? arrayFromKey(output.clips)
      : arrayFromKey(output.reels).length > 0
        ? arrayFromKey(output.reels)
        : arrayFromKey(output.items).length > 0
          ? arrayFromKey(output.items)
          : arrayFromKey(output.results);

  if (rawCandidates.length === 0) {
    return { payload: fallback, confidence: 0 };
  }

  let confidence = 0;
  const reels: ReelsPayload["clips"] = [];

  rawCandidates.slice(0, clipCount).forEach((item, idx) => {
    const fallbackClip = fallback.clips[idx] ?? fallback.clips[0];
    const title = pickString(item.title, item.hook, item.headline, asStringArray(item.titles)[0]);
    const captionBase = pickString(
      item.caption,
      item.legenda,
      item.copy,
      item.body,
      asStringArray(item.captions)[0]
    );
    const cta = pickString(item.cta, item.callToAction, item.call_to_action);
    const caption = captionBase ? (cta ? `${captionBase}\n\n${cta}` : captionBase) : null;
    const whyItWorks = pickString(item.whyItWorks, item.why_it_works, item.rationale, item.reason);
    const hashtags = asStringArray(item.hashtags ?? item.tags ?? item.hashTags);

    const startIdx = Number(item.startIdx ?? item.start_idx ?? item.startSegment ?? NaN);
    const endIdx = Number(item.endIdx ?? item.end_idx ?? item.endSegment ?? NaN);
    const range = pickString(item.range, item.timeRange, item.time_range, item.timestamps);
    const startRaw = pickString(item.start, item.startTime, item.start_time);
    const endRaw = pickString(item.end, item.endTime, item.end_time);

    let start = fallbackClip?.start;
    let end = fallbackClip?.end;
    if (Number.isFinite(startIdx) && Number.isFinite(endIdx)) {
      const window = buildClipWindowFromRange(segments, startIdx, endIdx, durationPolicy);
      if (window) {
        start = msToSrtTimestamp(window.startMs);
        end = msToSrtTimestamp(window.endMs);
        confidence += 1;
      }
    } else if (startRaw && endRaw) {
      const normalizedStart = normalizeTimestampToken(startRaw);
      const normalizedEnd = normalizeTimestampToken(endRaw);
      if (normalizedStart && normalizedEnd) {
        start = normalizedStart;
        end = normalizedEnd;
        confidence += 1;
      }
    } else if (range) {
      const parsed = parseTimestampRange(range);
      if (parsed) {
        start = parsed.start;
        end = parsed.end;
        confidence += 1;
      }
    }

    const sourceMsStart = start ? timestampToMs(start) : null;
    const sourceMsEnd = end ? timestampToMs(end) : null;
    let scores = computeReelsScores(
      {
        startMs: sourceMsStart ?? 0,
        endMs: sourceMsEnd ?? 0,
        text: caption ?? fallbackClip?.caption ?? analysis.thesis
      } as ClipWindow,
      durationSec,
      analysis,
      profile.tasks.reels.strategy
    );
    const scoreObj = asRecord(item.scores);
    if (scoreObj) {
      scores = {
        hook: Number(scoreObj.hook ?? scores.hook),
        clarity: Number(scoreObj.clarity ?? scores.clarity),
        retention: Number(scoreObj.retention ?? scores.retention),
        share: Number(scoreObj.share ?? scores.share)
      };
      confidence += 1;
    }

    reels.push({
      title: normalizeText(title ?? fallbackClip?.title ?? analysis.thesis, 220, 6),
      start: start ?? fallbackClip?.start ?? "00:00:00.000",
      end: end ?? fallbackClip?.end ?? "00:00:20.000",
      caption: normalizeText(
        caption ?? fallbackClip?.caption ?? analysis.thesis,
        5000,
        40
      ),
      hashtags: sanitizeHashtags(hashtags, fallbackClip?.hashtags ?? hashtagsByStrategy(profile.tasks.reels.strategy)),
      scores: {
        hook: Math.round(clamp(scores.hook, 0, 10)),
        clarity: Math.round(clamp(scores.clarity, 0, 10)),
        retention: Math.round(clamp(scores.retention, 0, 10)),
        share: Math.round(clamp(scores.share, 0, 10))
      },
      whyItWorks: normalizeText(whyItWorks ?? fallbackClip?.whyItWorks ?? "", 2400, 8)
    });

    if (title) confidence += 1;
    if (caption) confidence += 1;
    if (whyItWorks) confidence += 1;
    if (hashtags.length > 0) confidence += 1;
  });

  if (reels.length === 0) {
    return { payload: fallback, confidence: 0 };
  }

  return {
    payload: sanitizeReelsPayload({
      clips: reels.slice(0, clipCount)
    }),
    confidence
  };
}

interface ClipWindow {
  startIdx: number;
  endIdx: number;
  startMs: number;
  endMs: number;
  avgScore: number;
  text: string;
}

const INTRO_PATTERN = /\b(nesse video|neste video|no video de hoje|hoje eu vou|hoje vou|se eu tivesse um conselho|antes de mais nada|fala galera|bom dia|boa noite|deixa eu te contar)\b/i;
const OUTRO_PATTERN = /\b(se inscreva|deixa o like|curte ai|ate o proximo|obrigado por assistir|valeu pessoal)\b/i;
const STRONG_HOOK_PATTERN = /\b(erro|ninguem te conta|evite|nao faca|regra|framework|metodo|passo|faturamento|venda|cliente|lucro|escala|crescer|trava)\b/i;
const ACTION_SIGNAL_PATTERN = /\b(aplique|aplicar|teste|testar|mapeie|mapear|ajuste|ajustar|defina|definir|valide|validar|priorize|priorizar|pare|evite|execute|executar|compare|medir|acompanhe)\b/i;
const PAIN_SIGNAL_PATTERN = /\b(erro|trava|travando|perde|perder|custo|quebra|fracassa|fracasso|nao vende|não vende|nao fecha|não fecha|desperdica|gargalo|risco)\b/i;

interface TaskRequestTrace {
  provider: AIProvider;
  model: string;
  usedHeuristicFallback: boolean;
  fallbackReason: string | null;
}

interface TaskRequestUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
}

interface TaskRequestResult {
  output: Record<string, unknown> | null;
  trace: TaskRequestTrace;
  usage: TaskRequestUsage;
}

interface TaskUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  hasPromptTokens: boolean;
  hasCompletionTokens: boolean;
  hasTotalTokens: boolean;
  hasEstimatedCost: boolean;
  hasActualCost: boolean;
}

interface QualityEvaluation {
  overall: number;
  subscores: QualitySubscores;
  summary: string;
  weaknesses: string[];
}

interface QualityRefineResult<T> {
  candidate: T;
  initialEval: QualityEvaluation;
  finalEval: QualityEvaluation;
  judgeEval: QualityEvaluation;
  qualityScore: number;
  publishabilityScore: number;
  refinementRequested: boolean;
  refinementApplied: boolean;
  candidateCount: number;
  selectedCandidate: number;
  refinePassesTarget: number;
  refinePassesAppliedCount: number;
  candidateEvaluations: Array<{
    candidateIndex: number;
    heuristicScore: number;
    judgeScore: number;
    compositeScore: number;
  }>;
  inflationGuardApplied: boolean;
  inflationGuardReason: string | null;
  displayScore: number;
}

export type GenerationDiagnosticsRecorder = (
  entry: Omit<TaskGenerationDiagnostics, "updatedAt">
) => void;

const TASK_MAX_TOKENS: Record<AITask, number> = {
  analysis: 6500,
  reels: 5200,
  newsletter: 7000,
  linkedin: 5000,
  x: 7000
};

const TASK_REQUEST_TIMEOUT_MS: Record<AITask, number> = {
  analysis: 300_000,
  reels: 240_000,
  newsletter: 240_000,
  linkedin: 220_000,
  x: 240_000
};

const JUDGE_CONTEXT_MAX_CHARS: Record<AITask, number> = {
  analysis: 10_000,
  reels: 7_500,
  newsletter: 8_500,
  linkedin: 6_500,
  x: 6_500
};

const TASK_JUDGE_TIMEOUT_MS: Record<AITask, number> = {
  analysis: 120_000,
  reels: 95_000,
  newsletter: 95_000,
  linkedin: 90_000,
  x: 90_000
};

const ABORT_FAIL_FAST_LIMIT: Record<AITask, number> = {
  analysis: 1,
  reels: 2,
  newsletter: 2,
  linkedin: 2,
  x: 2
};

const CIRCUIT_OPEN_MS = 90_000;
const RATE_LIMIT_CIRCUIT_OPEN_MS = 30_000;
const JSON_PARSE_CIRCUIT_OPEN_MS = 60_000;
const CIRCUIT_ABORT_THRESHOLD: Record<AITask, number> = {
  analysis: 1,
  reels: 2,
  newsletter: 2,
  linkedin: 2,
  x: 2
};
const CIRCUIT_JSON_PARSE_THRESHOLD: Record<AITask, number> = {
  analysis: 2,
  reels: 2,
  newsletter: 2,
  linkedin: 2,
  x: 2
};
const JSON_PARSE_FAIL_FAST_LIMIT: Record<AITask, number> = {
  analysis: 2,
  reels: 2,
  newsletter: 2,
  linkedin: 2,
  x: 2
};

interface TaskFailureCircuitState {
  abortFailures: number;
  jsonParseFailures: number;
  openUntilMs: number;
  reason: string;
}

const TASK_FAILURE_CIRCUIT = new Map<string, TaskFailureCircuitState>();

const TASK_QUALITY_THRESHOLD: Record<AITask, number> = {
  analysis: 7.2,
  reels: 7.5,
  newsletter: 7.8,
  linkedin: 7.4,
  x: 7.4
};

const TASK_PUBLISHABILITY_THRESHOLD: Record<AITask, number> = {
  analysis: 7.1,
  reels: 7.7,
  newsletter: 7.9,
  linkedin: 7.5,
  x: 7.5
};

const EMPTY_TASK_USAGE: TaskRequestUsage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  estimatedCostUsd: null,
  actualCostUsd: null
};

function createTaskUsageMetrics(): TaskUsageMetrics {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    actualCostUsd: 0,
    hasPromptTokens: false,
    hasCompletionTokens: false,
    hasTotalTokens: false,
    hasEstimatedCost: false,
    hasActualCost: false
  };
}

function accumulateTaskUsage(
  target: TaskUsageMetrics,
  usage: TaskRequestUsage | null | undefined
): void {
  if (!usage) {
    return;
  }

  if (typeof usage.promptTokens === "number" && Number.isFinite(usage.promptTokens)) {
    target.promptTokens += usage.promptTokens;
    target.hasPromptTokens = true;
  }

  if (typeof usage.completionTokens === "number" && Number.isFinite(usage.completionTokens)) {
    target.completionTokens += usage.completionTokens;
    target.hasCompletionTokens = true;
  }

  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    target.totalTokens += usage.totalTokens;
    target.hasTotalTokens = true;
  }

  if (typeof usage.estimatedCostUsd === "number" && Number.isFinite(usage.estimatedCostUsd)) {
    target.estimatedCostUsd += usage.estimatedCostUsd;
    target.hasEstimatedCost = true;
  }

  if (typeof usage.actualCostUsd === "number" && Number.isFinite(usage.actualCostUsd)) {
    target.actualCostUsd += usage.actualCostUsd;
    target.hasActualCost = true;
  }
}

function usageToDiagnosticsFields(usage: TaskUsageMetrics): {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
} {
  return {
    promptTokens: usage.hasPromptTokens ? Math.round(usage.promptTokens) : null,
    completionTokens: usage.hasCompletionTokens ? Math.round(usage.completionTokens) : null,
    totalTokens: usage.hasTotalTokens
      ? Math.round(usage.totalTokens)
      : usage.hasPromptTokens || usage.hasCompletionTokens
        ? Math.round(usage.promptTokens + usage.completionTokens)
        : null,
    estimatedCostUsd: usage.hasEstimatedCost
      ? Number(usage.estimatedCostUsd.toFixed(6))
      : null,
    actualCostUsd: usage.hasActualCost ? Number(usage.actualCostUsd.toFixed(6)) : null
  };
}

function buildClipWindowFromSeed(
  segments: TranscriptSegment[],
  seedIndex: number,
  minDurationMs: number,
  targetDurationMs: number,
  maxDurationMs: number
): ClipWindow {
  let left = seedIndex;
  let right = seedIndex;

  const currentDuration = (): number => segments[right].endMs - segments[left].startMs;

  while (currentDuration() < minDurationMs && (left > 0 || right < segments.length - 1)) {
    if (right < segments.length - 1) {
      right += 1;
    }
    if (currentDuration() >= minDurationMs) {
      break;
    }
    if (left > 0) {
      left -= 1;
    }
  }

  while (currentDuration() < targetDurationMs && (left > 0 || right < segments.length - 1)) {
    const canExpandRight = right < segments.length - 1;
    const canExpandLeft = left > 0;

    const rightDuration = canExpandRight
      ? segments[right + 1].endMs - segments[left].startMs
      : Number.POSITIVE_INFINITY;
    const leftDuration = canExpandLeft
      ? segments[right].endMs - segments[left - 1].startMs
      : Number.POSITIVE_INFINITY;

    const canTakeRight = canExpandRight && rightDuration <= maxDurationMs;
    const canTakeLeft = canExpandLeft && leftDuration <= maxDurationMs;

    if (!canTakeRight && !canTakeLeft) {
      break;
    }

    if (canTakeRight && (!canTakeLeft || rightDuration <= leftDuration)) {
      right += 1;
      continue;
    }

    if (canTakeLeft) {
      left -= 1;
    }
  }

  const windowSegments = segments.slice(left, right + 1);
  const avgScore =
    windowSegments.reduce((sum, segment) => sum + segmentScore(segment), 0) /
    Math.max(1, windowSegments.length);

  return {
    startIdx: left,
    endIdx: right,
    startMs: segments[left].startMs,
    endMs: segments[right].endMs,
    avgScore,
    text: windowSegments.map((segment) => segment.text).join(" ")
  };
}

function hasWindowOverlap(a: ClipWindow, b: ClipWindow, bufferMs = 2_500): boolean {
  return !(a.endMs + bufferMs < b.startMs || b.endMs + bufferMs < a.startMs);
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

function firstWords(text: string, count: number): string {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, count)
    .join(" ");
}

function openingHookStrength(text: string): number {
  const opening = firstWords(text, 16);
  if (!opening) {
    return 0;
  }

  let score = 0;
  if (STRONG_HOOK_PATTERN.test(opening)) {
    score += 2.4;
  }
  if (/\?|\!/.test(opening)) {
    score += 1.2;
  }
  if (/\d/.test(opening)) {
    score += 1;
  }
  if (/\b(erro|cuidado|pare|nunca|evite|segredo|ninguem te conta)\b/i.test(opening)) {
    score += 1.3;
  }
  if (wordCount(opening) < 6) {
    score -= 0.8;
  }
  return score;
}

function seedContextScore(
  segment: TranscriptSegment,
  index: number,
  segments: TranscriptSegment[],
  durationSec: number
): number {
  const total = Math.max(1, segments.length - 1);
  const progress = index / total;
  const startSec = segment.startMs / 1000;
  const remainingSec = durationSec - startSec;
  const text = segment.text;
  let score = 0;

  if (durationSec >= 120 && startSec < 20) score -= 3.4;
  else if (durationSec >= 120 && startSec < 40) score -= 1.8;
  else if (durationSec >= 75 && startSec < 10) score -= 1.5;

  if (remainingSec < 15 && durationSec > 40) score -= 1.7;
  if (progress > 0.9) score -= 0.8;

  if (INTRO_PATTERN.test(text)) score -= 3;
  if (OUTRO_PATTERN.test(text)) score -= 2.4;
  if (STRONG_HOOK_PATTERN.test(text)) score += 1.1;
  if (/\d/.test(text)) score += 0.5;
  score += openingHookStrength(text) * 0.55;

  const words = wordCount(text);
  if (words >= 14 && words <= 60) score += 0.8;
  if (words < 8) score -= 0.8;

  return score;
}

function windowEditorialScore(window: ClipWindow, durationSec: number): number {
  const duration = (window.endMs - window.startMs) / 1000;
  const startSec = window.startMs / 1000;
  const remainingSec = durationSec - startSec;
  const words = wordCount(window.text);
  const hookStrength = openingHookStrength(window.text);
  let score = window.avgScore;

  if (duration >= 18 && duration <= 42) score += 1.2;
  else if (duration < 14) score -= 1.2;
  else if (duration > 50) score -= 0.7;

  if (words >= 26 && words <= 120) score += 1;
  else if (words < 20) score -= 1;

  if (INTRO_PATTERN.test(window.text)) score -= 3.1;
  if (OUTRO_PATTERN.test(window.text)) score -= 2.2;
  if (STRONG_HOOK_PATTERN.test(window.text)) score += 1.2;
  score += hookStrength;

  if (durationSec >= 120 && startSec < 20) score -= 2.2;
  if (remainingSec < 15 && durationSec > 50) score -= 1.8;

  return score;
}

function makeClipWindowFromBounds(
  segments: TranscriptSegment[],
  startIdx: number,
  endIdx: number
): ClipWindow {
  const windowSegments = segments.slice(startIdx, endIdx + 1);
  const avgScore =
    windowSegments.reduce((sum, segment) => sum + segmentScore(segment), 0) /
    Math.max(1, windowSegments.length);

  return {
    startIdx,
    endIdx,
    startMs: segments[startIdx].startMs,
    endMs: segments[endIdx].endMs,
    avgScore,
    text: windowSegments.map((segment) => segment.text).join(" ")
  };
}

function isWeakIntroWindow(window: ClipWindow, durationSec: number): boolean {
  if (durationSec < 80) {
    return false;
  }

  const startSec = window.startMs / 1000;
  if (startSec > 20) {
    return false;
  }

  const hasIntroMarker = INTRO_PATTERN.test(window.text);
  const hasStrongHook = openingHookStrength(window.text) >= 2.4;
  return hasIntroMarker && !hasStrongHook;
}

function isWeakOutroWindow(window: ClipWindow, durationSec: number): boolean {
  if (durationSec < 70) {
    return false;
  }

  const remainingSec = durationSec - window.startMs / 1000;
  if (remainingSec > 18) {
    return false;
  }

  const hasOutroMarker = OUTRO_PATTERN.test(window.text);
  const hasStrongHook = openingHookStrength(window.text) >= 2.6;
  return hasOutroMarker && !hasStrongHook;
}

function hasStrongOpeningHook(window: ClipWindow): boolean {
  return openingHookStrength(window.text) >= 2.5;
}

function isEarlyWindowWithoutEliteHook(window: ClipWindow, durationSec: number): boolean {
  if (durationSec < 150) {
    return false;
  }

  const startSec = window.startMs / 1000;
  if (startSec > 30) {
    return false;
  }

  return openingHookStrength(window.text) < 3.1;
}

function buildClipWindowFromRange(
  segments: TranscriptSegment[],
  startSegmentIdx: number,
  endSegmentIdx: number,
  policy: { minDurationMs: number; targetDurationMs: number; maxDurationMs: number }
): ClipWindow | null {
  const idxToPosition = new Map<number, number>();
  segments.forEach((segment, position) => {
    idxToPosition.set(segment.idx, position);
  });

  const startPos = idxToPosition.get(startSegmentIdx);
  const endPos = idxToPosition.get(endSegmentIdx);

  if (startPos === undefined || endPos === undefined) {
    return null;
  }

  const left = Math.min(startPos, endPos);
  const right = Math.max(startPos, endPos);
  const initial = makeClipWindowFromBounds(segments, left, right);
  const initialDurationMs = initial.endMs - initial.startMs;

  if (initialDurationMs >= policy.minDurationMs && initialDurationMs <= policy.maxDurationMs) {
    return initial;
  }

  const seedIndex = Math.floor((left + right) / 2);
  return buildClipWindowFromSeed(
    segments,
    seedIndex,
    policy.minDurationMs,
    policy.targetDurationMs,
    policy.maxDurationMs
  );
}

function selectClipWindows(
  segments: TranscriptSegment[],
  clipCount: number,
  durationSec: number,
  length: GenerationLength = "standard",
  targetOutcome: GenerationTargetOutcome = "followers"
): ClipWindow[] {
  if (segments.length === 0 || clipCount <= 0) {
    return [];
  }

  const policy = resolveReelsDurationPolicy(durationSec, length, targetOutcome);
  const rankedSeeds = segments
    .map((segment, index) => ({
      index,
      score: segmentScore(segment) + seedContextScore(segment, index, segments, durationSec)
    }))
    .sort((a, b) => b.score - a.score);

  const candidateMap = new Map<string, ClipWindow & { editorialScore: number }>();
  for (const seed of rankedSeeds.slice(0, 90)) {
    const window = buildClipWindowFromSeed(
      segments,
      seed.index,
      policy.minDurationMs,
      policy.targetDurationMs,
      policy.maxDurationMs
    );

    if (
      isWeakIntroWindow(window, durationSec) ||
      isWeakOutroWindow(window, durationSec) ||
      isEarlyWindowWithoutEliteHook(window, durationSec)
    ) {
      continue;
    }
    if (!hasStrongOpeningHook(window)) {
      continue;
    }

    const editorialScore = windowEditorialScore(window, durationSec) + seed.score * 0.35;
    const key = `${window.startIdx}:${window.endIdx}`;
    const existing = candidateMap.get(key);
    if (!existing || editorialScore > existing.editorialScore) {
      candidateMap.set(key, { ...window, editorialScore });
    }
  }

  const sortedCandidates = [...candidateMap.values()].sort(
    (a, b) => b.editorialScore - a.editorialScore
  );

  const selected: ClipWindow[] = [];
  for (const candidate of sortedCandidates) {
    if (selected.some((existing) => hasWindowOverlap(existing, candidate))) {
      continue;
    }

    selected.push(candidate);
    if (selected.length >= clipCount) {
      break;
    }
  }

  if (selected.length < clipCount) {
    for (const candidate of sortedCandidates) {
      if (selected.length >= clipCount) {
        break;
      }

      const alreadyIncluded = selected.some(
        (existing) =>
          existing.startIdx === candidate.startIdx && existing.endIdx === candidate.endIdx
      );
      if (!alreadyIncluded) {
        selected.push(candidate);
      }
    }
  }

  if (selected.length < clipCount) {
    for (const seed of rankedSeeds) {
      if (selected.length >= clipCount) {
        break;
      }

      const fallbackWindow = buildClipWindowFromSeed(
        segments,
        seed.index,
        policy.minDurationMs,
        policy.targetDurationMs,
        policy.maxDurationMs
      );
      if (
        isWeakIntroWindow(fallbackWindow, durationSec) ||
        isWeakOutroWindow(fallbackWindow, durationSec) ||
        isEarlyWindowWithoutEliteHook(fallbackWindow, durationSec) ||
        openingHookStrength(fallbackWindow.text) < 2.1
      ) {
        continue;
      }

      const alreadyIncluded = selected.some(
        (existing) =>
          existing.startIdx === fallbackWindow.startIdx &&
          existing.endIdx === fallbackWindow.endIdx
      );
      if (!alreadyIncluded) {
        selected.push(fallbackWindow);
      }
    }
  }

  if (selected.length < clipCount) {
    for (const seed of rankedSeeds) {
      if (selected.length >= clipCount) {
        break;
      }

      const segment = segments[seed.index];
      const singleWindow: ClipWindow = {
        startIdx: seed.index,
        endIdx: seed.index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        avgScore: segmentScore(segment),
        text: segment.text
      };

      const alreadyIncluded = selected.some(
        (existing) =>
          existing.startIdx === singleWindow.startIdx &&
          existing.endIdx === singleWindow.endIdx
      );
      if (
        !alreadyIncluded &&
        !isWeakIntroWindow(singleWindow, durationSec) &&
        !isWeakOutroWindow(singleWindow, durationSec) &&
        !isEarlyWindowWithoutEliteHook(singleWindow, durationSec) &&
        openingHookStrength(singleWindow.text) >= 1.8
      ) {
        selected.push(singleWindow);
      }
    }
  }

  if (selected.length === 0) {
    let emergency: ClipWindow | null = null;
    for (const seed of rankedSeeds) {
      const candidate = buildClipWindowFromSeed(
        segments,
        seed.index,
        policy.minDurationMs,
        policy.targetDurationMs,
        policy.maxDurationMs
      );
      if (
        !isWeakIntroWindow(candidate, durationSec) &&
        !isWeakOutroWindow(candidate, durationSec) &&
        !isEarlyWindowWithoutEliteHook(candidate, durationSec) &&
        openingHookStrength(candidate.text) >= 1.6
      ) {
        emergency = candidate;
        break;
      }
      if (!emergency) {
        emergency = candidate;
      }
    }
    if (emergency) {
      selected.push(emergency);
    }
  }

  return selected.slice(0, clipCount).sort((a, b) => a.startMs - b.startMs);
}

async function selectClipWindowsByAi(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  profile: GenerationProfile,
  clipCount: number,
  durationSec: number,
  usageRecorder?: (usage: TaskRequestUsage) => void
): Promise<ClipWindow[]> {
  const route = getRouteForTask("reels");
  if (route.provider === "heuristic" || !isProviderConfigured(route.provider)) {
    return selectClipWindows(
      segments,
      clipCount,
      durationSec,
      profile.tasks.reels.length,
      profile.tasks.reels.targetOutcome
    );
  }

  const policy = resolveReelsDurationPolicy(
    durationSec,
    profile.tasks.reels.length,
    profile.tasks.reels.targetOutcome
  );
  const systemPrompt = [
    "Voce e Head de Conteudo para Reels com foco em crescimento de audiencia e retencao real.",
    "Sua tarefa e escolher os melhores recortes da transcricao com base em potencial editorial, nao em ordem cronologica.",
    "Voce deve evitar abertura protocolar e encerramento fraco, exceto se houver gancho forte verificavel no texto.",
    "Selecione janelas com tese clara, friccao, aplicabilidade e potencial de compartilhamento.",
    "Nunca invente indice fora da transcricao.",
    "Nunca use travessao em nenhum texto.",
    "Retorne SOMENTE JSON valido no formato:",
    '{ "clips": [ { "startIdx": 1, "endIdx": 3, "angle": "provocative", "rationale": "motivo curto" } ] }'
  ].join("\n");

  const userPrompt = [
    "ANALISE (JSON):",
    JSON.stringify(analysis),
    "TRANSCRICAO COM INDICES:",
    transcriptExcerpt(segments, 140),
    "CONFIG:",
    `- publico: ${profile.audience}`,
    `- objetivo: ${profile.goal}`,
    `- tom: ${profile.tone}`,
    `- estrategia reels: ${profile.tasks.reels.strategy}`,
    `- foco reels: ${profile.tasks.reels.focus}`,
    `- outcome reels: ${profile.tasks.reels.targetOutcome}`,
    `- nivel audiencia reels: ${profile.tasks.reels.audienceLevel}`,
    `- intensidade: ${profile.tasks.reels.length}`,
    `- voz marca: ${profile.voice.identity}`,
    `- regras voz: ${profile.voice.writingRules}`,
    `- aprendizados vencedores: ${profile.performanceMemory.reels.wins || "sem historico"}`,
    `- evitar padroes: ${profile.performanceMemory.reels.avoid || "sem historico"}`,
    `- clips desejados: ${clipCount}`,
    `- duracao minima (s): ${(policy.minDurationMs / 1000).toFixed(0)}`,
    `- duracao alvo (s): ${(policy.targetDurationMs / 1000).toFixed(0)}`,
    `- duracao maxima (s): ${(policy.maxDurationMs / 1000).toFixed(0)}`,
    "REGRAS DE SELECAO:",
    "1) Escolha cortes que maximizem retencao e compartilhamento para ganhar seguidores.",
    "2) Prefira cortes com problema claro, contraste e aplicacao pratica.",
    "3) Evite cortes com inicio protocolar no comeco do video sem gancho forte.",
    "4) Distribua os cortes ao longo do video quando possivel.",
    "Saida final: SOMENTE JSON."
  ].join("\n");

  const scout = await requestTaskJson("reels", systemPrompt, userPrompt, {
    maxTokens: 1400,
    usageRecorder
  });
  if (!scout.output) {
    return selectClipWindows(
      segments,
      clipCount,
      durationSec,
      profile.tasks.reels.length,
      profile.tasks.reels.targetOutcome
    );
  }

  const parsed = REELS_SCOUT_SCHEMA.safeParse(scout.output);
  if (!parsed.success) {
    return selectClipWindows(
      segments,
      clipCount,
      durationSec,
      profile.tasks.reels.length,
      profile.tasks.reels.targetOutcome
    );
  }

  const candidates: Array<ClipWindow & { editorialScore: number }> = [];
  const dedupe = new Set<string>();

  for (const clip of parsed.data.clips) {
    const window = buildClipWindowFromRange(segments, clip.startIdx, clip.endIdx, policy);
    if (
      !window ||
      isWeakIntroWindow(window, durationSec) ||
      isWeakOutroWindow(window, durationSec) ||
      isEarlyWindowWithoutEliteHook(window, durationSec) ||
      !hasStrongOpeningHook(window)
    ) {
      continue;
    }

    const key = `${window.startIdx}:${window.endIdx}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    candidates.push({
      ...window,
      editorialScore: windowEditorialScore(window, durationSec)
    });
  }

  candidates.sort((a, b) => b.editorialScore - a.editorialScore);

  const selected: ClipWindow[] = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => hasWindowOverlap(existing, candidate))) {
      continue;
    }

    selected.push(candidate);
    if (selected.length >= clipCount) {
      break;
    }
  }

  if (selected.length < clipCount) {
    const heuristicFill = selectClipWindows(
      segments,
      clipCount,
      durationSec,
      profile.tasks.reels.length,
      profile.tasks.reels.targetOutcome
    );
    for (const fallbackWindow of heuristicFill) {
      if (selected.length >= clipCount) {
        break;
      }

      const alreadyIncluded = selected.some(
        (existing) =>
          existing.startIdx === fallbackWindow.startIdx &&
          existing.endIdx === fallbackWindow.endIdx
      );
      if (!alreadyIncluded) {
        selected.push(fallbackWindow);
      }
    }
  }

  return selected.slice(0, clipCount).sort((a, b) => a.startMs - b.startMs);
}

async function requestTaskJson(
  task: "analysis" | "reels" | "newsletter" | "linkedin" | "x",
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
    timeoutMs?: number;
    routeKind?: "generation" | "judge";
    usageRecorder?: (usage: TaskRequestUsage) => void;
  }
): Promise<TaskRequestResult> {
  const routeKind = options?.routeKind ?? "generation";
  const route = getRouteForTask(task, routeKind);
  if (route.provider === "heuristic") {
    return {
      output: null,
      trace: {
        provider: route.provider,
        model: route.model,
        usedHeuristicFallback: true,
        fallbackReason: "provider configured as heuristic"
      },
      usage: EMPTY_TASK_USAGE
    };
  }

  if (!isProviderConfigured(route.provider)) {
    console.warn(
      `[ai] provider '${route.provider}' is not configured for task '${task}', using heuristic fallback`
    );
    return {
      output: null,
      trace: {
        provider: route.provider,
        model: route.model,
        usedHeuristicFallback: true,
        fallbackReason: `provider '${route.provider}' key not configured`
      },
      usage: EMPTY_TASK_USAGE
    };
  }

  const cKey = circuitKey(task, routeKind, route.provider, route.model);
  const circuitState = TASK_FAILURE_CIRCUIT.get(cKey);
  const now = Date.now();
  if (circuitState && circuitState.openUntilMs > now) {
    return {
      output: null,
      trace: {
        provider: route.provider,
        model: route.model,
        usedHeuristicFallback: true,
        fallbackReason: `circuit_open_until_${new Date(circuitState.openUntilMs).toISOString()}`
      },
      usage: EMPTY_TASK_USAGE
    };
  }
  if (circuitState && circuitState.openUntilMs > 0 && circuitState.openUntilMs <= now) {
    TASK_FAILURE_CIRCUIT.delete(cKey);
  }

  try {
    const completion = await generateJsonCompletion({
      provider: route.provider,
      model: route.model,
      temperature: route.temperature,
      systemPrompt,
      userPrompt,
      maxTokens: options?.maxTokens ?? TASK_MAX_TOKENS[task],
      timeoutMs: options?.timeoutMs ?? TASK_REQUEST_TIMEOUT_MS[task]
    });

    const usage: TaskRequestUsage = {
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      estimatedCostUsd: completion.usage.estimatedCostUsd,
      actualCostUsd: completion.usage.actualCostUsd
    };
    options?.usageRecorder?.(usage);

    if (TASK_FAILURE_CIRCUIT.has(cKey)) {
      TASK_FAILURE_CIRCUIT.delete(cKey);
    }

    return {
      output: completion.output,
      trace: {
        provider: route.provider,
        model: route.model,
        usedHeuristicFallback: false,
        fallbackReason: null
      },
      usage
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown AI error";
    console.warn(`[ai] task '${task}' failed on ${route.provider}/${route.model}: ${reason}`);
    if (isAbortLikeReason(reason)) {
      const current = TASK_FAILURE_CIRCUIT.get(cKey);
      const nextAbortCount = (current?.abortFailures ?? 0) + 1;
      if (nextAbortCount >= CIRCUIT_ABORT_THRESHOLD[task]) {
        TASK_FAILURE_CIRCUIT.set(cKey, {
          abortFailures: nextAbortCount,
          jsonParseFailures: 0,
          openUntilMs: Date.now() + CIRCUIT_OPEN_MS,
          reason
        });
      } else {
        TASK_FAILURE_CIRCUIT.set(cKey, {
          abortFailures: nextAbortCount,
          jsonParseFailures: 0,
          openUntilMs: 0,
          reason
        });
      }
    } else if (isJsonParseLikeReason(reason)) {
      const current = TASK_FAILURE_CIRCUIT.get(cKey);
      const nextParseCount = (current?.jsonParseFailures ?? 0) + 1;
      if (nextParseCount >= CIRCUIT_JSON_PARSE_THRESHOLD[task]) {
        TASK_FAILURE_CIRCUIT.set(cKey, {
          abortFailures: 0,
          jsonParseFailures: nextParseCount,
          openUntilMs: Date.now() + JSON_PARSE_CIRCUIT_OPEN_MS,
          reason
        });
      } else {
        TASK_FAILURE_CIRCUIT.set(cKey, {
          abortFailures: 0,
          jsonParseFailures: nextParseCount,
          openUntilMs: 0,
          reason
        });
      }
    } else if (isRateLimitLikeReason(reason)) {
      TASK_FAILURE_CIRCUIT.set(cKey, {
        abortFailures: 0,
        jsonParseFailures: 0,
        openUntilMs: Date.now() + RATE_LIMIT_CIRCUIT_OPEN_MS,
        reason
      });
    } else if (TASK_FAILURE_CIRCUIT.has(cKey)) {
      TASK_FAILURE_CIRCUIT.delete(cKey);
    }
    return {
      output: null,
      trace: {
        provider: route.provider,
        model: route.model,
        usedHeuristicFallback: true,
        fallbackReason: reason
      },
      usage: EMPTY_TASK_USAGE
    };
  }
}

function isAbortLikeReason(reason: string | null): boolean {
  if (!reason) {
    return false;
  }

  const normalized = reason.toLowerCase();
  return (
    normalized.includes("aborted") ||
    normalized.includes("aborterror") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("terminated") ||
    normalized.includes("cancelled") ||
    normalized.includes("canceled")
  );
}

function isRateLimitLikeReason(reason: string | null): boolean {
  if (!reason) {
    return false;
  }

  const normalized = reason.toLowerCase();
  return (
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota")
  );
}

function isJsonParseLikeReason(reason: string | null): boolean {
  if (!reason) {
    return false;
  }

  const normalized = reason.toLowerCase();
  return (
    normalized.includes("json") &&
    (normalized.includes("unexpected end") ||
      normalized.includes("unterminated string") ||
      normalized.includes("invalid json") ||
      normalized.includes("expected ','") ||
      normalized.includes("expected '}'"))
  );
}

function isCircuitOpenReason(reason: string | null): boolean {
  return typeof reason === "string" && reason.startsWith("circuit_open_until_");
}

function circuitKey(
  task: AITask,
  routeKind: "generation" | "judge",
  provider: AIProvider,
  model: string
): string {
  return `${task}:${routeKind}:${provider}:${model}`;
}

async function requestTaskVariants(
  task: AITask,
  systemPrompt: string,
  userPrompt: string,
  variationCount: number,
  usageRecorder?: (usage: TaskRequestUsage) => void
): Promise<TaskRequestResult[]> {
  const total = Math.max(1, Math.min(8, variationCount));
  const responses: TaskRequestResult[] = [];
  let abortLikeFailures = 0;
  let jsonParseFailures = 0;

  for (let index = 0; index < total; index += 1) {
    const variantPrompt = `${userPrompt}\n\n${variationDirective(task, index, total)}`;
    const response = await requestTaskJson(task, systemPrompt, variantPrompt, {
      usageRecorder
    });
    responses.push(response);

    if (!response.output && isCircuitOpenReason(response.trace.fallbackReason)) {
      break;
    }

    if (!response.output && isAbortLikeReason(response.trace.fallbackReason)) {
      abortLikeFailures += 1;
      if (abortLikeFailures >= ABORT_FAIL_FAST_LIMIT[task]) {
        break;
      }
      continue;
    }

    if (!response.output && isJsonParseLikeReason(response.trace.fallbackReason)) {
      jsonParseFailures += 1;
      if (jsonParseFailures >= JSON_PARSE_FAIL_FAST_LIMIT[task]) {
        break;
      }
      continue;
    }

    if (response.output) {
      abortLikeFailures = 0;
      jsonParseFailures = 0;
    }
  }

  return responses;
}

function summarizeVariantTrace(results: TaskRequestResult[]): TaskRequestTrace {
  if (results.length === 0) {
    return {
      provider: "heuristic",
      model: "heuristic-v1",
      usedHeuristicFallback: true,
      fallbackReason: "no_variant_result"
    };
  }

  const preferred =
    results.find((item) => !item.trace.usedHeuristicFallback)?.trace ?? results[0].trace;
  const fallbackReasons = [...new Set(
    results.map((item) => item.trace.fallbackReason).filter((item): item is string => Boolean(item))
  )];

  return {
    provider: preferred.provider,
    model: preferred.model,
    usedHeuristicFallback: results.every((item) => item.trace.usedHeuristicFallback),
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(" | ") : null
  };
}

function buildInitialVariantDiagnostics(
  requests: TaskRequestResult[]
): TaskVariantDiagnostics[] {
  return requests.map((request, index) => ({
    variant: index + 1,
    status: request.output ? "ok" : "request_failed",
    reason: request.output ? null : request.trace.fallbackReason,
    heuristicScore: null,
    judgeScore: null,
    selected: false,
    normalization: null,
    modelOutput: compactVariantRecord(request.output),
    normalizedOutput: null,
    estimatedCostUsd: request.usage.estimatedCostUsd,
    actualCostUsd: request.usage.actualCostUsd,
    promptTokens: request.usage.promptTokens,
    completionTokens: request.usage.completionTokens,
    totalTokens: request.usage.totalTokens
  }));
}

function compactVariantValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (depth >= 12) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactVariantValue(item, depth + 1));
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const next: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      next[key] = compactVariantValue(item, depth + 1);
    }
    return next;
  }

  return String(value);
}

function compactVariantRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const compacted = compactVariantValue(value);
  if (!compacted || typeof compacted !== "object" || Array.isArray(compacted)) {
    return null;
  }

  return compacted as Record<string, unknown>;
}

export function buildNarrativeAnalysis(
  segments: TranscriptSegment[],
  generationProfile?: GenerationProfile
): AnalysisPayload {
  const profile = generationProfile ?? defaultGenerationProfile();
  const fullText = segments.map((segment) => segment.text).join(" ");
  const topics = pickTopTopics(segments, 6);
  const taskProfile = profile.tasks.analysis;

  const contentType: AnalysisPayload["contentType"] = /historia|quando|aconteceu|experiencia/i.test(
    fullText
  )
    ? "story"
    : /framework|modelo|passo|processo|metodo/i.test(fullText)
      ? "framework"
      : /discorda|polemica|controvers/i.test(fullText)
        ? "provocative"
        : "educational";

  const thesisSource = segments[0]?.text ?? "";
  const thesis = normalizeText(
    thesisSource || "Conteudo orientado a distribuicao multicanal",
    1600,
    20,
    "Conteudo orientado a distribuicao multicanal"
  );

  const excitement = (fullText.match(/[!?]/g) ?? []).length;
  const polarityScore = Math.max(
    0,
    Math.min(10, Math.round(4 + excitement / 3 + (contentType === "provocative" ? 2 : 1)))
  );
  const highlights = takeBestSegments(segments, 6);
  const structure = {
    problem: normalizeText(
      highlights[0]?.text ??
        "Conteudo sem problema explicito. Necessario declarar dor central com clareza.",
      3000,
      8
    ),
    tension: normalizeText(
      highlights[1]?.text ??
        "Tensao narrativa pouco explicita entre estado atual e resultado desejado.",
      3000,
      8
    ),
    insight: normalizeText(
      highlights[2]?.text ?? thesis,
      3000,
      8,
      thesis
    ),
    application: normalizeText(
      highlights[3]?.text ??
        "Converter o insight em passo pratico executavel para o publico-alvo.",
      3000,
      8
    )
  };
  const retentionMoments = highlights.slice(0, 5).map((segment, idx) => ({
    text: normalizeText(segment.text, 2400, 8, thesis),
    type:
      idx === 0
        ? "hook"
        : /erro|nao faca|evite|alerta/i.test(segment.text)
          ? "alerta"
          : /passo|metodo|framework|regra/i.test(segment.text)
            ? "framework"
            : "insight",
    whyItGrabs: normalizeText(
      /erro|evite|alerta/i.test(segment.text)
        ? "Abre loop de risco e gera urgencia para continuar assistindo."
        : /passo|metodo|framework|regra/i.test(segment.text)
          ? "Entrega estrutura acionavel que aumenta salvamentos e compartilhamentos."
          : "Trecho com contraste e clareza suficiente para prender atencao sem contexto.",
      2400,
      8
    )
  }));
  const editorialAngles = [
    {
      angle: normalizeText(`Diagnostico pratico sobre ${topics[0] ?? "execucao de conteudo"}`, 180, 8),
      idealChannel: "linkedin",
      format: "post com framework",
      whyStronger: "Canal favorece argumentacao e comentarios qualificados."
    },
    {
      angle: normalizeText(`Erro recorrente em ${topics[1] ?? topics[0] ?? "distribuicao"}`, 180, 8),
      idealChannel: "reels",
      format: "corte com alerta",
      whyStronger: "Gancho forte com aplicacao imediata tende a elevar retencao."
    },
    {
      angle: normalizeText(`Checklist de aplicacao para ${profile.audience}`, 180, 8),
      idealChannel: "newsletter",
      format: "guia estruturado",
      whyStronger: "Formato permite aprofundamento com passos claros."
    }
  ];
  const weakSpots = [
    {
      issue: "Termos genericos em partes da transcricao",
      why: "Generalidades reduzem memorabilidade e dificultam transformacao em cortes fortes."
    },
    {
      issue: "Possivel dependencia de contexto externo",
      why: "Algumas frases isoladas podem perder clareza quando publicadas sem explicacao adicional."
    }
  ];

  return {
    thesis,
    topics,
    contentType,
    polarityScore,
    recommendations: [
      `Refine a tese para o publico-alvo: ${profile.audience}.`,
      `Aplique o objetivo central no texto: ${profile.goal}.`,
      `Use estrategia ${taskProfile.strategy} com tom ${profile.tone.toLowerCase()}.`,
      "Estruture a narrativa em problema, tensao, insight e aplicacao para elevar clareza."
    ],
    structure,
    retentionMoments,
    editorialAngles,
    weakSpots,
    qualityScores: {
      insightDensity: roundScore(6.8),
      standaloneClarity: roundScore(7.2),
      polarity: roundScore(polarityScore),
      practicalValue: roundScore(7.1)
    }
  };
}

function computeReelsScores(
  window: ClipWindow,
  durationSec: number,
  analysis: AnalysisPayload,
  strategy: GenerationStrategy
): { hook: number; clarity: number; retention: number; share: number } {
  const clipDurationSec = Math.round((window.endMs - window.startMs) / 1000);
  const strategyHookBonus = strategy === "provocative" || strategy === "contrarian" ? 1 : 0;
  const editorialScore = windowEditorialScore(window, durationSec);
  const hook = Math.round(clamp(editorialScore + 2.8 + strategyHookBonus, 5, 9));
  const clarity = Math.round(clamp(8.8 - Math.abs(clipDurationSec - 30) / 8, 5, 9));
  const retention = Math.round(clamp((hook + clarity + clamp(editorialScore, 0, 10)) / 3, 5, 9));
  const share = Math.round(clamp((retention + analysis.polarityScore) / 2, 5, 9));
  return { hook, clarity, retention, share };
}

export function buildReels(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  durationSec: number,
  generationProfile?: GenerationProfile,
  selectedWindowsInput?: ClipWindow[]
): ReelsPayload {
  const profile = generationProfile ?? defaultGenerationProfile();
  const taskProfile = profile.tasks.reels;
  const clipCount = resolveReelsClipCount(durationSec, taskProfile.length);
  const selectedWindows =
    selectedWindowsInput && selectedWindowsInput.length > 0
      ? selectedWindowsInput.slice(0, clipCount)
      : selectClipWindows(
          segments,
          clipCount,
          durationSec,
          taskProfile.length,
          taskProfile.targetOutcome
        );
  const strategyTags = hashtagsByStrategy(taskProfile.strategy);
  const ctaVariants = ctaVariantsByMode(
    taskProfile.ctaMode,
    profile.goal,
    taskProfile.targetOutcome
  );

  return {
    clips: selectedWindows.map((window, index) => {
      const scores = computeReelsScores(window, durationSec, analysis, taskProfile.strategy);
      const excerpt = normalizeText(window.text, 2200, 24, analysis.thesis);
      const topicTags = analysis.topics
        .slice(0, 4)
        .map((topic) => `#${cleanToken(topic)}`)
        .filter((tag) => tag.length >= 4);
      const clipCta = ctaVariants[index % Math.max(1, ctaVariants.length)] ?? "";
      const titleCore = sourceAnchoredTitle(window.text, analysis.thesis);

      return {
        title: normalizeText(titleCore, 220, 12, analysis.thesis),
        start: msToSrtTimestamp(window.startMs),
        end: msToSrtTimestamp(window.endMs),
        caption: sourceAnchoredCaption(excerpt, clipCta, analysis.thesis),
        hashtags: sanitizeHashtags([...strategyTags, ...topicTags], strategyTags),
        scores,
        whyItWorks: sourceAnchoredWhyItWorks(
          window.text,
          clipCta,
          `Trecho alinhado ao angulo ${taskProfile.strategy}, com gancho inicial claro e fechamento acionavel para ${profile.audience.toLowerCase()}.`
        )
      };
    })
  };
}

export function buildNewsletter(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile
): NewsletterPayload {
  const profile = generationProfile ?? defaultGenerationProfile();
  const taskProfile = profile.tasks.newsletter;
  const strongestSegments = takeBestSegments(segments, 8).map((segment) => segment.text);
  const insightSectionsCount = taskProfile.length === "short" ? 2 : taskProfile.length === "long" ? 4 : 3;
  const insightBodies = strongestSegments
    .slice(0, insightSectionsCount)
    .map((line) => normalizeText(line, 5000, 30, analysis.thesis));
  const uniqueInsightBodies: string[] = [];
  for (const body of insightBodies) {
    if (body.length === 0) {
      continue;
    }
    const duplicate = uniqueInsightBodies.some((existing) => lexicalOverlapRatio(body, existing) >= 0.86);
    if (!duplicate) {
      uniqueInsightBodies.push(body);
    }
  }
  while (uniqueInsightBodies.length < insightSectionsCount) {
    uniqueInsightBodies.push(
      normalizeText(
        analysis.recommendations[uniqueInsightBodies.length % Math.max(1, analysis.recommendations.length)] ??
          analysis.thesis,
        5000,
        30,
        analysis.thesis
      )
    );
  }
  const insightSections = uniqueInsightBodies.slice(0, insightSectionsCount).map((text, index) => {
    if (index === 0) {
      return {
        type: "insight" as const,
        title: "Mecanismo causal central",
        text: normalizeText(`Mecanismo: ${text}`, 5000, 30, text)
      };
    }
    return {
      type: "insight" as const,
      title: `Implicacao pratica ${index}`,
      text
    };
  });
  const ctaText = ctaByMode(taskProfile.ctaMode, profile.goal, taskProfile.targetOutcome);
  const checklistCandidates = [
    analysis.structure?.application ?? "",
    analysis.recommendations[0] ?? "",
    analysis.recommendations[1] ?? "",
    analysis.recommendations[2] ?? "",
    strongestSegments[insightSectionsCount] ?? "",
    `Aplique o angulo ${taskProfile.strategy} com criterio de ${taskProfile.targetOutcome}.`,
    `Defina metrica principal: ${profile.performanceMemory.newsletter.kpi || "respostas qualificadas"}.`
  ]
    .map((item) => normalizeText(item, 2400, 24))
    .filter((item) => item.length >= 24);
  const checklist: string[] = [];
  for (const item of checklistCandidates) {
    const exists = checklist.some((existing) => lexicalOverlapRatio(existing, item) >= 0.84);
    if (!exists) {
      checklist.push(item);
    }
    if (checklist.length >= (taskProfile.length === "long" ? 6 : 5)) {
      break;
    }
  }

  return {
    headline: normalizeText(
      `Como aplicar ${analysis.topics[0] ?? "a mensagem central"} para ${profile.audience}`,
      300,
      12
    ),
    subheadline: normalizeText(
      `Objetivo: ${profile.goal}. Estrategia: ${taskProfile.strategy}. Mecanismo causal: ${analysis.structure?.insight ?? analysis.thesis}`,
      2400,
      42
    ),
    sections: [
      {
        type: "intro",
        text: normalizeText(
          `${analysis.structure?.problem ?? analysis.thesis} Tensao: ${analysis.structure?.tension ?? "o problema cresce quando nao existe distribuicao por canal."} Contexto: publico ${profile.audience}.`,
          5000,
          90
        )
      },
      ...insightSections,
      {
        type: "application",
        bullets: checklist
      },
      {
        type: "cta",
        text: normalizeText(
          `${ctaText} Qual metrica voce vai acompanhar na proxima semana para validar a execucao?`,
          2400,
          26
        )
      }
    ]
  };
}

export function buildLinkedin(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile
): LinkedinPayload {
  const profile = generationProfile ?? defaultGenerationProfile();
  const taskProfile = profile.tasks.linkedin;
  const bestSegments = takeBestSegments(segments, 6);
  const proofSeed =
    bestSegments.find((segment) => /\d|%|r\$/i.test(segment.text))?.text ??
    bestSegments[0]?.text ??
    analysis.structure?.insight ??
    analysis.thesis;
  const mechanism =
    analysis.structure?.insight ??
    analysis.recommendations[0] ??
    "Sem mecanismo causal claro, a execucao vira tentativa e erro.";
  const frameworkSteps = [
    analysis.recommendations[0] ?? "Defina uma tese operacional clara.",
    analysis.recommendations[1] ?? "Transforme em rotina de distribuicao por canal.",
    analysis.recommendations[2] ?? "Meça resultado e ajuste com frequencia semanal."
  ].map((step) => normalizeText(step, 3200, 18));
  const ctaText = ctaByMode(taskProfile.ctaMode, profile.goal, taskProfile.targetOutcome);
  const extraParagraphs =
    taskProfile.length === "long"
      ? [
          normalizeText(`Publico foco: ${profile.audience}. Objetivo: ${profile.goal}.`, 2400, 18),
          normalizeText(
            `KPI principal para validar progresso: ${profile.performanceMemory.linkedin.kpi || "comentarios qualificados e salvamentos"}.`,
            2400,
            18
          )
        ]
      : [];

  return {
    hook: normalizeText(`Tese forte: ${analysis.thesis}`, 2200, 26),
    body: [
      normalizeText(`Prova: ${proofSeed}`, 3200, 24, analysis.thesis),
      normalizeText(`Mecanismo: ${mechanism}`, 3200, 24, analysis.thesis),
      normalizeText(`Framework 1/3: ${frameworkSteps[0]}`, 3200, 24),
      normalizeText(`Framework 2/3: ${frameworkSteps[1]}`, 3200, 24),
      normalizeText(`Framework 3/3: ${frameworkSteps[2]}`, 3200, 24),
      ...extraParagraphs,
      normalizeText(
        `Aplicacao imediata: rode essa estrutura por duas semanas com estrategia ${taskProfile.strategy} e compare a evolucao de ${taskProfile.targetOutcome}.`,
        2400,
        24
      )
    ],
    ctaQuestion: normalizeText(
      `${ctaText} Qual metrica concreta voce vai reportar na proxima semana para provar que isso funcionou?`,
      2000,
      30
    )
  };
}

export function buildXPosts(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile
): XPostsPayload {
  const profile = generationProfile ?? defaultGenerationProfile();
  const taskProfile = profile.tasks.x;
  const segmentIdeas = takeBestSegments(segments, 14).map((segment) =>
    normalizeText(segment.text, 6000, 20, analysis.thesis)
  );
  const ideas = dedupeXPosts([
    analysis.thesis,
    analysis.structure?.problem ?? "",
    analysis.structure?.tension ?? "",
    analysis.structure?.insight ?? "",
    analysis.structure?.application ?? "",
    ...analysis.recommendations,
    ...segmentIdeas
  ]);
  const standaloneCount =
    taskProfile.length === "long" ? 6 : taskProfile.length === "short" ? 4 : 5;
  const threadCount =
    taskProfile.length === "long" ? 8 : taskProfile.length === "short" ? 5 : 6;
  const ctaVariants = ctaVariantsByMode(
    taskProfile.ctaMode,
    profile.goal,
    taskProfile.targetOutcome
  );
  const primaryCta = ctaVariants[0] ?? ctaByMode(taskProfile.ctaMode, profile.goal, taskProfile.targetOutcome);
  const secondaryCta = ctaVariants[1] ?? primaryCta;

  const standaloneSeed = [
    normalizeText(
      `Tese central: ${analysis.thesis}. Se voce publica o mesmo texto em todos os canais, voce perde retencao e resposta qualificada.`,
      6000,
      40,
      analysis.thesis
    ),
    normalizeText(
      `Erro recorrente: confundir consistencia com volume. Consistencia real e sistema com hook, formato e CTA adaptados por canal.`,
      6000,
      40
    ),
    normalizeText(
      `Mecanismo pratico: uma ideia forte vira 1 reel, 1 post de LinkedIn, 1 thread e 1 newsletter com angulos diferentes.`,
      6000,
      40
    ),
    normalizeText(
      `Publico alvo: ${profile.audience}. Objetivo atual: ${profile.goal}. Sem criterio por canal, o alcance nao vira resultado.`,
      6000,
      40
    ),
    normalizeText(
      `Framework rapido: tese, prova, aplicacao e CTA. Se faltar uma dessas etapas, a distribuicao perde eficiencia.`,
      6000,
      40
    ),
    normalizeText(
      `${ideas[0] ?? analysis.thesis} Aplicacao imediata: rode esse ajuste por 7 dias e compare com a semana anterior.`,
      6000,
      40
    ),
    normalizeText(
      `${ideas[1] ?? analysis.recommendations[0] ?? analysis.thesis} ${secondaryCta}`,
      6000,
      40
    )
  ];

  const threadSeed = [
    normalizeText(
      `${analysis.thesis} Esse e o ponto que separa conteudo que gera alcance de conteudo que gera crescimento real.`,
      6000,
      40
    ),
    normalizeText(
      `Problema: publicar igual em todos os canais. Resultado: queda de retencao, resposta superficial e baixa conversao de audiencia em acao.`,
      6000,
      40
    ),
    normalizeText(
      `Friccao: voce acredita que o volume resolve. Na pratica, sem adaptacao de hook e CTA, o algoritmo entrega e a audiencia ignora.`,
      6000,
      40
    ),
    normalizeText(
      `Insight: cada canal responde a um gatilho diferente. Reels pede gancho e ritmo, LinkedIn pede prova e framework, X pede tensao e punchline.`,
      6000,
      40
    ),
    normalizeText(
      `Aplicacao 1: escolha um video e extraia 3 trechos com conflitos distintos. Cada trecho vira um ativo com promessa propria.`,
      6000,
      40
    ),
    normalizeText(
      `Aplicacao 2: no fechamento, use CTA observavel com prazo. Exemplo: comentar a metrica que vai acompanhar em 7 dias.`,
      6000,
      40
    ),
    normalizeText(
      `${ideas[2] ?? analysis.recommendations[1] ?? analysis.thesis} ${primaryCta}`,
      6000,
      40
    ),
    normalizeText(
      `Fechamento: execute por 7 dias, compare as metricas de retencao e compartilhe o resultado para ajustar a proxima rodada.`,
      6000,
      40
    )
  ];

  const standalone = standaloneSeed.slice(0, standaloneCount);
  const thread = threadSeed.slice(0, threadCount).map((post, idx, arr) =>
    fitXPostLength(`${idx + 1}/${arr.length} ${post}`.trim(), post)
  );

  return sanitizeXPayload(
    {
      standalone,
      thread,
      notes: {
        style: normalizeText(
          `${taskProfile.strategy}, ${taskProfile.length}, tom ${profile.tone.toLowerCase()}, foco em substancia e aplicacao`,
          300,
          3
        )
      }
    },
    taskProfile.ctaMode,
    taskProfile.length
  );
}

function avgLength(values: string[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sum = values.reduce((acc, value) => acc + value.length, 0);
  return sum / values.length;
}

function uniqueRatio(values: string[]): number {
  if (values.length === 0) {
    return 1;
  }

  const normalized = values.map((value) =>
    cleanToken(value.toLowerCase().replace(/\s+/g, " "))
  );
  const unique = new Set(normalized.filter((value) => value.length > 0));
  return unique.size / values.length;
}

function isGenericToken(raw: string): boolean {
  const normalized = cleanToken(raw);
  return (
    normalized.length < 4 ||
    STOPWORDS.has(normalized) ||
    [
      "coisa",
      "pessoa",
      "cara",
      "negocio",
      "isso",
      "aquilo",
      "tema",
      "assunto"
    ].includes(normalized)
  );
}

function roundScore(value: number): number {
  return Number(clamp(value, 0, 10).toFixed(2));
}

function averageSubscores(subscores: QualitySubscores): number {
  const values = [
    subscores.clarity,
    subscores.depth,
    subscores.originality,
    subscores.applicability,
    subscores.retentionPotential
  ];
  return roundScore(values.reduce((sum, item) => sum + item, 0) / values.length);
}

function subscoresAnalysis(payload: AnalysisPayload): QualitySubscores {
  const genericTopics = payload.topics.filter((topic) => isGenericToken(topic)).length;
  const avgRecLength = avgLength(payload.recommendations);
  const structureFilled = payload.structure
    ? [payload.structure.problem, payload.structure.tension, payload.structure.insight, payload.structure.application]
        .filter((item) => item.trim().length >= 10).length
    : 0;
  const retentionCount = payload.retentionMoments?.length ?? 0;
  const anglesCount = payload.editorialAngles?.length ?? 0;
  const weakSpotsCount = payload.weakSpots?.length ?? 0;
  const declaredQuality = payload.qualityScores;

  return {
    clarity: roundScore(
      5.2 +
        (payload.thesis.length >= 70 ? 1.8 : payload.thesis.length >= 45 ? 1.1 : 0.4) +
        (payload.topics.length >= 4 ? 1.2 : 0.5) +
        (structureFilled >= 3 ? 0.8 : 0.2) -
        genericTopics * 0.25
    ),
    depth: roundScore(
      4.8 +
        (payload.recommendations.length >= 4 ? 1.7 : 0.9) +
        (avgRecLength >= 80 ? 1.4 : avgRecLength >= 55 ? 0.8 : 0.2) +
        (retentionCount >= 4 ? 0.8 : 0.2) +
        (anglesCount >= 3 ? 0.8 : 0.2)
    ),
    originality: roundScore(
      4.9 +
        (uniqueRatio(payload.topics) >= 0.85 ? 1.3 : 0.7) +
        (payload.contentType === "provocative" || payload.contentType === "framework" ? 0.8 : 0.3) -
        genericTopics * 0.3
    ),
    applicability: roundScore(
      5 +
        (payload.recommendations.length >= 4 ? 1.5 : 0.8) +
        (avgRecLength >= 65 ? 1 : 0.4) +
        (structureFilled >= 4 ? 0.7 : 0.2) +
        (weakSpotsCount >= 2 ? 0.4 : 0)
    ),
    retentionPotential: roundScore(
      4.8 +
        (payload.polarityScore >= 4 && payload.polarityScore <= 8 ? 1.4 : 0.8) +
        (payload.thesis.length >= 55 ? 0.8 : 0.3) +
        (retentionCount >= 4 ? 0.9 : 0.3) +
        (declaredQuality?.insightDensity && declaredQuality.insightDensity >= 8 ? 0.5 : 0)
    )
  };
}

function subscoresReels(payload: ReelsPayload): QualitySubscores {
  const captionAvg = avgLength(payload.clips.map((clip) => clip.caption));
  const whyAvg = avgLength(payload.clips.map((clip) => clip.whyItWorks));
  const hashtagsAvg =
    payload.clips.reduce((acc, clip) => acc + clip.hashtags.length, 0) / Math.max(1, payload.clips.length);
  const startsWithCorte = payload.clips.filter((clip) => /^corte\s+\d+/i.test(clip.title)).length;
  const lineBreakRatio =
    payload.clips.filter((clip) => /\n/.test(clip.caption)).length / Math.max(1, payload.clips.length);

  return {
    clarity: roundScore(
      4.9 +
        (captionAvg >= 220 ? 1.7 : captionAvg >= 170 ? 1.1 : 0.4) +
        (whyAvg >= 90 ? 1.2 : 0.6)
    ),
    depth: roundScore(
      4.6 +
        (whyAvg >= 110 ? 1.8 : whyAvg >= 75 ? 1.1 : 0.4) +
        (captionAvg >= 210 ? 1.2 : 0.5)
    ),
    originality: roundScore(
      4.8 +
        (uniqueRatio(payload.clips.map((clip) => clip.title)) >= 0.8 ? 1.2 : 0.6) +
        (startsWithCorte === 0 ? 0.7 : 0) +
        (hashtagsAvg >= 4 ? 0.7 : 0.2)
    ),
    applicability: roundScore(
      4.8 +
        (payload.clips.some((clip) => /(comente|compartilhe|direct|responda)/i.test(clip.caption))
          ? 1.4
          : 0.6) +
        (hashtagsAvg >= 4 ? 0.8 : 0.3)
    ),
    retentionPotential: roundScore(
      5 +
        (payload.clips.length >= 2 ? 1 : 0.4) +
        (lineBreakRatio >= 0.8 ? 1 : 0.3) +
        (startsWithCorte === 0 ? 0.8 : 0.1)
    )
  };
}

function subscoresNewsletter(payload: NewsletterPayload): QualitySubscores {
  const insights = payload.sections.filter((section) => section.type === "insight");
  const intro = payload.sections.find((section) => section.type === "intro");
  const application = payload.sections.find((section) => section.type === "application");
  const cta = payload.sections.find((section) => section.type === "cta");
  const bulletsCount = application?.type === "application" ? application.bullets.length : 0;
  const insightsAvg =
    insights.length > 0
      ? avgLength(insights.map((section) => (section.type === "insight" ? section.text : "")))
      : 0;

  return {
    clarity: roundScore(
      5 +
        (payload.headline.length >= 45 ? 1.2 : 0.6) +
        (payload.subheadline.length >= 70 ? 1.1 : 0.4) +
        (intro && intro.text.length >= 130 ? 0.9 : 0.3)
    ),
    depth: roundScore(
      4.9 +
        (insights.length >= 2 ? 1.4 : 0.7) +
        (insightsAvg >= 170 ? 1.4 : insightsAvg >= 120 ? 0.8 : 0.3)
    ),
    originality: roundScore(
      4.8 +
        (uniqueRatio(insights.map((section) => (section.type === "insight" ? section.text : ""))) >= 0.8
          ? 1.2
          : 0.6) +
        (payload.headline.length >= 40 ? 0.8 : 0.3)
    ),
    applicability: roundScore(
      5 +
        (bulletsCount >= 4 ? 1.6 : bulletsCount >= 3 ? 1 : 0.4) +
        (cta && cta.text.length >= 40 ? 0.8 : 0.3)
    ),
    retentionPotential: roundScore(
      4.7 +
        (payload.headline.length >= 40 ? 1.1 : 0.5) +
        (insights.length >= 2 ? 1 : 0.4) +
        (cta ? 0.7 : 0.2)
    )
  };
}

function subscoresLinkedin(payload: LinkedinPayload): QualitySubscores {
  const bodyAvg = avgLength(payload.body);
  const practicalMarkers = payload.body.filter((paragraph) =>
    /(exemplo|passo|aplique|na pratica|resultado|erro|framework|metodo)/i.test(paragraph)
  ).length;

  return {
    clarity: roundScore(
      5 +
        (payload.hook.length >= 45 ? 1.3 : 0.6) +
        (bodyAvg >= 95 ? 1.2 : bodyAvg >= 70 ? 0.8 : 0.3)
    ),
    depth: roundScore(
      4.7 +
        (payload.body.length >= 5 ? 1.3 : 0.7) +
        (practicalMarkers >= 2 ? 1.4 : 0.7)
    ),
    originality: roundScore(
      4.8 +
        (uniqueRatio(payload.body) >= 0.82 ? 1.3 : 0.7) +
        (payload.hook.length >= 35 ? 0.7 : 0.2)
    ),
    applicability: roundScore(
      4.9 +
        (practicalMarkers >= 2 ? 1.6 : 0.8) +
        (/\?$/.test(payload.ctaQuestion.trim()) ? 0.8 : 0.3)
    ),
    retentionPotential: roundScore(
      4.9 +
        (payload.hook.length >= 45 ? 1.2 : 0.5) +
        (payload.body.length >= 5 ? 1 : 0.4)
    )
  };
}

function subscoresX(payload: XPostsPayload): QualitySubscores {
  const all = [...payload.standalone, ...payload.thread];
  const standaloneAvg = avgLength(payload.standalone);
  const threadAvg = avgLength(payload.thread);

  return {
    clarity: roundScore(
      4.9 +
        (standaloneAvg >= 80 ? 1.2 : 0.6) +
        (threadAvg >= 85 ? 1.2 : 0.6)
    ),
    depth: roundScore(
      4.7 +
        (payload.thread.length >= 5 ? 1.3 : 0.7) +
        (threadAvg >= 90 ? 1.2 : 0.6)
    ),
    originality: roundScore(
      4.8 +
        (uniqueRatio(all) >= 0.82 ? 1.5 : 0.7) +
        (payload.notes.style.length >= 12 ? 0.7 : 0.2)
    ),
    applicability: roundScore(
      4.8 +
        (all.some((item) => /(passo|aplique|faca|execute|teste)/i.test(item)) ? 1.4 : 0.7) +
        (payload.thread.some((item) => /^\d+\//.test(item.trim())) ? 0.8 : 0.3)
    ),
    retentionPotential: roundScore(
      5 +
        (payload.standalone.length >= 4 ? 1 : 0.4) +
        (payload.thread.length >= 5 ? 1.1 : 0.5)
    )
  };
}

function heuristicEvaluationByTask(
  task: AITask,
  payload: AnalysisPayload | ReelsPayload | NewsletterPayload | LinkedinPayload | XPostsPayload
): QualityEvaluation {
  const subscores: QualitySubscores =
    task === "analysis"
      ? subscoresAnalysis(payload as AnalysisPayload)
      : task === "reels"
        ? subscoresReels(payload as ReelsPayload)
        : task === "newsletter"
          ? subscoresNewsletter(payload as NewsletterPayload)
          : task === "linkedin"
            ? subscoresLinkedin(payload as LinkedinPayload)
            : subscoresX(payload as XPostsPayload);

  return {
    overall: averageSubscores(subscores),
    subscores,
    summary: "Heuristic rubric",
    weaknesses: []
  };
}

function qualityRubric(task: AITask): string {
  if (task === "analysis") {
    return [
      "thesis: mecanica causal explicita e falsificavel",
      "topics: concretos, sem placeholders vagos",
      "recommendations: acionaveis em 30-90 dias",
      "structure: problema, tensao, insight e aplicacao coerentes",
      "retentionMoments/editorialAngles: utilidade real por canal",
      "penalizar inflacao de nota sem evidencia textual"
    ].join("; ");
  }

  if (task === "reels") {
    return [
      "clip com janela temporal forte e sem introducao fraca",
      "title com tensao imediata e promessa concreta",
      "caption com aplicacao pratica e CTA aderente ao objetivo",
      "hashtags especificas e sem poluicao",
      "whyItWorks com racional objetivo de retencao"
    ].join("; ");
  }

  if (task === "newsletter") {
    return [
      "progressao logica sem repeticao",
      "insights densos com mecanismo causal",
      "aplicacao com checklist operacional",
      "cta com intencao qualificada e criterio"
    ].join("; ");
  }

  if (task === "linkedin") {
    return [
      "hook forte sem clickbait raso",
      "corpo progressivo com evidencias e aplicacao",
      "clareza sem contexto externo",
      "cta final especifico e nao binario"
    ].join("; ");
  }

  return [
    "standalone com punchline e substancia",
    "thread com progressao real por etapas",
    "baixa repeticao lexical e argumentativa",
    "aplicabilidade e memorabilidade"
  ].join("; ");
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function emitTaskDiagnostics(
  recorder: GenerationDiagnosticsRecorder | undefined,
  entry: Omit<TaskGenerationDiagnostics, "updatedAt">
): void {
  if (!recorder) {
    return;
  }

  recorder(entry);
}

async function requestTaskRefinement(
  task: AITask,
  currentPayload: Record<string, unknown>,
  context: string,
  currentScore: number,
  qualityThreshold: number,
  judgeWeaknesses: string[],
  passIndex: number,
  passTarget: number,
  usageRecorder?: (usage: TaskRequestUsage) => void
): Promise<TaskRequestResult> {
  const systemPrompt = [
    "Voce e um Editor-Chefe de conteudo premium.",
    "Sua missao e reescrever o JSON candidato para elevar qualidade editorial sem quebrar schema.",
    "Priorize especificidade, densidade de insight, progressao logica e aplicabilidade pratica.",
    "Seu trabalho e transformar respostas medianas em respostas de nivel senior.",
    "Remova frases vagas, repeticao, cliche e qualquer tom motivacional vazio.",
    "Nao invente fatos fora do contexto fornecido.",
    "Nunca use travessao em nenhum texto.",
    "Retorne SOMENTE JSON valido."
  ].join("\n");

  const userPrompt = [
    `TAREFA: ${task}`,
    `PASSE_REFINO: ${passIndex}/${passTarget}`,
    `SCORE_ATUAL: ${currentScore.toFixed(2)}/10`,
    `META_MINIMA: ${qualityThreshold.toFixed(1)}/10`,
    `RUBRICA: ${qualityRubric(task)}`,
    "CONTEXTO:",
    context,
    "JSON_CANDIDATO:",
    JSON.stringify(currentPayload, null, 2),
    "REGRAS DE MELHORIA OBRIGATORIAS:",
    "1) Aumente especificidade sem extrapolar o contexto.",
    "2) Substitua termos vagos por formulacoes concretas.",
    "3) Entregue mais profundidade pratica e menos slogan.",
    "4) Mantenha o mesmo schema e os mesmos campos.",
    `5) Corrija estas fraquezas: ${judgeWeaknesses.length > 0 ? judgeWeaknesses.join(" | ") : "n/a"}.`,
    "INSTRUCAO FINAL: entregue uma versao claramente superior no mesmo schema."
  ].join("\n\n");

  return requestTaskJson(task, systemPrompt, userPrompt, {
    maxTokens: TASK_MAX_TOKENS[task],
    usageRecorder
  });
}

function minimumSubscore(subscores: QualitySubscores): number {
  return Math.min(
    subscores.clarity,
    subscores.depth,
    subscores.originality,
    subscores.applicability,
    subscores.retentionPotential
  );
}

function clampSubscores(subscores: QualitySubscores): QualitySubscores {
  return {
    clarity: roundScore(subscores.clarity),
    depth: roundScore(subscores.depth),
    originality: roundScore(subscores.originality),
    applicability: roundScore(subscores.applicability),
    retentionPotential: roundScore(subscores.retentionPotential)
  };
}

function canonicalJudgeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatedTextRatio(values: string[]): number {
  const normalized = values
    .map((item) => canonicalJudgeText(item))
    .filter((item) => item.length >= 12);
  if (normalized.length <= 1) {
    return 0;
  }

  const unique = new Set(normalized);
  return 1 - unique.size / normalized.length;
}

function fallbackJudgeEvaluation(
  task: AITask,
  payload: AnyTaskPayload,
  heuristic: QualityEvaluation,
  unavailableReason = "judge_unavailable"
): QualityEvaluation {
  const next = {
    clarity: heuristic.subscores.clarity - 0.35,
    depth: heuristic.subscores.depth - 0.45,
    originality: heuristic.subscores.originality - 0.4,
    applicability: heuristic.subscores.applicability - 0.3,
    retentionPotential: heuristic.subscores.retentionPotential - 0.25
  };
  const weaknesses = [unavailableReason];
  const registerPenalty = (
    field: keyof QualitySubscores,
    amount: number,
    reason: string
  ) => {
    next[field] -= amount;
    weaknesses.push(reason);
  };

  const textBlocks = collectTaskStringBlocks(task, payload).map((block) => block.text);
  const ellipsisCount = textBlocks.filter((item) => containsEllipsisArtifact(item)).length;
  if (ellipsisCount > 0) {
    registerPenalty("clarity", 1.1, "truncation_artifact_detected");
    registerPenalty("applicability", 0.7, "truncated_copy_not_publish_ready");
  }

  const repetition = repeatedTextRatio(textBlocks);
  if (repetition >= 0.22) {
    registerPenalty("originality", 0.9, "argument_repetition_high");
  } else if (repetition >= 0.14) {
    registerPenalty("originality", 0.5, "argument_repetition_moderate");
  }

  if (task === "analysis") {
    const analysis = payload as AnalysisPayload;
    const topicGenericCount = analysis.topics.filter((topic) =>
      /^(coisa|pessoa|isso|tema|negocio|assunto)$/i.test(topic.trim())
    ).length;
    if (analysis.recommendations.length < 4) {
      registerPenalty("applicability", 0.8, "recommendations_shallow");
    }
    if (analysis.thesis.length < 70) {
      registerPenalty("depth", 0.7, "thesis_too_short");
    }
    if (topicGenericCount > 0) {
      registerPenalty("clarity", 0.5, "generic_topics_detected");
    }
    if ((analysis.weakSpots?.length ?? 0) < 2) {
      registerPenalty("depth", 0.5, "weak_spot_diagnosis_thin");
    }
  } else if (task === "reels") {
    const reels = payload as ReelsPayload;
    const shortCaptions = reels.clips.filter((clip) => clip.caption.trim().length < 180).length;
    const genericTitles = reels.clips.filter((clip) => /^corte\s+\d+/i.test(clip.title)).length;
    const weakRationale = reels.clips.filter((clip) => clip.whyItWorks.trim().length < 110).length;
    if (shortCaptions > 0) {
      registerPenalty("retentionPotential", 0.8, "caption_density_low");
    }
    if (genericTitles > 0) {
      registerPenalty("originality", 0.7, "generic_reels_titles");
    }
    if (weakRationale > 0) {
      registerPenalty("depth", 0.8, "why_it_works_shallow");
    }
  } else if (task === "newsletter") {
    const newsletter = payload as NewsletterPayload;
    const insights = newsletter.sections.filter((section) => section.type === "insight");
    const application = newsletter.sections.find((section) => section.type === "application");
    if (insights.length < 3) {
      registerPenalty("depth", 0.8, "insight_count_low");
    }
    if (!application || application.type !== "application" || application.bullets.length < 4) {
      registerPenalty("applicability", 0.9, "application_checklist_weak");
    }
    const cta = newsletter.sections.find((section) => section.type === "cta");
    if (!cta || !hasCtaIntent(cta.text, "lead")) {
      registerPenalty("applicability", 0.6, "cta_without_clear_intent");
    }
  } else if (task === "linkedin") {
    const linkedin = payload as LinkedinPayload;
    const practicalMarkers = linkedin.body.filter((paragraph) =>
      /(exemplo|passo|aplique|na pratica|resultado|framework|metodo|dados)/i.test(paragraph)
    ).length;
    if (linkedin.body.length < 5) {
      registerPenalty("depth", 0.8, "linkedin_body_short");
    }
    if (practicalMarkers < 2) {
      registerPenalty("applicability", 0.8, "linkedin_low_practical_density");
    }
    if (!/\?\s*$/.test(linkedin.ctaQuestion.trim())) {
      registerPenalty("clarity", 0.4, "linkedin_cta_not_question");
    }
  } else if (task === "x") {
    const xPayload = payload as XPostsPayload;
    const allPosts = [...xPayload.standalone, ...xPayload.thread];
    const shortPosts = allPosts.filter((post) => post.trim().length < 90).length;
    const numberedThread = xPayload.thread.filter((item) => /^\s*\d+\s*\/\s*\d*/.test(item.trim())).length;
    if (shortPosts > 0) {
      registerPenalty("depth", 0.7, "x_posts_too_short");
    }
    if (numberedThread < Math.min(3, xPayload.thread.length)) {
      registerPenalty("retentionPotential", 0.6, "thread_progression_weak");
    }
    if (!allPosts.some((item) => /(passo|aplique|execute|teste|comente|compartilhe)/i.test(item))) {
      registerPenalty("applicability", 0.7, "x_low_actionability");
    }
  }

  const penalizedSubscores = clampSubscores(next);
  const penalized = roundScore(Math.max(0, averageSubscores(penalizedSubscores) - 0.1));
  const uniqueWeaknesses = [...new Set(weaknesses)];

  return {
    overall: penalized,
    subscores: penalizedSubscores,
    summary: `Judge indisponivel para ${task} (${unavailableReason}); fallback rigoroso aplicado com ${Math.max(0, uniqueWeaknesses.length - 1)} alertas`,
    weaknesses: uniqueWeaknesses.slice(0, 6)
  };
}

function applyInflationGuard(
  heuristicEval: QualityEvaluation,
  judgeEval: QualityEvaluation,
  compositeScore: number
): { displayScore: number; applied: boolean; reason: string | null } {
  const minJudge = minimumSubscore(judgeEval.subscores);
  let displayScore = compositeScore;
  let reason: string | null = null;

  if (heuristicEval.overall >= 9.7 && judgeEval.overall <= 8.6) {
    displayScore = roundScore(Math.min(displayScore, judgeEval.overall + 0.45));
    reason = "high_heuristic_without_judge_support";
  } else if (minimumSubscore(heuristicEval.subscores) >= 9.2 && minJudge < 8.6) {
    displayScore = roundScore(Math.min(displayScore, judgeEval.overall + 0.35));
    reason = "subscore_mismatch_guard";
  }

  if (displayScore > 9.95 && !(judgeEval.overall >= 9.7 && minJudge >= 9.1)) {
    displayScore = 9.45;
    reason = "hard_cap_without_judge_confirmation";
  }

  return {
    displayScore: roundScore(displayScore),
    applied: reason !== null,
    reason
  };
}

function computePublishabilityScore(
  task: AITask,
  payload: AnyTaskPayload,
  heuristicEval: QualityEvaluation,
  judgeEval: QualityEvaluation
): number {
  let score =
    judgeEval.overall * 0.34 +
    judgeEval.subscores.applicability * 0.24 +
    judgeEval.subscores.clarity * 0.15 +
    judgeEval.subscores.retentionPotential * 0.11 +
    heuristicEval.subscores.applicability * 0.1 +
    heuristicEval.subscores.clarity * 0.06;

  const textBlocks = collectTaskStringBlocks(task, payload).map((block) => block.text);
  const hasTruncation = textBlocks.some((text) => containsEllipsisArtifact(text));
  if (hasTruncation) {
    score -= 1.1;
  }

  const repetition = repeatedTextRatio(textBlocks);
  if (repetition >= 0.22) {
    score -= 0.55;
  } else if (repetition >= 0.14) {
    score -= 0.25;
  }

  if (task === "reels") {
    const reels = payload as ReelsPayload;
    const allHasIntent = reels.clips.every((clip) => hasCtaIntent(clip.caption, "comment"));
    if (!allHasIntent) {
      score -= 0.35;
    }
  } else if (task === "newsletter") {
    const newsletter = payload as NewsletterPayload;
    const cta = newsletter.sections.find((section) => section.type === "cta");
    if (!cta || !hasCtaIntent(cta.text, "lead")) {
      score -= 0.35;
    }
  } else if (task === "linkedin") {
    const linkedin = payload as LinkedinPayload;
    if (!hasCtaIntent(linkedin.ctaQuestion, "comment")) {
      score -= 0.3;
    }
  } else if (task === "x") {
    const xPayload = payload as XPostsPayload;
    const hasIntent = [...xPayload.standalone, ...xPayload.thread].some((item) =>
      hasCtaIntent(item, "share")
    );
    if (!hasIntent) {
      score -= 0.3;
    }
  }

  return roundScore(score);
}

function coerceJudgeEvaluation(output: Record<string, unknown>): QualityEvaluation | null {
  const toScore = (value: unknown, fallback: number) => {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return roundScore(clamp(number, 0, 10));
  };

  const score = toScore(output.qualityScore ?? output.score ?? output.overall, -1);
  if (score < 0) {
    return null;
  }

  const rawSubscores = asRecord(output.subscores ?? output.scores) ?? {};
  const subscores = clampSubscores({
    clarity: toScore(rawSubscores.clarity, score),
    depth: toScore(rawSubscores.depth, score),
    originality: toScore(rawSubscores.originality, score),
    applicability: toScore(rawSubscores.applicability, score),
    retentionPotential: toScore(
      rawSubscores.retentionPotential ?? rawSubscores.retention,
      score
    )
  });

  return {
    overall: score,
    subscores,
    summary: normalizeText(
      pickString(output.summary, output.rationale, output.reason) ?? "Judge sem observacoes",
      220,
      8,
      "Judge sem observacoes"
    ),
    weaknesses: asStringArray(output.weaknesses ?? output.issues).slice(0, 6)
  };
}

interface JudgeRequestResult {
  evaluation: QualityEvaluation | null;
  unavailableReason: string | null;
}

function normalizeJudgeUnavailableReason(reason: string | null): string {
  if (!reason || reason.trim().length === 0) {
    return "judge_empty_response";
  }
  if (reason.includes("provider configured as heuristic")) {
    return "judge_provider_set_heuristic";
  }
  if (reason.includes("key not configured")) {
    return "judge_provider_key_missing";
  }
  if (isCircuitOpenReason(reason)) {
    return "judge_circuit_open";
  }
  if (isAbortLikeReason(reason)) {
    return "judge_request_aborted_or_timeout";
  }
  if (isJsonParseLikeReason(reason)) {
    return "judge_invalid_json_response";
  }

  const compact = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return compact.length > 0 ? compact.slice(0, 80) : "judge_request_failed";
}

async function requestTaskJudge(
  task: AITask,
  candidate: Record<string, unknown>,
  context: string,
  usePanel = false,
  usageRecorder?: (usage: TaskRequestUsage) => void
) : Promise<JudgeRequestResult> {
  const strictJudge = await requestTaskJudgeSingle(
    task,
    candidate,
    context,
    "strict",
    usageRecorder
  );
  if (!usePanel || !strictJudge.evaluation) {
    return strictJudge;
  }

  const adversarialJudge = await requestTaskJudgeSingle(
    task,
    candidate,
    context,
    "adversarial",
    usageRecorder
  );
  if (!adversarialJudge.evaluation) {
    return {
      evaluation: strictJudge.evaluation,
      unavailableReason: adversarialJudge.unavailableReason
    };
  }

  return {
    evaluation: combineJudgeEvaluations(strictJudge.evaluation, adversarialJudge.evaluation),
    unavailableReason: null
  };
}

type JudgeMode = "strict" | "adversarial";

async function requestTaskJudgeSingle(
  task: AITask,
  candidate: Record<string, unknown>,
  context: string,
  mode: JudgeMode,
  usageRecorder?: (usage: TaskRequestUsage) => void
): Promise<JudgeRequestResult> {
  const systemPrompt = judgeSystemPrompt(task, mode);
  const compactContext = truncate(context, JUDGE_CONTEXT_MAX_CHARS[task]);

  const userPrompt = [
    `TAREFA: ${task}`,
    `MODO_AVALIACAO: ${mode}`,
    `RUBRICA: ${qualityRubric(task)}`,
    "ANCORAS_DE_NOTA:",
    "10 = elite publicavel sem ajustes | 8 = bom com poucos ajustes | 6 = mediano | 4 = fraco | 2 = inutilizavel",
    "ANCORAS_POR_SUBNOTA:",
    "clarity: sem contexto externo, sem ambiguidades",
    "depth: mecanismo causal, nao apenas opiniao",
    "originality: angulo proprio e baixa repeticao",
    "applicability: proximo passo concreto e executavel",
    "retentionPotential: ritmo, tensao e memorabilidade",
    "REQUISITO: penalize genericidade, repeticao, abstracao vazia e falta de aplicacao concreta.",
    "REQUISITO: se houver erro de formato, reduza drasticamente clarity e applicability.",
    "REQUISITO: se detectar texto truncado com ... ou [continua], nota maxima 6.5.",
    "REQUISITO: nunca inflar nota apenas por tamanho de texto.",
    "CONTEXTO:",
    compactContext,
    "JSON_CANDIDATO:",
    JSON.stringify(candidate, null, 2),
    "FORMATO DE RESPOSTA:",
    '{ "qualityScore": 0-10, "subscores": { "clarity": 0-10, "depth": 0-10, "originality": 0-10, "applicability": 0-10, "retentionPotential": 0-10 }, "summary": "justificativa curta em ate 220 chars", "weaknesses": ["falha 1", "falha 2"], "confidence": 0-1 }'
  ].join("\n\n");

  const judgeResult = await requestTaskJson(task, systemPrompt, userPrompt, {
    maxTokens: 700,
    timeoutMs: TASK_JUDGE_TIMEOUT_MS[task],
    routeKind: "judge",
    usageRecorder
  });

  if (!judgeResult.output) {
    return {
      evaluation: null,
      unavailableReason: normalizeJudgeUnavailableReason(judgeResult.trace.fallbackReason)
    };
  }

  const parsed = QUALITY_JUDGE_SCHEMA.safeParse(judgeResult.output);
  if (parsed.success) {
    return {
      evaluation: {
        overall: roundScore(parsed.data.qualityScore),
        subscores: clampSubscores(parsed.data.subscores),
        summary: normalizeText(parsed.data.summary, 220, 8, "Judge sem observacoes"),
        weaknesses: (parsed.data.weaknesses ?? [])
          .map((item) => normalizeText(item, 140, 4))
          .slice(0, 6)
      },
      unavailableReason: null
    };
  }

  const coerced = coerceJudgeEvaluation(judgeResult.output);
  if (coerced) {
    return {
      evaluation: coerced,
      unavailableReason: null
    };
  }

  return {
    evaluation: null,
    unavailableReason: "judge_schema_parse_failed"
  };
}

function combineJudgeEvaluations(
  strictJudge: QualityEvaluation,
  adversarialJudge: QualityEvaluation
): QualityEvaluation {
  const mergeSubscore = (key: keyof QualitySubscores): number =>
    roundScore(
      strictJudge.subscores[key] * 0.55 +
        adversarialJudge.subscores[key] * 0.45
    );

  const weaknesses = [...new Set([...strictJudge.weaknesses, ...adversarialJudge.weaknesses])].slice(0, 8);

  return {
    overall: roundScore(strictJudge.overall * 0.55 + adversarialJudge.overall * 0.45),
    subscores: {
      clarity: mergeSubscore("clarity"),
      depth: mergeSubscore("depth"),
      originality: mergeSubscore("originality"),
      applicability: mergeSubscore("applicability"),
      retentionPotential: mergeSubscore("retentionPotential")
    },
    summary: normalizeText(
      `${strictJudge.summary} Auditoria: ${adversarialJudge.summary}`,
      220,
      8,
      strictJudge.summary
    ),
    weaknesses
  };
}

function judgeSystemPrompt(task: AITask, mode: JudgeMode): string {
  const base = [
    "Voce e um Juiz Editorial Senior.",
    "Avalie o JSON candidato sem reescrever o conteudo.",
    mode === "adversarial"
      ? "Modo adversarial: atue como auditor rigoroso buscando falhas ocultas."
      : "Modo strict: avalie com criterio tecnico duro, sem inflar nota.",
    "Seja rigido contra texto generico e score inflado.",
    "Se houver truncamento, repeticao excessiva ou schema parcial, aplique penalidade forte.",
    "Retorne SOMENTE JSON valido."
  ];

  if (task === "reels") {
    return [
      ...base,
      "Para reels, punir corte sem gancho, legenda generica, CTA fraco, hashtag ruim e justificativa vaga."
    ].join("\n");
  }

  if (task === "newsletter") {
    return [
      ...base,
      "Para newsletter, punir abstracao, falta de progressao, falta de aplicacao e cta sem especificidade."
    ].join("\n");
  }

  if (task === "linkedin") {
    return [
      ...base,
      "Para linkedin, punir hook fraco, repeticao, corpo sem argumento e pergunta final generica."
    ].join("\n");
  }

  if (task === "x") {
    return [
      ...base,
      "Para x, punir thread sem progressao, baixa densidade e posts sem memorabilidade."
    ].join("\n");
  }

  return [
    ...base,
    "Para analysis, punir tese superficial, topicos vagos, recomendacoes nao acionaveis, ausencia de mechanismo causal, retention moments fracos e notas infladas sem evidencia."
  ].join("\n");
}

const DEFAULT_SCORE_WEIGHTS: TaskScoreWeights = {
  judge: 0.72,
  heuristic: 0.28
};

function normalizeTaskScoreWeights(scoreWeights?: TaskScoreWeights): TaskScoreWeights {
  const judgeRaw =
    typeof scoreWeights?.judge === "number" && Number.isFinite(scoreWeights.judge)
      ? scoreWeights.judge
      : DEFAULT_SCORE_WEIGHTS.judge;
  const heuristicRaw =
    typeof scoreWeights?.heuristic === "number" && Number.isFinite(scoreWeights.heuristic)
      ? scoreWeights.heuristic
      : DEFAULT_SCORE_WEIGHTS.heuristic;
  const judge = Math.max(0.05, Math.min(0.95, judgeRaw));
  const heuristic = Math.max(0.05, Math.min(0.95, heuristicRaw));
  const sum = judge + heuristic;
  if (!Number.isFinite(sum) || sum <= 0) {
    return DEFAULT_SCORE_WEIGHTS;
  }
  return {
    judge: Number((judge / sum).toFixed(3)),
    heuristic: Number((heuristic / sum).toFixed(3))
  };
}

function candidateCompositeScore(
  heuristicEval: QualityEvaluation,
  judgeEval: QualityEvaluation,
  scoreWeights?: TaskScoreWeights
): number {
  const weights = normalizeTaskScoreWeights(scoreWeights);
  const weakPenalty = Math.max(0, 3 - minimumSubscore(judgeEval.subscores)) * 0.06;
  const score =
    judgeEval.overall * weights.judge + heuristicEval.overall * weights.heuristic - weakPenalty;
  return roundScore(score);
}

function buildHeuristicOnlyQualityResult<T extends AnalysisPayload | ReelsPayload | NewsletterPayload | LinkedinPayload | XPostsPayload>(
  task: AITask,
  candidate: T,
  scoreWeights?: TaskScoreWeights,
  unavailableReason?: string
): QualityRefineResult<T> {
  const heuristic = heuristicEvaluationByTask(task, candidate);
  const judgeRoute = getRouteForTask(task, "judge");
  const inferredUnavailableReason =
    unavailableReason ??
    (judgeRoute.provider === "heuristic"
      ? "judge_provider_set_heuristic"
      : !isProviderConfigured(judgeRoute.provider)
        ? `judge_provider_key_missing_${judgeRoute.provider}`
        : "judge_unavailable");
  const judge = fallbackJudgeEvaluation(task, candidate, heuristic, inferredUnavailableReason);
  const composite = candidateCompositeScore(heuristic, judge, scoreWeights);
  const guard = applyInflationGuard(heuristic, judge, composite);
  const publishabilityScore = computePublishabilityScore(task, candidate, heuristic, judge);

  return {
    candidate,
    initialEval: heuristic,
    finalEval: heuristic,
    judgeEval: judge,
    qualityScore: guard.displayScore,
    publishabilityScore,
    refinementRequested: false,
    refinementApplied: false,
    candidateCount: 1,
    selectedCandidate: 1,
    refinePassesTarget: 0,
    refinePassesAppliedCount: 0,
    candidateEvaluations: [
      {
        candidateIndex: 1,
        heuristicScore: heuristic.overall,
        judgeScore: judge.overall,
        compositeScore: composite
      }
    ],
    inflationGuardApplied: guard.applied,
    inflationGuardReason: guard.reason,
    displayScore: guard.displayScore
  };
}

async function buildFallbackQualityResultWithJudge<T extends AnalysisPayload | ReelsPayload | NewsletterPayload | LinkedinPayload | XPostsPayload>(input: {
  task: AITask;
  candidate: T;
  context: string;
  useJudgePanel?: boolean;
  scoreWeights?: TaskScoreWeights;
  usageRecorder?: (usage: TaskRequestUsage) => void;
}): Promise<QualityRefineResult<T>> {
  const heuristic = heuristicEvaluationByTask(input.task, input.candidate);
  const judgeResult = await requestTaskJudge(
    input.task,
    asJsonRecord(input.candidate),
    input.context,
    Boolean(input.useJudgePanel),
    input.usageRecorder
  );
  if (!judgeResult.evaluation) {
    return buildHeuristicOnlyQualityResult(
      input.task,
      input.candidate,
      input.scoreWeights,
      judgeResult.unavailableReason ?? "judge_request_failed_or_invalid"
    );
  }
  const judge = judgeResult.evaluation;

  const composite = candidateCompositeScore(heuristic, judge, input.scoreWeights);
  const guard = applyInflationGuard(heuristic, judge, composite);
  const publishabilityScore = computePublishabilityScore(
    input.task,
    input.candidate,
    heuristic,
    judge
  );

  return {
    candidate: input.candidate,
    initialEval: heuristic,
    finalEval: heuristic,
    judgeEval: judge,
    qualityScore: guard.displayScore,
    publishabilityScore,
    refinementRequested: false,
    refinementApplied: false,
    candidateCount: 1,
    selectedCandidate: 1,
    refinePassesTarget: 0,
    refinePassesAppliedCount: 0,
    candidateEvaluations: [
      {
        candidateIndex: 1,
        heuristicScore: heuristic.overall,
        judgeScore: judge.overall,
        compositeScore: composite
      }
    ],
    inflationGuardApplied: guard.applied,
    inflationGuardReason: guard.reason,
    displayScore: guard.displayScore
  };
}

async function refineIfLowQuality<T extends AnalysisPayload | ReelsPayload | NewsletterPayload | LinkedinPayload | XPostsPayload>(input: {
  task: AITask;
  candidate: T;
  additionalCandidates?: T[];
  context: string;
  parseRefined: (value: Record<string, unknown>) => T | null;
  forceRefine?: boolean;
  maxRefinePasses?: number;
  qualityThreshold?: number;
  publishabilityThreshold?: number;
  useJudgePanel?: boolean;
  scoreWeights?: TaskScoreWeights;
  usageRecorder?: (usage: TaskRequestUsage) => void;
}): Promise<QualityRefineResult<T>> {
  const pool = [input.candidate, ...(input.additionalCandidates ?? [])];
  const evaluatedPool: Array<{
    candidate: T;
    heuristic: QualityEvaluation;
    judge: QualityEvaluation;
    composite: number;
    idx: number;
  }> = [];

  for (let idx = 0; idx < pool.length; idx += 1) {
    const candidate = pool[idx];
    const heuristic = heuristicEvaluationByTask(input.task, candidate);
    const judgeResult = await requestTaskJudge(
      input.task,
      asJsonRecord(candidate),
      input.context,
      Boolean(input.useJudgePanel),
      input.usageRecorder
    );
    const judge =
      judgeResult.evaluation ??
      fallbackJudgeEvaluation(
        input.task,
        candidate,
        heuristic,
        judgeResult.unavailableReason ?? "judge_request_failed_or_invalid"
      );
    const composite = candidateCompositeScore(heuristic, judge, input.scoreWeights);
    evaluatedPool.push({ candidate, heuristic, judge, composite, idx });
  }

  const rankedPool = [...evaluatedPool].sort((a, b) => b.composite - a.composite);
  const bestInitial = rankedPool[0];
  const candidateEvaluations = evaluatedPool.map((item, idx) => ({
    candidateIndex: idx + 1,
    heuristicScore: item.heuristic.overall,
    judgeScore: item.judge.overall,
    compositeScore: item.composite
  }));

  const initialEval = bestInitial.heuristic;
  let finalCandidate = bestInitial.candidate;
  let finalEval = bestInitial.heuristic;
  let finalJudgeEval = bestInitial.judge;
  let finalQualityScore = bestInitial.composite;
  let finalPublishabilityScore = computePublishabilityScore(
    input.task,
    bestInitial.candidate,
    bestInitial.heuristic,
    bestInitial.judge
  );
  let selectedCandidate = bestInitial.idx + 1;
  let refinementRequested = false;
  let refinementApplied = false;
  const refinePassesTarget = Math.max(1, Math.min(3, input.maxRefinePasses ?? 1));
  const qualityThreshold = clamp(input.qualityThreshold ?? TASK_QUALITY_THRESHOLD[input.task], 0, 10);
  const publishabilityThreshold = clamp(
    input.publishabilityThreshold ?? TASK_PUBLISHABILITY_THRESHOLD[input.task],
    0,
    10
  );
  let refinePassesAppliedCount = 0;

  for (let pass = 1; pass <= refinePassesTarget; pass += 1) {
    const belowThreshold = finalQualityScore < qualityThreshold;
    const belowPublishability = finalPublishabilityScore < publishabilityThreshold;
    const shouldRefine = input.forceRefine || belowThreshold || belowPublishability;
    if (!shouldRefine) {
      continue;
    }

    refinementRequested = true;
    const refinedResult = await requestTaskRefinement(
      input.task,
      asJsonRecord(finalCandidate),
      input.context,
      finalQualityScore,
      qualityThreshold,
      finalJudgeEval.weaknesses,
      pass,
      refinePassesTarget,
      input.usageRecorder
    );

    if (!refinedResult.output) {
      continue;
    }

    const refinedCandidate = input.parseRefined(refinedResult.output);
    if (!refinedCandidate) {
      console.warn(`[ai][quality] task '${input.task}' refinement returned invalid schema`);
      continue;
    }

    const refinedEval = heuristicEvaluationByTask(input.task, refinedCandidate);
    const refinedJudgeResult = await requestTaskJudge(
      input.task,
      asJsonRecord(refinedCandidate),
      input.context,
      Boolean(input.useJudgePanel),
      input.usageRecorder
    );
    const refinedJudge =
      refinedJudgeResult.evaluation ??
      fallbackJudgeEvaluation(
        input.task,
        refinedCandidate,
        refinedEval,
        refinedJudgeResult.unavailableReason ?? "judge_request_failed_or_invalid"
      );

    const currentComposite = candidateCompositeScore(
      finalEval,
      finalJudgeEval,
      input.scoreWeights
    );
    const refinedComposite = candidateCompositeScore(
      refinedEval,
      refinedJudge,
      input.scoreWeights
    );
    const refinedPublishabilityScore = computePublishabilityScore(
      input.task,
      refinedCandidate,
      refinedEval,
      refinedJudge
    );

    if (refinedComposite + 0.05 >= currentComposite) {
      finalCandidate = refinedCandidate;
      finalEval = refinedEval;
      finalJudgeEval = refinedJudge;
      finalQualityScore = refinedComposite;
      finalPublishabilityScore = refinedPublishabilityScore;
      refinementApplied = true;
      refinePassesAppliedCount += 1;
    }
  }

  const guard = applyInflationGuard(finalEval, finalJudgeEval, finalQualityScore);

  return {
    candidate: finalCandidate,
    initialEval,
    finalEval,
    judgeEval: finalJudgeEval,
    qualityScore: guard.displayScore,
    publishabilityScore: finalPublishabilityScore,
    refinementRequested,
    refinementApplied,
    candidateCount: pool.length,
    selectedCandidate,
    refinePassesTarget,
    refinePassesAppliedCount,
    candidateEvaluations,
    inflationGuardApplied: guard.applied,
    inflationGuardReason: guard.reason,
    displayScore: guard.displayScore
  };
}

function sanitizeAnalysisPayload(payload: AnalysisPayload): AnalysisPayload {
  const structureFallback = {
    problem: "Problema central sem clareza suficiente.",
    tension: "Tensao argumentativa fraca.",
    insight: payload.thesis,
    application: payload.recommendations[0] ?? "Definir proximo passo pratico."
  };
  const structure = normalizeAnalysisStructure(payload.structure, structureFallback);
  const retentionMoments = normalizeRetentionMoments(payload.retentionMoments);
  const editorialAngles = normalizeEditorialAngles(payload.editorialAngles);
  const weakSpots = normalizeWeakSpots(payload.weakSpots);
  const qualityScores = normalizeAnalysisQualityScores(payload.qualityScores, payload.polarityScore);

  return {
    thesis: normalizeText(payload.thesis, 1600, 20, "Tese principal do conteudo."),
    topics: sanitizeTopicList(payload.topics, ["estrategia", "conteudo", "distribuicao"]),
    contentType: payload.contentType,
    polarityScore: Math.round(clamp(payload.polarityScore, 0, 10)),
    recommendations: sanitizeRecommendations(payload.recommendations, [
      "Defina uma promessa clara para os primeiros segundos de cada formato.",
      "Converta a tese em exemplos concretos para elevar clareza e conversao."
    ]),
    structure,
    retentionMoments,
    editorialAngles,
    weakSpots,
    qualityScores:
      qualityScores ??
      {
        insightDensity: roundScore(7),
        standaloneClarity: roundScore(7),
        polarity: roundScore(payload.polarityScore),
        practicalValue: roundScore(7)
      }
  };
}

function sanitizeReelsPayload(payload: ReelsPayload): ReelsPayload {
  return {
    clips: payload.clips.map((clip) => ({
      ...clip,
      title: normalizeText(clip.title, 220, 6),
      caption: normalizeText(clip.caption, 5000, 40),
      hashtags: sanitizeHashtags(clip.hashtags, []),
      whyItWorks: normalizeText(
        clip.whyItWorks,
        2400,
        90,
        "A abertura cria tensao clara, conecta dor real e leva para aplicacao pratica com CTA especifico."
      )
    }))
  };
}

function anchorReelsPayloadToWindows(
  payload: ReelsPayload,
  windows: ClipWindow[],
  fallback: ReelsPayload,
  analysis: AnalysisPayload,
  ctaSource: string | string[]
): ReelsPayload {
  if (windows.length === 0) {
    return sanitizeReelsPayload(payload);
  }

  const ctaByClip =
    typeof ctaSource === "string"
      ? windows.map(() => ctaSource)
      : windows.map((_, idx) => ctaSource[idx % Math.max(1, ctaSource.length)] ?? "");

  const clips = payload.clips
    .slice(0, windows.length)
    .map((clip, index) => {
      const window = windows[index];
      const cta = ctaByClip[index] ?? "";
      const fallbackClip = fallback.clips[index] ?? fallback.clips[0];
      const grounded = applyReelsSourceGrounding(
        {
          title: clip.title,
          caption: clip.caption,
          whyItWorks: clip.whyItWorks
        },
        window.text,
        fallbackClip
          ? {
              title: fallbackClip.title,
              caption: fallbackClip.caption,
              whyItWorks: fallbackClip.whyItWorks
            }
          : null,
        cta
      );

      return {
        title: grounded.title,
        start: msToSrtTimestamp(window.startMs),
        end: msToSrtTimestamp(window.endMs),
        caption: grounded.caption,
        hashtags: sanitizeHashtags(
          clip.hashtags,
          fallbackClip?.hashtags ?? hashtagsByStrategy("balanced")
        ),
        scores: {
          hook: Math.round(clamp(clip.scores.hook, 0, 10)),
          clarity: Math.round(clamp(clip.scores.clarity, 0, 10)),
          retention: Math.round(clamp(clip.scores.retention, 0, 10)),
          share: Math.round(clamp(clip.scores.share, 0, 10))
        },
        whyItWorks: grounded.whyItWorks
      };
    });

  if (clips.length === 0) {
    return sanitizeReelsPayload(fallback);
  }

  return sanitizeReelsPayload({
    clips: clips.map((clip, index) => {
      const fallbackClip = fallback.clips[index] ?? fallback.clips[0];
      if (!fallbackClip) {
        return clip;
      }
      return {
        ...clip,
        hashtags: sanitizeHashtags(clip.hashtags, fallbackClip.hashtags)
      };
    })
  });
}

function sanitizeNewsletterPayload(payload: NewsletterPayload): NewsletterPayload {
  const insightSeen: string[] = [];
  return {
    headline: normalizeText(payload.headline, 300, 8, "Newsletter estrategica"),
    subheadline: normalizeText(payload.subheadline, 2400, 8, "Resumo pratico da tese principal."),
    sections: payload.sections
      .map((section) => {
        if (section.type === "intro") {
          return { type: "intro", text: normalizeText(section.text, 5000, 10) };
        }

        if (section.type === "insight") {
          const text = normalizeText(section.text, 5000, 10);
          const duplicated = insightSeen.some((existing) => lexicalOverlapRatio(existing, text) >= 0.88);
          if (duplicated) {
            return null;
          }
          insightSeen.push(text);
          return {
            type: "insight",
            title: normalizeText(section.title, 300, 3),
            text
          };
        }

        if (section.type === "application") {
          const bullets: string[] = [];
          for (const raw of section.bullets) {
            const normalized = normalizeText(raw, 2400, 3);
            if (!normalized) {
              continue;
            }
            const duplicated = bullets.some((existing) => lexicalOverlapRatio(existing, normalized) >= 0.9);
            if (!duplicated) {
              bullets.push(normalized);
            }
            if (bullets.length >= 16) {
              break;
            }
          }
          return {
            type: "application",
            bullets
          };
        }

        return { type: "cta", text: normalizeText(section.text, 2400, 10) };
      })
      .filter(
        (
          section
        ): section is NewsletterPayload["sections"][number] =>
          Boolean(section)
      )
  };
}

function sanitizeLinkedinPayload(payload: LinkedinPayload): LinkedinPayload {
  const cleanedBody: string[] = [];
  for (const paragraph of payload.body) {
    const normalized = normalizeText(paragraph, 3200, 8);
    if (!normalized) {
      continue;
    }
    const duplicated = cleanedBody.some((existing) => lexicalOverlapRatio(existing, normalized) >= 0.9);
    if (!duplicated) {
      cleanedBody.push(normalized);
    }
    if (cleanedBody.length >= 20) {
      break;
    }
  }

  const hasProof = cleanedBody.some((paragraph) =>
    /(\d|r\$|%|exemplo|caso|dados|metrica|resultado)/i.test(paragraph)
  );
  if (!hasProof) {
    cleanedBody.push(
      normalizeText(
        "Prova: inclua ao menos uma metrica ou caso concreto para validar a tese.",
        3200,
        20
      )
    );
  }

  const hasFramework = cleanedBody.some((paragraph) =>
    /(framework|passo|etapa|checklist|1\)|2\)|3\)|primeiro|segundo|terceiro)/i.test(paragraph)
  );
  if (!hasFramework) {
    cleanedBody.push(
      normalizeText(
        "Framework: primeiro diagnostique, depois ajuste o canal, e por fim meca a resposta por metrica.",
        3200,
        20
      )
    );
  }

  let ctaQuestion = toQuestionSentence(payload.ctaQuestion);
  if (!hasCtaIntent(ctaQuestion, "comment")) {
    ctaQuestion = toQuestionSentence(
      `${ctaQuestion} Qual metrica concreta voce vai acompanhar na proxima semana`
    );
  }

  if (!/(qual|quanto|quando|que metrica|que resultado)/i.test(ctaQuestion)) {
    ctaQuestion = "Qual metrica concreta voce vai acompanhar na proxima semana para validar essa tese?";
  }

  return {
    hook: normalizeText(payload.hook, 2200, 8),
    body: cleanedBody.slice(0, 20),
    ctaQuestion: toQuestionSentence(normalizeText(ctaQuestion, 2000, 8))
  };
}

function sanitizeXPayload(
  payload: XPostsPayload,
  ctaMode: GenerationCtaMode = "comment",
  length: GenerationLength = "standard"
): XPostsPayload {
  const minChars = minByLength(length, 45, 65, 85);
  const standaloneTail =
    ctaMode === "share"
      ? "Compartilhe com um parceiro e acompanhe a resposta em 7 dias."
      : ctaMode === "dm"
        ? "Me chama no direct com a palavra mapa para receber o roteiro completo."
        : ctaMode === "lead"
          ? "Comente mapa para receber o material completo e aplicar hoje."
          : "Comente sua principal trava e a metrica que vai acompanhar nesta semana.";
  const threadTail = "Proximo passo: aplique isso hoje e compare o resultado em 7 dias.";

  const standalone = dedupeXPosts(payload.standalone)
    .map((item) => enrichXPostForPublish(item, minChars, standaloneTail))
    .slice(0, 12);
  const thread = normalizeThreadNumbering(
    dedupeXPosts(payload.thread)
      .map((item) => enrichXPostForPublish(item, minChars, threadTail))
      .slice(0, 16)
  );
  const minStandalone = ctaMode === "none" ? 1 : 2;
  for (let idx = 0; idx < thread.length && standalone.length < minStandalone; idx += 1) {
    const candidate = thread[idx];
    if (!candidate) {
      continue;
    }
    const duplicate = standalone.some((item) => lexicalOverlapRatio(item, candidate) >= 0.9);
    if (!duplicate) {
      standalone.push(candidate);
    }
  }

  if (standalone.length === 0 && thread.length === 0) {
    standalone.push(
      fitXPostLength(
        "Venda sem sistema gera volume sem margem. Produto sem canal gera custo sem receita.",
        "Venda sem sistema gera volume sem margem."
      )
    );
  }

  const ctaPool = [...standalone, ...thread];
  if (!ctaPool.some((post) => hasCtaIntent(post, ctaMode)) && standalone.length > 0) {
    const ctaByModeText: Record<GenerationCtaMode, string> = {
      none: "",
      comment: "Comente sua principal trava e a metrica que vai acompanhar esta semana.",
      share: "Compartilhe com quem precisa aplicar isso hoje.",
      dm: "Me chama no direct com a palavra mapa.",
      lead: "Comente mapa que eu envio o material."
    };
    const cta = ctaByModeText[ctaMode];
    if (cta) {
      standalone[standalone.length - 1] = fitXPostLength(
        `${standalone[standalone.length - 1]} ${cta}`.trim(),
        cta
      );
      if (!hasCtaIntent(standalone[standalone.length - 1], ctaMode) && thread.length > 0) {
        thread[thread.length - 1] = fitXPostLength(
          `${thread[thread.length - 1]} ${cta}`.trim(),
          cta
        );
      }
    }
  }

  return {
    standalone,
    thread,
    notes: {
      style: normalizeText(payload.notes.style, 300, 3)
    }
  };
}

export async function generateNarrativeAnalysis(
  segments: TranscriptSegment[],
  generationProfile?: GenerationProfile,
  srtAssetId?: string,
  diagnosticsRecorder?: GenerationDiagnosticsRecorder
): Promise<AnalysisPayload> {
  const forceRefine = false;
  const profile = generationProfile ?? defaultGenerationProfile();
  const usageMetrics = createTaskUsageMetrics();
  const usageRecorder = (usage: TaskRequestUsage) => {
    accumulateTaskUsage(usageMetrics, usage);
  };
  const evidenceMap = buildEvidenceMap(
    segments,
    profile.quality.mode === "max" ? 96 : 72
  );
  const qualityPlan = qualityPlanByProfile(profile, "analysis");
  const taskScoreWeights = normalizeTaskScoreWeights(profile.tasks.analysis.scoreWeights);
  const qualityThreshold = qualityThresholdByProfile("analysis", profile);
  const publishabilityThreshold = publishabilityThresholdByProfile("analysis", profile);
  const refinePassesTarget =
    profile.quality.mode === "max"
      ? Math.max(3, qualityPlan.refinePasses)
      : qualityPlan.refinePasses;
  const promptMeta = getActivePromptTemplate("analysis");
  const fallback = buildNarrativeAnalysis(segments, profile);
  const transcriptContext = analysisTranscriptExcerpt(segments, profile);
  const qualityContext = [
    `transcript_excerpt:\n${transcriptExcerpt(segments, 90)}`,
    `evidence_map:\n${evidenceMapPromptBlock(evidenceMap, 26)}`,
    `profile:\n${JSON.stringify(promptConfigVariables(profile, "analysis"), null, 2)}`
  ].join("\n\n");
  const prompt = renderPromptForTask("analysis", {
    transcript_excerpt: transcriptContext,
    evidence_map_json: JSON.stringify({
      numbers: [...evidenceMap.numbers],
      lines: evidenceMap.lines
    }),
    evidence_map_excerpt: evidenceMapPromptBlock(evidenceMap, 20),
    ...promptConfigVariables(profile, "analysis")
  });

  const requests = await requestTaskVariants(
    "analysis",
    prompt.systemPrompt,
    withPromptControls(prompt.userPrompt, profile, "analysis", evidenceMap),
    qualityPlan.variationCount,
    usageRecorder
  );
  const trace = summarizeVariantTrace(requests);
  const variantDiagnostics = buildInitialVariantDiagnostics(requests);

  const candidates: AnalysisPayload[] = [];
  const acceptedVariantNumbers: number[] = [];
  const candidateFingerprints = new Set<string>();
  requests.forEach((request, index) => {
    if (!request.output) {
      return;
    }

    const taskOutput = unwrapTaskOutput("analysis", request.output);
    const parsed = ANALYSIS_SCHEMA.safeParse(taskOutput);
    if (parsed.success) {
      const normalized = sanitizeAnalysisPayload({
        ...parsed.data,
        polarityScore: Math.round(parsed.data.polarityScore)
      });
      const validation = validatePayloadForTask(
        "analysis",
        normalized,
        evidenceMap,
        segments,
        profile.tasks.analysis
      );
      variantDiagnostics[index].normalization = "analysis_schema";
      variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
        "analysis",
        normalized,
        evidenceMap,
        segments,
        validation,
        profile.tasks.analysis
      );
      const blockingIssues = blockingValidationIssues(validation);
      if (blockingIssues.length > 0) {
        variantDiagnostics[index].status = "schema_failed";
        variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
        return;
      }
      if (!validation.ok) {
        variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
      }
      const fingerprint = candidateFingerprint(normalized);
      if (candidateFingerprints.has(fingerprint)) {
        variantDiagnostics[index].status = "schema_failed";
        variantDiagnostics[index].reason = "duplicate_candidate";
        return;
      }

      candidateFingerprints.add(fingerprint);
      candidates.push(normalized);
      acceptedVariantNumbers.push(index + 1);
      return;
    }

    const coerced = coerceAnalysisOutput(taskOutput, fallback);
    const signal = analysisCoercionSignal(taskOutput, coerced, fallback);
    if (signal < COERCE_ACCEPTANCE_THRESHOLD.analysis) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `schema_mismatch · ${zodIssueSummary(parsed.error)} · coerce_low_signal(${signal})`;
      return;
    }

    const normalized = sanitizeAnalysisPayload(coerced);
    const validation = validatePayloadForTask(
      "analysis",
      normalized,
      evidenceMap,
      segments,
      profile.tasks.analysis
    );
    variantDiagnostics[index].normalization = "analysis_coerced_schema";
    variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
      "analysis",
      normalized,
      evidenceMap,
      segments,
      validation,
      profile.tasks.analysis
    );
    const blockingIssues = blockingValidationIssues(validation);
    if (blockingIssues.length > 0) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
      return;
    }
    if (!validation.ok) {
      variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
    }
    const fingerprint = candidateFingerprint(normalized);
    if (candidateFingerprints.has(fingerprint)) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = "duplicate_candidate";
      return;
    }

    candidateFingerprints.add(fingerprint);
    candidates.push(normalized);
    acceptedVariantNumbers.push(index + 1);
    variantDiagnostics[index].reason = `coerced_schema(signal=${signal})`;
  });

  const candidate = candidates[0] ?? sanitizeAnalysisPayload(fallback);
  const additionalCandidates = candidates.slice(1);
  const quality =
    candidates.length === 0
      ? await buildFallbackQualityResultWithJudge({
          task: "analysis",
          candidate,
          context: qualityContext,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder
        })
      : await refineIfLowQuality({
          task: "analysis",
          candidate,
          additionalCandidates,
          context: qualityContext,
          forceRefine,
          maxRefinePasses: refinePassesTarget,
          qualityThreshold,
          publishabilityThreshold,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder,
          parseRefined: (value) => {
            const refinedOutput = unwrapTaskOutput("analysis", value);
            const parsedRefined = ANALYSIS_SCHEMA.safeParse(refinedOutput);
            if (parsedRefined.success) {
              const normalized = sanitizeAnalysisPayload({
                ...parsedRefined.data,
                polarityScore: Math.round(parsedRefined.data.polarityScore)
              });
              const validation = validatePayloadForTask(
                "analysis",
                normalized,
                evidenceMap,
                segments,
                profile.tasks.analysis
              );
              return blockingValidationIssues(validation).length === 0 ? normalized : null;
            }

            const coerced = coerceAnalysisOutput(refinedOutput, candidate);
            if (
              analysisCoercionSignal(refinedOutput, coerced, candidate) <
              COERCE_ACCEPTANCE_THRESHOLD.analysis
            ) {
              return null;
            }
            const normalized = sanitizeAnalysisPayload(coerced);
            const validation = validatePayloadForTask(
              "analysis",
              normalized,
              evidenceMap,
              segments,
              profile.tasks.analysis
            );
            return blockingValidationIssues(validation).length === 0 ? normalized : null;
          }
        });
  quality.candidateEvaluations.forEach((item) => {
    const variantNumber = acceptedVariantNumbers[item.candidateIndex - 1];
    if (!variantNumber) {
      return;
    }

    const variant = variantDiagnostics.find((entry) => entry.variant === variantNumber);
    if (!variant) {
      return;
    }

    variant.heuristicScore = Number(item.heuristicScore.toFixed(2));
    variant.judgeScore = Number(item.judgeScore.toFixed(2));
    variant.selected = item.candidateIndex === quality.selectedCandidate;
  });
  const selectedVariant = acceptedVariantNumbers[quality.selectedCandidate - 1] ?? 0;

  if (srtAssetId) {
    const usage = usageToDiagnosticsFields(usageMetrics);
    emitTaskDiagnostics(diagnosticsRecorder, {
      srtAssetId,
      task: "analysis",
      provider: trace.provider,
      model: trace.model,
      promptName: promptMeta.name,
      usedHeuristicFallback: trace.usedHeuristicFallback,
      fallbackReason: trace.fallbackReason,
      qualityInitial: Number(quality.initialEval.overall.toFixed(2)),
      qualityFinal: Number(quality.displayScore.toFixed(2)),
      qualityScore: Number(quality.qualityScore.toFixed(2)),
      qualityThreshold,
      publishabilityScore: Number(quality.publishabilityScore.toFixed(2)),
      publishabilityThreshold,
      meetsQualityThreshold: meetsThreshold(quality.qualityScore, qualityThreshold),
      meetsPublishabilityThreshold: meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      readyForPublish:
        meetsThreshold(quality.qualityScore, qualityThreshold) &&
        meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      qualitySubscoresInitial: quality.initialEval.subscores,
      qualitySubscoresFinal: quality.finalEval.subscores,
      judgeQualityScore: quality.judgeEval.overall,
      judgeSubscores: quality.judgeEval.subscores,
      judgeSummary: quality.judgeEval.summary,
      requestedVariants: requests.length,
      successfulVariants: acceptedVariantNumbers.length,
      selectedVariant,
      variants: variantDiagnostics,
      refinementRequested: quality.refinementRequested,
      refinementApplied: quality.refinementApplied,
      candidateCount: quality.candidateCount,
      selectedCandidate: quality.selectedCandidate,
      refinePassesTarget: quality.refinePassesTarget,
      refinePassesAppliedCount: quality.refinePassesAppliedCount,
      inflationGuardApplied: quality.inflationGuardApplied,
      inflationGuardReason: quality.inflationGuardReason,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
  }

  const finalValidation = validatePayloadForTask(
    "analysis",
    quality.candidate,
    evidenceMap,
    segments,
    profile.tasks.analysis
  );
  return blockingValidationIssues(finalValidation).length === 0
    ? quality.candidate
    : sanitizeAnalysisPayload(fallback);
}

export async function generateReels(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  durationSec: number,
  generationProfile?: GenerationProfile,
  srtAssetId?: string,
  diagnosticsRecorder?: GenerationDiagnosticsRecorder
): Promise<ReelsPayload> {
  const forceRefine = false;
  const profile = generationProfile ?? defaultGenerationProfile();
  const usageMetrics = createTaskUsageMetrics();
  const usageRecorder = (usage: TaskRequestUsage) => {
    accumulateTaskUsage(usageMetrics, usage);
  };
  const evidenceMap = buildEvidenceMap(segments, profile.quality.mode === "max" ? 96 : 72);
  const qualityPlan = qualityPlanByProfile(profile, "reels");
  const qualityThreshold = qualityThresholdByProfile("reels", profile);
  const publishabilityThreshold = publishabilityThresholdByProfile("reels", profile);
  const taskScoreWeights = normalizeTaskScoreWeights(profile.tasks.reels.scoreWeights);
  const clipCount = resolveReelsClipCount(durationSec, profile.tasks.reels.length);
  const durationPolicy = resolveReelsDurationPolicy(
    durationSec,
    profile.tasks.reels.length,
    profile.tasks.reels.targetOutcome
  );
  const selectedWindows = await selectClipWindowsByAi(
    segments,
    analysis,
    profile,
    clipCount,
    durationSec,
    usageRecorder
  );
  const selectedWindowsPremium = (() => {
    const strict = selectedWindows.filter(
      (window) =>
        !isWeakIntroWindow(window, durationSec) &&
        !isWeakOutroWindow(window, durationSec) &&
        !isEarlyWindowWithoutEliteHook(window, durationSec) &&
        hasStrongOpeningHook(window)
    );
    if (strict.length >= Math.min(2, selectedWindows.length)) {
      return strict.slice(0, clipCount);
    }
    return selectedWindows.slice(0, clipCount);
  })();
  const promptMeta = getActivePromptTemplate("reels");
  const fallback = buildReels(segments, analysis, durationSec, profile, selectedWindowsPremium);
  const reelsCtaOptions = ctaVariantsByMode(
    profile.tasks.reels.ctaMode,
    profile.goal,
    profile.tasks.reels.targetOutcome
  );

  const clipsContext = selectedWindowsPremium
    .map(
      (window, idx) =>
        `idx=${idx + 1}; startIdx=${segments[window.startIdx]?.idx}; endIdx=${segments[window.endIdx]?.idx}; start=${msToSrtTimestamp(window.startMs)}; end=${msToSrtTimestamp(window.endMs)}; source_text=${truncate(window.text, 280)}`
    )
    .join("\n");

  const prompt = renderPromptForTask("reels", {
    transcript_excerpt: transcriptExcerpt(segments, 180),
    analysis_json: JSON.stringify(analysis),
    duration_sec: String(durationSec),
    clips_context: clipsContext,
    evidence_map_json: JSON.stringify({
      numbers: [...evidenceMap.numbers],
      lines: evidenceMap.lines
    }),
    evidence_map_excerpt: evidenceMapPromptBlock(evidenceMap, 20),
    ...promptConfigVariables(profile, "reels")
  });
  const context = [
    `analysis_json:\n${JSON.stringify(analysis, null, 2)}`,
    `clips_context:\n${clipsContext}`,
    `evidence_map:\n${evidenceMapPromptBlock(evidenceMap, 24)}`,
    `transcript_excerpt:\n${transcriptExcerpt(segments, 180)}`,
    `profile:\n${JSON.stringify(promptConfigVariables(profile, "reels"), null, 2)}`
  ].join("\n\n");

  const requests = await requestTaskVariants(
    "reels",
    prompt.systemPrompt,
    withPromptControls(prompt.userPrompt, profile, "reels", evidenceMap),
    qualityPlan.variationCount,
    usageRecorder
  );
  const trace = summarizeVariantTrace(requests);
  const variantDiagnostics = buildInitialVariantDiagnostics(requests);
  const candidates: ReelsPayload[] = [];
  const acceptedVariantNumbers: number[] = [];
  const candidateFingerprints = new Set<string>();
  const registerCandidate = (
    index: number,
    normalization: string,
    payload: ReelsPayload,
    reason?: string
  ): boolean => {
    const validation = validatePayloadForTask(
      "reels",
      payload,
      evidenceMap,
      segments,
      profile.tasks.reels
    );
    variantDiagnostics[index].normalization = normalization;
    variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
      "reels",
      payload,
      evidenceMap,
      segments,
      validation,
      profile.tasks.reels
    );
    const blockingIssues = blockingValidationIssues(validation);
    if (blockingIssues.length > 0) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
      return false;
    }
    if (!validation.ok) {
      variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
    }

    const fingerprint = candidateFingerprint(payload);
    if (candidateFingerprints.has(fingerprint)) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = "duplicate_candidate";
      return false;
    }

    candidateFingerprints.add(fingerprint);
    candidates.push(payload);
    acceptedVariantNumbers.push(index + 1);
    if (reason) {
      variantDiagnostics[index].reason = variantDiagnostics[index].reason
        ? `${variantDiagnostics[index].reason} · ${reason}`
        : reason;
    }
    return true;
  };

  requests.forEach((request, index) => {
    if (!request.output) {
      return;
    }

    const taskOutput = unwrapTaskOutput("reels", request.output);
    const parsedDirectFinal = REELS_FINAL_SCHEMA.safeParse(taskOutput);
    if (parsedDirectFinal.success) {
        const normalized = anchorReelsPayloadToWindows(
          sanitizeReelsPayload({
          clips: parsedDirectFinal.data.clips.map((clip) => ({
            ...clip,
            scores: {
              hook: Math.round(clamp(clip.scores.hook, 0, 10)),
              clarity: Math.round(clamp(clip.scores.clarity, 0, 10)),
              retention: Math.round(clamp(clip.scores.retention, 0, 10)),
              share: Math.round(clamp(clip.scores.share, 0, 10))
            }
          }))
          }),
          selectedWindowsPremium,
          fallback,
          analysis,
          reelsCtaOptions
        );
      registerCandidate(index, "reels_final_schema", normalized);
      return;
    }

    const parsedAiFull = REELS_AI_SCHEMA.safeParse(taskOutput);
    if (parsedAiFull.success) {
      const aiClips = parsedAiFull.data.clips
        .map((clip, idx) => {
          const window = buildClipWindowFromRange(
            segments,
            clip.startIdx,
            clip.endIdx,
            durationPolicy
          );
          if (!window) {
            return null;
          }

          const fallbackClip = fallback.clips[idx];
          const topicTags = analysis.topics
            .slice(0, 4)
            .map((topic) => `#${cleanToken(topic)}`)
            .filter((tag) => tag.length >= 4);
          const hashtags = sanitizeHashtags(
            clip.hashtags,
            fallbackClip?.hashtags ??
              hashtagsByStrategy(profile.tasks.reels.strategy).concat(topicTags)
          );
          const scores =
            clip.scores ??
            computeReelsScores(window, durationSec, analysis, profile.tasks.reels.strategy);

          return {
            title: normalizeText(clip.title, 220, 6, fallbackClip?.title ?? analysis.thesis),
            start: msToSrtTimestamp(window.startMs),
            end: msToSrtTimestamp(window.endMs),
            caption: normalizeText(
              clip.caption,
              5000,
              80,
              fallbackClip?.caption ?? normalizeText(window.text, 5000, 24, analysis.thesis)
            ),
            hashtags,
            scores: {
              hook: Math.round(clamp(scores.hook, 0, 10)),
              clarity: Math.round(clamp(scores.clarity, 0, 10)),
              retention: Math.round(clamp(scores.retention, 0, 10)),
              share: Math.round(clamp(scores.share, 0, 10))
            },
            whyItWorks: normalizeText(clip.whyItWorks, 2400, 10, fallbackClip?.whyItWorks ?? "")
          };
        })
        .filter((clip): clip is ReelsPayload["clips"][number] => clip !== null)
        .slice(0, clipCount);

      if (aiClips.length > 0) {
        const normalized = anchorReelsPayloadToWindows(
          sanitizeReelsPayload({ clips: aiClips }),
          selectedWindowsPremium,
          fallback,
          analysis,
          reelsCtaOptions
        );
        registerCandidate(index, "reels_ai_schema", normalized);
      } else {
        variantDiagnostics[index].status = "schema_failed";
        variantDiagnostics[index].reason = "empty_ai_clips";
      }
      return;
    }

    const parsedOverlay = REELS_OVERLAY_SCHEMA.safeParse(taskOutput);
    if (parsedOverlay.success) {
      const overlayByIdx = new Map(parsedOverlay.data.clips.map((clip) => [clip.idx, clip]));
      const normalized = sanitizeReelsPayload({
        clips: fallback.clips.map((clip, idx) => {
          const overlay = overlayByIdx.get(idx + 1);
          if (!overlay) {
            return clip;
          }

          const hashtags = sanitizeHashtags(overlay.hashtags, clip.hashtags);
          return {
            ...clip,
            title: normalizeText(overlay.title, 220, 6, clip.title),
            caption: normalizeText(overlay.caption, 5000, 80, clip.caption),
            hashtags,
            whyItWorks: normalizeText(overlay.whyItWorks, 2400, 10, clip.whyItWorks)
          };
        })
      });
      const normalizedAnchored = anchorReelsPayloadToWindows(
        normalized,
        selectedWindowsPremium,
        fallback,
        analysis,
        reelsCtaOptions
      );
      registerCandidate(index, "reels_overlay_schema", normalizedAnchored);
      return;
    }

    const coerced = coerceReelsOutput(
      taskOutput,
      fallback,
      segments,
      durationPolicy,
      analysis,
      profile,
      durationSec,
      clipCount
    );
    if (coerced.confidence >= COERCE_ACCEPTANCE_THRESHOLD.reels) {
      const anchored = anchorReelsPayloadToWindows(
        coerced.payload,
        selectedWindowsPremium,
        fallback,
        analysis,
        reelsCtaOptions
      );
      registerCandidate(
        index,
        "reels_coerced_schema",
        anchored,
        `coerced_schema(signal=${coerced.confidence})`
      );
      return;
    }

    const mismatchSummary = [
      `final: ${zodIssueSummary(parsedDirectFinal.error, 1)}`,
      `ai: ${zodIssueSummary(parsedAiFull.error, 1)}`
    ].join(" | ");
    variantDiagnostics[index].status = "schema_failed";
    variantDiagnostics[index].reason = `schema_mismatch · ${mismatchSummary}`;
  });

  let candidate = candidates[0] ?? sanitizeReelsPayload(fallback);
  if (candidate.clips.length === 0) {
    candidate = sanitizeReelsPayload(fallback);
  }
  const additionalCandidates = candidates.slice(1);
  const quality =
    candidates.length === 0
      ? await buildFallbackQualityResultWithJudge({
          task: "reels",
          candidate,
          context,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder
        })
      : await refineIfLowQuality({
          task: "reels",
          candidate,
          additionalCandidates,
          context,
          forceRefine,
          maxRefinePasses: qualityPlan.refinePasses,
          qualityThreshold,
          publishabilityThreshold,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder,
          parseRefined: (value) => {
            const refinedOutput = unwrapTaskOutput("reels", value);
            const parsedRefined = REELS_FINAL_SCHEMA.safeParse(refinedOutput);
            if (parsedRefined.success) {
              const normalized = anchorReelsPayloadToWindows(
                sanitizeReelsPayload({
                  clips: parsedRefined.data.clips.map((clip) => ({
                    ...clip,
                    scores: {
                      hook: Math.round(clamp(clip.scores.hook, 0, 10)),
                      clarity: Math.round(clamp(clip.scores.clarity, 0, 10)),
                      retention: Math.round(clamp(clip.scores.retention, 0, 10)),
                      share: Math.round(clamp(clip.scores.share, 0, 10))
                    }
                  }))
                }),
                selectedWindowsPremium,
                fallback,
                analysis,
                reelsCtaOptions
              );
              const validation = validatePayloadForTask(
                "reels",
                normalized,
                evidenceMap,
                segments,
                profile.tasks.reels
              );
              return blockingValidationIssues(validation).length === 0 ? normalized : null;
            }

            const coerced = coerceReelsOutput(
              refinedOutput,
              candidate,
              segments,
              durationPolicy,
              analysis,
              profile,
              durationSec,
              clipCount
            );
            if (coerced.confidence < COERCE_ACCEPTANCE_THRESHOLD.reels) {
              return null;
            }
            const normalized = anchorReelsPayloadToWindows(
              sanitizeReelsPayload(coerced.payload),
              selectedWindowsPremium,
              fallback,
              analysis,
              reelsCtaOptions
            );
            const validation = validatePayloadForTask(
              "reels",
              normalized,
              evidenceMap,
              segments,
              profile.tasks.reels
            );
            return blockingValidationIssues(validation).length === 0 ? normalized : null;
          }
        });
  quality.candidateEvaluations.forEach((item) => {
    const variantNumber = acceptedVariantNumbers[item.candidateIndex - 1];
    if (!variantNumber) {
      return;
    }

    const variant = variantDiagnostics.find((entry) => entry.variant === variantNumber);
    if (!variant) {
      return;
    }

    variant.heuristicScore = Number(item.heuristicScore.toFixed(2));
    variant.judgeScore = Number(item.judgeScore.toFixed(2));
    variant.selected = item.candidateIndex === quality.selectedCandidate;
  });
  const selectedVariant = acceptedVariantNumbers[quality.selectedCandidate - 1] ?? 0;

  if (srtAssetId) {
    const usage = usageToDiagnosticsFields(usageMetrics);
    emitTaskDiagnostics(diagnosticsRecorder, {
      srtAssetId,
      task: "reels",
      provider: trace.provider,
      model: trace.model,
      promptName: promptMeta.name,
      usedHeuristicFallback: trace.usedHeuristicFallback,
      fallbackReason: trace.fallbackReason,
      qualityInitial: Number(quality.initialEval.overall.toFixed(2)),
      qualityFinal: Number(quality.displayScore.toFixed(2)),
      qualityScore: Number(quality.qualityScore.toFixed(2)),
      qualityThreshold,
      publishabilityScore: Number(quality.publishabilityScore.toFixed(2)),
      publishabilityThreshold,
      meetsQualityThreshold: meetsThreshold(quality.qualityScore, qualityThreshold),
      meetsPublishabilityThreshold: meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      readyForPublish:
        meetsThreshold(quality.qualityScore, qualityThreshold) &&
        meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      qualitySubscoresInitial: quality.initialEval.subscores,
      qualitySubscoresFinal: quality.finalEval.subscores,
      judgeQualityScore: quality.judgeEval.overall,
      judgeSubscores: quality.judgeEval.subscores,
      judgeSummary: quality.judgeEval.summary,
      requestedVariants: requests.length,
      successfulVariants: acceptedVariantNumbers.length,
      selectedVariant,
      variants: variantDiagnostics,
      refinementRequested: quality.refinementRequested,
      refinementApplied: quality.refinementApplied,
      candidateCount: quality.candidateCount,
      selectedCandidate: quality.selectedCandidate,
      refinePassesTarget: quality.refinePassesTarget,
      refinePassesAppliedCount: quality.refinePassesAppliedCount,
      inflationGuardApplied: quality.inflationGuardApplied,
      inflationGuardReason: quality.inflationGuardReason,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
  }

  const finalCandidate = anchorReelsPayloadToWindows(
    quality.candidate,
    selectedWindowsPremium,
    fallback,
    analysis,
    reelsCtaOptions
  );
  const finalValidation = validatePayloadForTask(
    "reels",
    finalCandidate,
    evidenceMap,
    segments,
    profile.tasks.reels
  );
  return blockingValidationIssues(finalValidation).length === 0
    ? finalCandidate
    : sanitizeReelsPayload(fallback);
}

export async function generateNewsletter(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile,
  srtAssetId?: string,
  diagnosticsRecorder?: GenerationDiagnosticsRecorder
): Promise<NewsletterPayload> {
  const forceRefine = false;
  const profile = generationProfile ?? defaultGenerationProfile();
  const usageMetrics = createTaskUsageMetrics();
  const usageRecorder = (usage: TaskRequestUsage) => {
    accumulateTaskUsage(usageMetrics, usage);
  };
  const evidenceMap = buildEvidenceMap(segments, profile.quality.mode === "max" ? 96 : 72);
  const qualityPlan = qualityPlanByProfile(profile, "newsletter");
  const qualityThreshold = qualityThresholdByProfile("newsletter", profile);
  const publishabilityThreshold = publishabilityThresholdByProfile("newsletter", profile);
  const taskScoreWeights = normalizeTaskScoreWeights(profile.tasks.newsletter.scoreWeights);
  const promptMeta = getActivePromptTemplate("newsletter");
  const fallback = buildNewsletter(segments, analysis, profile);
  const context = [
    `analysis_json:\n${JSON.stringify(analysis, null, 2)}`,
    `evidence_map:\n${evidenceMapPromptBlock(evidenceMap, 24)}`,
    `transcript_excerpt:\n${transcriptExcerpt(segments, 120)}`,
    `profile:\n${JSON.stringify(promptConfigVariables(profile, "newsletter"), null, 2)}`
  ].join("\n\n");
  const prompt = renderPromptForTask("newsletter", {
    transcript_excerpt: transcriptExcerpt(segments, 120),
    analysis_json: JSON.stringify(analysis),
    evidence_map_json: JSON.stringify({
      numbers: [...evidenceMap.numbers],
      lines: evidenceMap.lines
    }),
    evidence_map_excerpt: evidenceMapPromptBlock(evidenceMap, 18),
    ...promptConfigVariables(profile, "newsletter")
  });

  const requests = await requestTaskVariants(
    "newsletter",
    prompt.systemPrompt,
    withPromptControls(prompt.userPrompt, profile, "newsletter", evidenceMap),
    qualityPlan.variationCount,
    usageRecorder
  );
  const trace = summarizeVariantTrace(requests);
  const variantDiagnostics = buildInitialVariantDiagnostics(requests);

  const candidates: NewsletterPayload[] = [];
  const acceptedVariantNumbers: number[] = [];
  const candidateFingerprints = new Set<string>();
  const registerCandidate = (
    index: number,
    normalization: string,
    payload: NewsletterPayload,
    reason?: string
  ): boolean => {
    const validation = validatePayloadForTask(
      "newsletter",
      payload,
      evidenceMap,
      segments,
      profile.tasks.newsletter
    );
    variantDiagnostics[index].normalization = normalization;
    variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
      "newsletter",
      payload,
      evidenceMap,
      segments,
      validation,
      profile.tasks.newsletter
    );
    const blockingIssues = blockingValidationIssues(validation);
    if (blockingIssues.length > 0) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
      return false;
    }
    if (!validation.ok) {
      variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
    }

    const fingerprint = candidateFingerprint(payload);
    if (candidateFingerprints.has(fingerprint)) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = "duplicate_candidate";
      return false;
    }

    candidateFingerprints.add(fingerprint);
    candidates.push(payload);
    acceptedVariantNumbers.push(index + 1);
    if (reason) {
      variantDiagnostics[index].reason = variantDiagnostics[index].reason
        ? `${variantDiagnostics[index].reason} · ${reason}`
        : reason;
    }
    return true;
  };
  requests.forEach((request, index) => {
    if (!request.output) {
      return;
    }

    const taskOutput = unwrapTaskOutput("newsletter", request.output);
    const parsed = NEWSLETTER_SCHEMA.safeParse(taskOutput);
    if (parsed.success) {
      const normalized = sanitizeNewsletterPayload(parsed.data);
      registerCandidate(index, "newsletter_schema", normalized);
      return;
    }

    const coerced = coerceNewsletterOutput(taskOutput, fallback);
    if (coerced.confidence >= COERCE_ACCEPTANCE_THRESHOLD.newsletter) {
      registerCandidate(
        index,
        "newsletter_coerced_schema",
        coerced.payload,
        `coerced_schema(signal=${coerced.confidence})`
      );
      return;
    }

    variantDiagnostics[index].status = "schema_failed";
    variantDiagnostics[index].reason = `schema_mismatch · ${zodIssueSummary(parsed.error, 2)}`;
  });

  const candidate = candidates[0] ?? sanitizeNewsletterPayload(fallback);
  const additionalCandidates = candidates.slice(1);
  const quality =
    candidates.length === 0
      ? await buildFallbackQualityResultWithJudge({
          task: "newsletter",
          candidate,
          context,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder
        })
      : await refineIfLowQuality({
          task: "newsletter",
          candidate,
          additionalCandidates,
          context,
          forceRefine,
          maxRefinePasses: qualityPlan.refinePasses,
          qualityThreshold,
          publishabilityThreshold,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder,
          parseRefined: (value) => {
            const refinedOutput = unwrapTaskOutput("newsletter", value);
            const parsedRefined = NEWSLETTER_SCHEMA.safeParse(refinedOutput);
            if (parsedRefined.success) {
              const normalized = sanitizeNewsletterPayload(parsedRefined.data);
              const validation = validatePayloadForTask(
                "newsletter",
                normalized,
                evidenceMap,
                segments,
                profile.tasks.newsletter
              );
              return blockingValidationIssues(validation).length === 0 ? normalized : null;
            }

            const coerced = coerceNewsletterOutput(refinedOutput, candidate);
            if (coerced.confidence < COERCE_ACCEPTANCE_THRESHOLD.newsletter) {
              return null;
            }
            const normalized = sanitizeNewsletterPayload(coerced.payload);
            const validation = validatePayloadForTask(
              "newsletter",
              normalized,
              evidenceMap,
              segments,
              profile.tasks.newsletter
            );
            return blockingValidationIssues(validation).length === 0 ? normalized : null;
          }
        });
  quality.candidateEvaluations.forEach((item) => {
    const variantNumber = acceptedVariantNumbers[item.candidateIndex - 1];
    if (!variantNumber) {
      return;
    }

    const variant = variantDiagnostics.find((entry) => entry.variant === variantNumber);
    if (!variant) {
      return;
    }

    variant.heuristicScore = Number(item.heuristicScore.toFixed(2));
    variant.judgeScore = Number(item.judgeScore.toFixed(2));
    variant.selected = item.candidateIndex === quality.selectedCandidate;
  });
  const selectedVariant = acceptedVariantNumbers[quality.selectedCandidate - 1] ?? 0;

  if (srtAssetId) {
    const usage = usageToDiagnosticsFields(usageMetrics);
    emitTaskDiagnostics(diagnosticsRecorder, {
      srtAssetId,
      task: "newsletter",
      provider: trace.provider,
      model: trace.model,
      promptName: promptMeta.name,
      usedHeuristicFallback: trace.usedHeuristicFallback,
      fallbackReason: trace.fallbackReason,
      qualityInitial: Number(quality.initialEval.overall.toFixed(2)),
      qualityFinal: Number(quality.displayScore.toFixed(2)),
      qualityScore: Number(quality.qualityScore.toFixed(2)),
      qualityThreshold,
      publishabilityScore: Number(quality.publishabilityScore.toFixed(2)),
      publishabilityThreshold,
      meetsQualityThreshold: meetsThreshold(quality.qualityScore, qualityThreshold),
      meetsPublishabilityThreshold: meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      readyForPublish:
        meetsThreshold(quality.qualityScore, qualityThreshold) &&
        meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      qualitySubscoresInitial: quality.initialEval.subscores,
      qualitySubscoresFinal: quality.finalEval.subscores,
      judgeQualityScore: quality.judgeEval.overall,
      judgeSubscores: quality.judgeEval.subscores,
      judgeSummary: quality.judgeEval.summary,
      requestedVariants: requests.length,
      successfulVariants: acceptedVariantNumbers.length,
      selectedVariant,
      variants: variantDiagnostics,
      refinementRequested: quality.refinementRequested,
      refinementApplied: quality.refinementApplied,
      candidateCount: quality.candidateCount,
      selectedCandidate: quality.selectedCandidate,
      refinePassesTarget: quality.refinePassesTarget,
      refinePassesAppliedCount: quality.refinePassesAppliedCount,
      inflationGuardApplied: quality.inflationGuardApplied,
      inflationGuardReason: quality.inflationGuardReason,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
  }

  const finalValidation = validatePayloadForTask(
    "newsletter",
    quality.candidate,
    evidenceMap,
    segments,
    profile.tasks.newsletter
  );
  return blockingValidationIssues(finalValidation).length === 0
    ? quality.candidate
    : sanitizeNewsletterPayload(fallback);
}

export async function generateLinkedin(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile,
  srtAssetId?: string,
  diagnosticsRecorder?: GenerationDiagnosticsRecorder
): Promise<LinkedinPayload> {
  const forceRefine = false;
  const profile = generationProfile ?? defaultGenerationProfile();
  const usageMetrics = createTaskUsageMetrics();
  const usageRecorder = (usage: TaskRequestUsage) => {
    accumulateTaskUsage(usageMetrics, usage);
  };
  const evidenceMap = buildEvidenceMap(segments, profile.quality.mode === "max" ? 96 : 72);
  const qualityPlan = qualityPlanByProfile(profile, "linkedin");
  const qualityThreshold = qualityThresholdByProfile("linkedin", profile);
  const publishabilityThreshold = publishabilityThresholdByProfile("linkedin", profile);
  const taskScoreWeights = normalizeTaskScoreWeights(profile.tasks.linkedin.scoreWeights);
  const promptMeta = getActivePromptTemplate("linkedin");
  const fallback = buildLinkedin(segments, analysis, profile);
  const context = [
    `analysis_json:\n${JSON.stringify(analysis, null, 2)}`,
    `evidence_map:\n${evidenceMapPromptBlock(evidenceMap, 24)}`,
    `transcript_excerpt:\n${transcriptExcerpt(segments, 110)}`,
    `profile:\n${JSON.stringify(promptConfigVariables(profile, "linkedin"), null, 2)}`
  ].join("\n\n");
  const prompt = renderPromptForTask("linkedin", {
    transcript_excerpt: transcriptExcerpt(segments, 110),
    analysis_json: JSON.stringify(analysis),
    evidence_map_json: JSON.stringify({
      numbers: [...evidenceMap.numbers],
      lines: evidenceMap.lines
    }),
    evidence_map_excerpt: evidenceMapPromptBlock(evidenceMap, 18),
    ...promptConfigVariables(profile, "linkedin")
  });

  const requests = await requestTaskVariants(
    "linkedin",
    prompt.systemPrompt,
    withPromptControls(prompt.userPrompt, profile, "linkedin", evidenceMap),
    qualityPlan.variationCount,
    usageRecorder
  );
  const trace = summarizeVariantTrace(requests);
  const variantDiagnostics = buildInitialVariantDiagnostics(requests);

  const candidates: LinkedinPayload[] = [];
  const acceptedVariantNumbers: number[] = [];
  const candidateFingerprints = new Set<string>();
  const registerCandidate = (
    index: number,
    normalization: string,
    payload: LinkedinPayload,
    reason?: string
  ): boolean => {
    const validation = validatePayloadForTask(
      "linkedin",
      payload,
      evidenceMap,
      segments,
      profile.tasks.linkedin
    );
    variantDiagnostics[index].normalization = normalization;
    variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
      "linkedin",
      payload,
      evidenceMap,
      segments,
      validation,
      profile.tasks.linkedin
    );
    const blockingIssues = blockingValidationIssues(validation);
    if (blockingIssues.length > 0) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
      return false;
    }
    if (!validation.ok) {
      variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
    }

    const fingerprint = candidateFingerprint(payload);
    if (candidateFingerprints.has(fingerprint)) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = "duplicate_candidate";
      return false;
    }

    candidateFingerprints.add(fingerprint);
    candidates.push(payload);
    acceptedVariantNumbers.push(index + 1);
    if (reason) {
      variantDiagnostics[index].reason = variantDiagnostics[index].reason
        ? `${variantDiagnostics[index].reason} · ${reason}`
        : reason;
    }
    return true;
  };
  requests.forEach((request, index) => {
    if (!request.output) {
      return;
    }

    const taskOutput = unwrapTaskOutput("linkedin", request.output);
    const parsed = LINKEDIN_SCHEMA.safeParse(taskOutput);
    if (parsed.success) {
      const normalized = sanitizeLinkedinPayload(parsed.data);
      registerCandidate(index, "linkedin_schema", normalized);
      return;
    }

    const coerced = coerceLinkedinOutput(taskOutput, fallback);
    if (coerced.confidence >= COERCE_ACCEPTANCE_THRESHOLD.linkedin) {
      registerCandidate(
        index,
        "linkedin_coerced_schema",
        coerced.payload,
        `coerced_schema(signal=${coerced.confidence})`
      );
      return;
    }

    variantDiagnostics[index].status = "schema_failed";
    variantDiagnostics[index].reason = `schema_mismatch · ${zodIssueSummary(parsed.error, 2)}`;
  });

  const candidate = candidates[0] ?? sanitizeLinkedinPayload(fallback);
  const additionalCandidates = candidates.slice(1);
  const quality =
    candidates.length === 0
      ? await buildFallbackQualityResultWithJudge({
          task: "linkedin",
          candidate,
          context,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder
        })
      : await refineIfLowQuality({
          task: "linkedin",
          candidate,
          additionalCandidates,
          context,
          forceRefine,
          maxRefinePasses: qualityPlan.refinePasses,
          qualityThreshold,
          publishabilityThreshold,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder,
          parseRefined: (value) => {
            const refinedOutput = unwrapTaskOutput("linkedin", value);
            const parsedRefined = LINKEDIN_SCHEMA.safeParse(refinedOutput);
            if (parsedRefined.success) {
              const normalized = sanitizeLinkedinPayload(parsedRefined.data);
              const validation = validatePayloadForTask(
                "linkedin",
                normalized,
                evidenceMap,
                segments,
                profile.tasks.linkedin
              );
              return blockingValidationIssues(validation).length === 0 ? normalized : null;
            }

            const coerced = coerceLinkedinOutput(refinedOutput, candidate);
            if (coerced.confidence < COERCE_ACCEPTANCE_THRESHOLD.linkedin) {
              return null;
            }
            const normalized = sanitizeLinkedinPayload(coerced.payload);
            const validation = validatePayloadForTask(
              "linkedin",
              normalized,
              evidenceMap,
              segments,
              profile.tasks.linkedin
            );
            return blockingValidationIssues(validation).length === 0 ? normalized : null;
          }
        });
  quality.candidateEvaluations.forEach((item) => {
    const variantNumber = acceptedVariantNumbers[item.candidateIndex - 1];
    if (!variantNumber) {
      return;
    }

    const variant = variantDiagnostics.find((entry) => entry.variant === variantNumber);
    if (!variant) {
      return;
    }

    variant.heuristicScore = Number(item.heuristicScore.toFixed(2));
    variant.judgeScore = Number(item.judgeScore.toFixed(2));
    variant.selected = item.candidateIndex === quality.selectedCandidate;
  });
  const selectedVariant = acceptedVariantNumbers[quality.selectedCandidate - 1] ?? 0;

  if (srtAssetId) {
    const usage = usageToDiagnosticsFields(usageMetrics);
    emitTaskDiagnostics(diagnosticsRecorder, {
      srtAssetId,
      task: "linkedin",
      provider: trace.provider,
      model: trace.model,
      promptName: promptMeta.name,
      usedHeuristicFallback: trace.usedHeuristicFallback,
      fallbackReason: trace.fallbackReason,
      qualityInitial: Number(quality.initialEval.overall.toFixed(2)),
      qualityFinal: Number(quality.displayScore.toFixed(2)),
      qualityScore: Number(quality.qualityScore.toFixed(2)),
      qualityThreshold,
      publishabilityScore: Number(quality.publishabilityScore.toFixed(2)),
      publishabilityThreshold,
      meetsQualityThreshold: meetsThreshold(quality.qualityScore, qualityThreshold),
      meetsPublishabilityThreshold: meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      readyForPublish:
        meetsThreshold(quality.qualityScore, qualityThreshold) &&
        meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      qualitySubscoresInitial: quality.initialEval.subscores,
      qualitySubscoresFinal: quality.finalEval.subscores,
      judgeQualityScore: quality.judgeEval.overall,
      judgeSubscores: quality.judgeEval.subscores,
      judgeSummary: quality.judgeEval.summary,
      requestedVariants: requests.length,
      successfulVariants: acceptedVariantNumbers.length,
      selectedVariant,
      variants: variantDiagnostics,
      refinementRequested: quality.refinementRequested,
      refinementApplied: quality.refinementApplied,
      candidateCount: quality.candidateCount,
      selectedCandidate: quality.selectedCandidate,
      refinePassesTarget: quality.refinePassesTarget,
      refinePassesAppliedCount: quality.refinePassesAppliedCount,
      inflationGuardApplied: quality.inflationGuardApplied,
      inflationGuardReason: quality.inflationGuardReason,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
  }

  const finalValidation = validatePayloadForTask(
    "linkedin",
    quality.candidate,
    evidenceMap,
    segments,
    profile.tasks.linkedin
  );
  return blockingValidationIssues(finalValidation).length === 0
    ? quality.candidate
    : sanitizeLinkedinPayload(fallback);
}

export async function generateXPosts(
  segments: TranscriptSegment[],
  analysis: AnalysisPayload,
  generationProfile?: GenerationProfile,
  srtAssetId?: string,
  diagnosticsRecorder?: GenerationDiagnosticsRecorder
): Promise<XPostsPayload> {
  const forceRefine = false;
  const profile = generationProfile ?? defaultGenerationProfile();
  const usageMetrics = createTaskUsageMetrics();
  const usageRecorder = (usage: TaskRequestUsage) => {
    accumulateTaskUsage(usageMetrics, usage);
  };
  const evidenceMap = buildEvidenceMap(segments, profile.quality.mode === "max" ? 96 : 72);
  const qualityPlan = qualityPlanByProfile(profile, "x");
  const qualityThreshold = qualityThresholdByProfile("x", profile);
  const publishabilityThreshold = publishabilityThresholdByProfile("x", profile);
  const taskScoreWeights = normalizeTaskScoreWeights(profile.tasks.x.scoreWeights);
  const promptMeta = getActivePromptTemplate("x");
  const fallback = buildXPosts(segments, analysis, profile);
  const context = [
    `analysis_json:\n${JSON.stringify(analysis, null, 2)}`,
    `evidence_map:\n${evidenceMapPromptBlock(evidenceMap, 24)}`,
    `transcript_excerpt:\n${transcriptExcerpt(segments, 110)}`,
    `profile:\n${JSON.stringify(promptConfigVariables(profile, "x"), null, 2)}`
  ].join("\n\n");
  const prompt = renderPromptForTask("x", {
    transcript_excerpt: transcriptExcerpt(segments, 110),
    analysis_json: JSON.stringify(analysis),
    evidence_map_json: JSON.stringify({
      numbers: [...evidenceMap.numbers],
      lines: evidenceMap.lines
    }),
    evidence_map_excerpt: evidenceMapPromptBlock(evidenceMap, 18),
    ...promptConfigVariables(profile, "x")
  });

  const requests = await requestTaskVariants(
    "x",
    prompt.systemPrompt,
    withPromptControls(prompt.userPrompt, profile, "x", evidenceMap),
    qualityPlan.variationCount,
    usageRecorder
  );
  const trace = summarizeVariantTrace(requests);
  const variantDiagnostics = buildInitialVariantDiagnostics(requests);

  const candidates: XPostsPayload[] = [];
  const acceptedVariantNumbers: number[] = [];
  const candidateFingerprints = new Set<string>();
  const registerCandidate = (
    index: number,
    normalization: string,
    payload: XPostsPayload,
    reason?: string
  ): boolean => {
    const validation = validatePayloadForTask(
      "x",
      payload,
      evidenceMap,
      segments,
      profile.tasks.x
    );
    variantDiagnostics[index].normalization = normalization;
    variantDiagnostics[index].normalizedOutput = variantOutputWithEvidence(
      "x",
      payload,
      evidenceMap,
      segments,
      validation,
      profile.tasks.x
    );
    const blockingIssues = blockingValidationIssues(validation);
    if (blockingIssues.length > 0) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = `quality_guard · ${blockingIssues.slice(0, 2).join(" | ")}`;
      return false;
    }
    if (!validation.ok) {
      variantDiagnostics[index].reason = `quality_guard_soft · ${validation.issues.slice(0, 2).join(" | ")}`;
    }

    const fingerprint = candidateFingerprint(payload);
    if (candidateFingerprints.has(fingerprint)) {
      variantDiagnostics[index].status = "schema_failed";
      variantDiagnostics[index].reason = "duplicate_candidate";
      return false;
    }

    candidateFingerprints.add(fingerprint);
    candidates.push(payload);
    acceptedVariantNumbers.push(index + 1);
    if (reason) {
      variantDiagnostics[index].reason = variantDiagnostics[index].reason
        ? `${variantDiagnostics[index].reason} · ${reason}`
        : reason;
    }
    return true;
  };
  requests.forEach((request, index) => {
    if (!request.output) {
      return;
    }

    const taskOutput = unwrapTaskOutput("x", request.output);
    const parsed = X_SCHEMA.safeParse(taskOutput);
    if (parsed.success) {
      const normalized = sanitizeXPayload(
        parsed.data,
        profile.tasks.x.ctaMode,
        profile.tasks.x.length
      );
      registerCandidate(index, "x_schema", normalized);
      return;
    }

    const coerced = coerceXOutput(
      taskOutput,
      fallback,
      profile.tasks.x.ctaMode,
      profile.tasks.x.length
    );
    if (coerced.confidence >= COERCE_ACCEPTANCE_THRESHOLD.x) {
      registerCandidate(
        index,
        "x_coerced_schema",
        coerced.payload,
        `coerced_schema(signal=${coerced.confidence})`
      );
      return;
    }

    variantDiagnostics[index].status = "schema_failed";
    variantDiagnostics[index].reason = `schema_mismatch · ${zodIssueSummary(parsed.error, 2)}`;
  });

  const candidate =
    candidates[0] ??
    sanitizeXPayload(fallback, profile.tasks.x.ctaMode, profile.tasks.x.length);
  const additionalCandidates = candidates.slice(1);
  const quality =
    candidates.length === 0
      ? await buildFallbackQualityResultWithJudge({
          task: "x",
          candidate,
          context,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder
        })
      : await refineIfLowQuality({
          task: "x",
          candidate,
          additionalCandidates,
          context,
          forceRefine,
          maxRefinePasses: qualityPlan.refinePasses,
          qualityThreshold,
          publishabilityThreshold,
          useJudgePanel: profile.quality.mode === "max",
          scoreWeights: taskScoreWeights,
          usageRecorder,
          parseRefined: (value) => {
            const refinedOutput = unwrapTaskOutput("x", value);
            const parsedRefined = X_SCHEMA.safeParse(refinedOutput);
            if (parsedRefined.success) {
              const normalized = sanitizeXPayload(
                parsedRefined.data,
                profile.tasks.x.ctaMode,
                profile.tasks.x.length
              );
              const validation = validatePayloadForTask(
                "x",
                normalized,
                evidenceMap,
                segments,
                profile.tasks.x
              );
              return blockingValidationIssues(validation).length === 0 ? normalized : null;
            }

            const coerced = coerceXOutput(
              refinedOutput,
              candidate,
              profile.tasks.x.ctaMode,
              profile.tasks.x.length
            );
            if (coerced.confidence < COERCE_ACCEPTANCE_THRESHOLD.x) {
              return null;
            }
            const normalized = sanitizeXPayload(
              coerced.payload,
              profile.tasks.x.ctaMode,
              profile.tasks.x.length
            );
            const validation = validatePayloadForTask(
              "x",
              normalized,
              evidenceMap,
              segments,
              profile.tasks.x
            );
            return blockingValidationIssues(validation).length === 0 ? normalized : null;
          }
        });
  quality.candidateEvaluations.forEach((item) => {
    const variantNumber = acceptedVariantNumbers[item.candidateIndex - 1];
    if (!variantNumber) {
      return;
    }

    const variant = variantDiagnostics.find((entry) => entry.variant === variantNumber);
    if (!variant) {
      return;
    }

    variant.heuristicScore = Number(item.heuristicScore.toFixed(2));
    variant.judgeScore = Number(item.judgeScore.toFixed(2));
    variant.selected = item.candidateIndex === quality.selectedCandidate;
  });
  const selectedVariant = acceptedVariantNumbers[quality.selectedCandidate - 1] ?? 0;

  if (srtAssetId) {
    const usage = usageToDiagnosticsFields(usageMetrics);
    emitTaskDiagnostics(diagnosticsRecorder, {
      srtAssetId,
      task: "x",
      provider: trace.provider,
      model: trace.model,
      promptName: promptMeta.name,
      usedHeuristicFallback: trace.usedHeuristicFallback,
      fallbackReason: trace.fallbackReason,
      qualityInitial: Number(quality.initialEval.overall.toFixed(2)),
      qualityFinal: Number(quality.displayScore.toFixed(2)),
      qualityScore: Number(quality.qualityScore.toFixed(2)),
      qualityThreshold,
      publishabilityScore: Number(quality.publishabilityScore.toFixed(2)),
      publishabilityThreshold,
      meetsQualityThreshold: meetsThreshold(quality.qualityScore, qualityThreshold),
      meetsPublishabilityThreshold: meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      readyForPublish:
        meetsThreshold(quality.qualityScore, qualityThreshold) &&
        meetsThreshold(quality.publishabilityScore, publishabilityThreshold),
      qualitySubscoresInitial: quality.initialEval.subscores,
      qualitySubscoresFinal: quality.finalEval.subscores,
      judgeQualityScore: quality.judgeEval.overall,
      judgeSubscores: quality.judgeEval.subscores,
      judgeSummary: quality.judgeEval.summary,
      requestedVariants: requests.length,
      successfulVariants: acceptedVariantNumbers.length,
      selectedVariant,
      variants: variantDiagnostics,
      refinementRequested: quality.refinementRequested,
      refinementApplied: quality.refinementApplied,
      candidateCount: quality.candidateCount,
      selectedCandidate: quality.selectedCandidate,
      refinePassesTarget: quality.refinePassesTarget,
      refinePassesAppliedCount: quality.refinePassesAppliedCount,
      inflationGuardApplied: quality.inflationGuardApplied,
      inflationGuardReason: quality.inflationGuardReason,
      estimatedCostUsd: usage.estimatedCostUsd,
      actualCostUsd: usage.actualCostUsd,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    });
  }

  const finalValidation = validatePayloadForTask(
    "x",
    quality.candidate,
    evidenceMap,
    segments,
    profile.tasks.x
  );
  return blockingValidationIssues(finalValidation).length === 0
    ? quality.candidate
    : sanitizeXPayload(fallback, profile.tasks.x.ctaMode, profile.tasks.x.length);
}
