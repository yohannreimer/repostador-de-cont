export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type SrtStatus =
  | "uploaded"
  | "parsed"
  | "processing"
  | "done"
  | "failed";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface SrtAsset {
  id: string;
  projectId: string;
  filename: string;
  language: string;
  generationProfile: GenerationProfile;
  durationSec: number | null;
  status: SrtStatus;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  srtAssetId: string;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
  tokensEst: number;
}

export interface JobEntry {
  id: string;
  srtAssetId: string;
  name: string;
  status: JobStatus;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type AIProvider = "heuristic" | "openai" | "openrouter";
export type AITask = "analysis" | "reels" | "newsletter" | "linkedin" | "x";

export type GenerationStrategy =
  | "balanced"
  | "provocative"
  | "educational"
  | "contrarian"
  | "framework"
  | "storytelling";

export type GenerationFocus =
  | "balanced"
  | "provocative"
  | "educational"
  | "authority"
  | "conversion"
  | "contrarian"
  | "framework"
  | "storytelling";

export type GenerationTargetOutcome =
  | "followers"
  | "comments"
  | "shares"
  | "leads"
  | "authority";

export type GenerationAudienceLevel = "cold" | "warm" | "hot";

export type GenerationLength = "short" | "standard" | "long";

export type GenerationCtaMode = "none" | "comment" | "share" | "dm" | "lead";

export interface TaskScoreWeights {
  judge: number;
  heuristic: number;
}

export interface TaskGenerationConfig {
  strategy: GenerationStrategy;
  focus: GenerationFocus;
  targetOutcome: GenerationTargetOutcome;
  audienceLevel: GenerationAudienceLevel;
  length: GenerationLength;
  ctaMode: GenerationCtaMode;
  scoreWeights: TaskScoreWeights;
}

export type GenerationTaskConfig = Record<AITask, TaskGenerationConfig>;

export type GenerationQualityMode = "standard" | "max";

export interface GenerationQualityConfig {
  mode: GenerationQualityMode;
  variationCount: number;
  refinePasses: number;
}

export interface GenerationVoiceConfig {
  identity: string;
  writingRules: string;
  bannedTerms: string;
  signaturePhrases: string;
}

export interface TaskPerformanceMemory {
  wins: string;
  avoid: string;
  kpi: string;
}

export type GenerationPerformanceMemory = Record<AITask, TaskPerformanceMemory>;

export interface GenerationProfile {
  audience: string;
  goal: string;
  tone: string;
  language: string;
  quality: GenerationQualityConfig;
  voice: GenerationVoiceConfig;
  performanceMemory: GenerationPerformanceMemory;
  tasks: GenerationTaskConfig;
}

export const GENERATION_STRATEGIES: GenerationStrategy[] = [
  "balanced",
  "provocative",
  "educational",
  "contrarian",
  "framework",
  "storytelling"
];

export const GENERATION_FOCUS_OPTIONS: GenerationFocus[] = [
  "balanced",
  "provocative",
  "educational",
  "authority",
  "conversion",
  "contrarian",
  "framework",
  "storytelling"
];

export const GENERATION_TARGET_OUTCOMES: GenerationTargetOutcome[] = [
  "followers",
  "comments",
  "shares",
  "leads",
  "authority"
];

export const GENERATION_AUDIENCE_LEVELS: GenerationAudienceLevel[] = [
  "cold",
  "warm",
  "hot"
];

export const GENERATION_QUALITY_MODES: GenerationQualityMode[] = [
  "standard",
  "max"
];

export const GENERATION_LENGTHS: GenerationLength[] = ["short", "standard", "long"];

export const GENERATION_CTA_MODES: GenerationCtaMode[] = [
  "none",
  "comment",
  "share",
  "dm",
  "lead"
];

export const DEFAULT_GENERATION_PROFILE: GenerationProfile = {
  audience: "Empreendedores e criadores digitais B2B",
  goal: "Gerar autoridade com aplicacao pratica e ampliar distribuicao multicanal",
  tone: "Direto, estrategico e didatico",
  language: "pt-BR",
  quality: {
    mode: "max",
    variationCount: 4,
    refinePasses: 2
  },
  voice: {
    identity: "Estrategista direto, pratico, sem autoajuda",
    writingRules:
      "Frases curtas, especificidade, linguagem concreta, sem jargao vazio e sem travessao.",
    bannedTerms: "incrivel, revolucionario, sem esforco, segredo absoluto",
    signaturePhrases: "na pratica, proximo passo, decisao editorial"
  },
  performanceMemory: {
    analysis: {
      wins: "",
      avoid: "",
      kpi: "clareza e densidade de insight"
    },
    reels: {
      wins: "",
      avoid: "",
      kpi: "follows e compartilhamentos"
    },
    newsletter: {
      wins: "",
      avoid: "",
      kpi: "tempo de leitura e respostas"
    },
    linkedin: {
      wins: "",
      avoid: "",
      kpi: "comentarios qualificados e reposts"
    },
    x: {
      wins: "",
      avoid: "",
      kpi: "shares e replies qualificados"
    }
  },
  tasks: {
    analysis: {
      strategy: "balanced",
      focus: "authority",
      targetOutcome: "authority",
      audienceLevel: "cold",
      length: "standard",
      ctaMode: "none",
      scoreWeights: {
        judge: 0.72,
        heuristic: 0.28
      }
    },
    reels: {
      strategy: "provocative",
      focus: "provocative",
      targetOutcome: "followers",
      audienceLevel: "warm",
      length: "standard",
      ctaMode: "comment",
      scoreWeights: {
        judge: 0.76,
        heuristic: 0.24
      }
    },
    newsletter: {
      strategy: "educational",
      focus: "authority",
      targetOutcome: "authority",
      audienceLevel: "warm",
      length: "long",
      ctaMode: "lead",
      scoreWeights: {
        judge: 0.74,
        heuristic: 0.26
      }
    },
    linkedin: {
      strategy: "contrarian",
      focus: "authority",
      targetOutcome: "comments",
      audienceLevel: "warm",
      length: "standard",
      ctaMode: "comment",
      scoreWeights: {
        judge: 0.72,
        heuristic: 0.28
      }
    },
    x: {
      strategy: "provocative",
      focus: "provocative",
      targetOutcome: "shares",
      audienceLevel: "cold",
      length: "short",
      ctaMode: "share",
      scoreWeights: {
        judge: 0.73,
        heuristic: 0.27
      }
    }
  }
};

export interface AIRoute {
  provider: AIProvider;
  model: string;
  temperature: number;
}

export type AIRouting = Record<AITask, AIRoute>;

export interface AIRoutingResponse {
  routing: AIRouting;
  judgeRouting: AIRouting;
  configuredKeys: {
    openai: boolean;
    openrouter: boolean;
  };
}

export type OpenRouterModelFamily =
  | "top"
  | "claude"
  | "gemini"
  | "openai"
  | "deepseek"
  | "others";

export type OpenRouterModelFamilyByTask = Record<AITask, OpenRouterModelFamily>;

export interface AIPreferences {
  generationProfile: GenerationProfile;
  modelFamilyByTask: OpenRouterModelFamilyByTask;
}

export interface AIPreferencesResponse {
  preferences: AIPreferences;
  updatedAt: string;
}

export interface AIModelOption {
  id: string;
  name: string;
  provider: Extract<AIProvider, "openai" | "openrouter">;
  contextLength: number | null;
  description: string | null;
}

export interface AIModelsResponse {
  provider: Extract<AIProvider, "openai" | "openrouter">;
  source: "remote" | "fallback";
  cachedAt: string;
  models: AIModelOption[];
}

export interface PromptVersion {
  task: AITask;
  version: number;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  isActive: boolean;
  createdAt: string;
}

export type PromptCatalog = Record<
  AITask,
  {
    activeVersion: number;
    versions: PromptVersion[];
  }
>;

export interface PromptCatalogResponse {
  prompts: PromptCatalog;
}

export type GeneratedAssetType =
  | "analysis"
  | "reels"
  | "newsletter"
  | "linkedin"
  | "x"
  | "carousel"
  | "covers";

export type GeneratedAssetStatus = "pending" | "ready" | "failed";

export interface AnalysisPayload {
  thesis: string;
  topics: string[];
  contentType: "educational" | "provocative" | "story" | "framework";
  polarityScore: number;
  recommendations: string[];
  structure?: {
    problem: string;
    tension: string;
    insight: string;
    application: string;
  };
  retentionMoments?: Array<{
    text: string;
    type: string;
    whyItGrabs: string;
  }>;
  editorialAngles?: Array<{
    angle: string;
    idealChannel: string;
    format: string;
    whyStronger: string;
  }>;
  weakSpots?: Array<{
    issue: string;
    why: string;
  }>;
  qualityScores?: {
    insightDensity: number;
    standaloneClarity: number;
    polarity: number;
    practicalValue: number;
  };
}

export interface ReelsPayload {
  clips: Array<{
    title: string;
    start: string;
    end: string;
    caption: string;
    hashtags: string[];
    scores: {
      hook: number;
      clarity: number;
      retention: number;
      share: number;
    };
    whyItWorks: string;
  }>;
}

export interface NewsletterPayload {
  headline: string;
  subheadline: string;
  sections: Array<
    | { type: "intro"; text: string }
    | { type: "insight"; title: string; text: string }
    | { type: "application"; bullets: string[] }
    | { type: "cta"; text: string }
  >;
}

export interface LinkedinPayload {
  hook: string;
  body: string[];
  ctaQuestion: string;
}

export interface XPostsPayload {
  standalone: string[];
  thread: string[];
  notes: {
    style: string;
  };
}

export type GeneratedAssetPayload =
  | AnalysisPayload
  | ReelsPayload
  | NewsletterPayload
  | LinkedinPayload
  | XPostsPayload
  | Record<string, unknown>;

export interface GeneratedAsset {
  id: string;
  srtAssetId: string;
  type: GeneratedAssetType;
  version: number;
  status: GeneratedAssetStatus;
  payload: GeneratedAssetPayload;
  createdAt: string;
}

export interface UploadSrtResponse {
  srtAssetId: string;
  status: SrtStatus;
}

export interface ProjectHistoryItem {
  srtAssetId: string;
  filename: string;
  language: string;
  durationSec: number | null;
  status: SrtStatus;
  createdAt: string;
  segmentCount: number;
  latestJob: JobEntry | null;
  readyTasks: number;
  totalTasks: number;
  qualityAvg: number | null;
  publishabilityAvg: number | null;
  totalEstimatedCostUsd: number | null;
  totalActualCostUsd: number | null;
}

export interface ProjectHistoryResponse {
  project: Project;
  items: ProjectHistoryItem[];
}

export interface UpdateSrtProfileResponse {
  asset: SrtAsset;
  rerunQueued: boolean;
}

export interface SrtDetailResponse {
  asset: SrtAsset;
  segmentCount: number;
  latestJob: JobEntry | null;
}

export interface SrtJobsResponse {
  jobs: JobEntry[];
}

export interface SrtAssetsResponse {
  assets: GeneratedAsset[];
}

export interface SrtAssetByTypeResponse {
  asset: GeneratedAsset | null;
}

export type AssetRefineAction =
  | "improve"
  | "shorten"
  | "deepen"
  | "provocative";

export interface RefineAssetResponse {
  srtAssetId: string;
  type: GeneratedAssetType;
  action: AssetRefineAction;
  status: "queued";
}

export interface RefineAssetBlockResponse {
  srtAssetId: string;
  type: GeneratedAssetType;
  blockPath: string;
  action: AssetRefineAction;
  evidenceOnly?: boolean;
  status: "queued";
}

export interface SaveAssetManualResponse {
  asset: GeneratedAsset;
}

export interface SelectAssetVariantResponse {
  asset: GeneratedAsset;
  task: AITask;
  selectedVariant: number;
}

export interface QualitySubscores {
  clarity: number;
  depth: number;
  originality: number;
  applicability: number;
  retentionPotential: number;
}

export interface TaskVariantDiagnostics {
  variant: number;
  status: "ok" | "request_failed" | "schema_failed";
  reason: string | null;
  heuristicScore: number | null;
  judgeScore: number | null;
  selected: boolean;
  normalization: string | null;
  modelOutput: Record<string, unknown> | null;
  normalizedOutput: Record<string, unknown> | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

export interface TaskGenerationDiagnostics {
  srtAssetId: string;
  task: AITask;
  provider: AIProvider;
  model: string;
  promptName: string;
  usedHeuristicFallback: boolean;
  fallbackReason: string | null;
  qualityInitial: number;
  qualityFinal: number;
  qualityScore: number;
  qualityThreshold: number;
  publishabilityScore: number;
  publishabilityThreshold: number;
  meetsQualityThreshold: boolean;
  meetsPublishabilityThreshold: boolean;
  readyForPublish: boolean;
  qualitySubscoresInitial: QualitySubscores;
  qualitySubscoresFinal: QualitySubscores;
  judgeQualityScore: number;
  judgeSubscores: QualitySubscores;
  judgeSummary: string;
  requestedVariants: number;
  successfulVariants: number;
  selectedVariant: number;
  variants: TaskVariantDiagnostics[];
  refinementRequested: boolean;
  refinementApplied: boolean;
  candidateCount: number;
  selectedCandidate: number;
  refinePassesTarget: number;
  refinePassesAppliedCount: number;
  inflationGuardApplied: boolean;
  inflationGuardReason: string | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  updatedAt: string;
}

export interface SrtDiagnosticsResponse {
  diagnostics: TaskGenerationDiagnostics[];
}

export interface ParsedSrt {
  language: string;
  durationSec: number;
  segments: Array<{
    idx: number;
    startMs: number;
    endMs: number;
    text: string;
    tokensEst: number;
  }>;
}
