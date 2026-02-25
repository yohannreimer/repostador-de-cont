"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AIPreferencesResponse,
  AIModelOption,
  AIRoute,
  AIRouting,
  AITask,
  AIProvider,
  AnalysisPayload,
  AssetRefineAction,
  GenerationAudienceLevel,
  GenerationCtaMode,
  GenerationFocus,
  GenerationLength,
  GenerationProfile,
  GenerationQualityMode,
  GenerationStrategy,
  GenerationTargetOutcome,
  GeneratedAsset,
  GeneratedAssetPayload,
  GeneratedAssetType,
  JobEntry,
  LinkedinPayload,
  NewsletterPayload,
  PromptCatalog,
  PromptVersion,
  Project,
  ProjectHistoryItem,
  ReelsPayload,
  SrtDetailResponse,
  TaskGenerationDiagnostics,
  OpenRouterModelFamilyByTask,
  XPostsPayload
} from "@authority/shared";
import {
  GENERATION_AUDIENCE_LEVELS,
  DEFAULT_GENERATION_PROFILE,
  GENERATION_CTA_MODES,
  GENERATION_FOCUS_OPTIONS,
  GENERATION_LENGTHS,
  GENERATION_QUALITY_MODES,
  GENERATION_STRATEGIES,
  GENERATION_TARGET_OUTCOMES
} from "@authority/shared";
import {
  activateAiPromptVersion,
  createAiPromptVersion,
  createProject,
  getAiPreferences,
  getAiModels,
  getAiPrompts,
  getAiRouting,
  getProjectHistory,
  getProjects,
  getSrtAssets,
  getSrtDiagnostics,
  getSrtDetail,
  getSrtJobs,
  patchAiPreferences,
  patchAiRouting,
  downloadSrtMarkdownExport,
  downloadSrtPdfExport,
  downloadSrtTxtExport,
  refineSrtAsset,
  refineSrtAssetBlock,
  saveSrtAssetManual,
  selectSrtAssetVariant,
  updateSrtGenerationProfile,
  uploadSrt
} from "../lib/api";

const RESULT_TABS: Array<{ type: GeneratedAssetType; label: string }> = [
  { type: "analysis", label: "Analise" },
  { type: "reels", label: "Reels" },
  { type: "newsletter", label: "Newsletter" },
  { type: "linkedin", label: "LinkedIn" },
  { type: "x", label: "X" }
];

const REFINABLE_ASSET_TYPES: GeneratedAssetType[] = [
  "analysis",
  "reels",
  "newsletter",
  "linkedin",
  "x"
];

const ASSET_REFINE_ACTIONS: Array<{
  id: AssetRefineAction;
  label: string;
  description: string;
}> = [
  {
    id: "improve",
    label: "Melhorar",
    description: "Aumenta especificidade e consistencia geral"
  },
  {
    id: "shorten",
    label: "Encurtar",
    description: "Deixa mais direto e enxuto"
  },
  {
    id: "deepen",
    label: "Aprofundar",
    description: "Mais densidade e aplicacao pratica"
  },
  {
    id: "provocative",
    label: "Mais provocativo",
    description: "Aumenta tensao argumentativa"
  }
];

const AI_TASKS: Array<{ key: AITask; label: string }> = [
  { key: "analysis", label: "Analise narrativa" },
  { key: "reels", label: "Reels" },
  { key: "newsletter", label: "Newsletter" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X" }
];

const STRATEGY_LABEL: Record<GenerationStrategy, string> = {
  balanced: "Balanced",
  provocative: "Provocative",
  educational: "Educational",
  contrarian: "Contrarian",
  framework: "Framework",
  storytelling: "Storytelling"
};

const FOCUS_LABEL: Record<GenerationFocus, string> = {
  balanced: "Balanced",
  provocative: "Provocative",
  educational: "Educational",
  authority: "Authority",
  conversion: "Conversion",
  contrarian: "Contrarian",
  framework: "Framework",
  storytelling: "Storytelling"
};

const OUTCOME_LABEL: Record<GenerationTargetOutcome, string> = {
  followers: "Followers",
  comments: "Comments",
  shares: "Shares",
  leads: "Leads",
  authority: "Authority"
};

const AUDIENCE_LEVEL_LABEL: Record<GenerationAudienceLevel, string> = {
  cold: "Cold",
  warm: "Warm",
  hot: "Hot"
};

const QUALITY_MODE_LABEL: Record<GenerationQualityMode, string> = {
  standard: "Standard",
  max: "Max Quality"
};

const LENGTH_LABEL: Record<GenerationLength, string> = {
  short: "Short",
  standard: "Standard",
  long: "Long"
};

const CTA_MODE_LABEL: Record<GenerationCtaMode, string> = {
  none: "Sem CTA",
  comment: "Comentario",
  share: "Compartilhamento",
  dm: "Direct",
  lead: "Lead"
};

type WorkspaceStage =
  | "models"
  | "prompts"
  | "guidelines"
  | "project"
  | "results";

type ResultsWorkspaceView = "overview" | "quality" | "variants" | "studio";

const RESULTS_WORKSPACE_VIEWS: Array<{
  key: ResultsWorkspaceView;
  label: string;
  description: string;
}> = [
  {
    key: "overview",
    label: "Overview",
    description: "Resumo executivo e saude dos canais."
  },
  {
    key: "quality",
    label: "Quality Board",
    description: "Diagnostico tecnico com score e guardrails."
  },
  {
    key: "variants",
    label: "Variations Lab",
    description: "Comparacao de variacoes e selecao manual."
  },
  {
    key: "studio",
    label: "Content Studio",
    description: "Edicao final e export por canal."
  }
];

const WORKSPACE_STAGES: Array<{
  key: WorkspaceStage;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    key: "models",
    label: "Modelos e roteamento",
    shortLabel: "Modelos",
    description: "Escolha provider e modelo por tarefa para geração e judge."
  },
  {
    key: "prompts",
    label: "Prompts por tarefa",
    shortLabel: "Prompts",
    description: "Inspecione versões, edite e publique prompts com controle."
  },
  {
    key: "guidelines",
    label: "Diretrizes de conteúdo",
    shortLabel: "Diretrizes",
    description: "Defina brief estratégico, voz e perfil editorial por canal."
  },
  {
    key: "project",
    label: "Projeto e upload",
    shortLabel: "Projeto",
    description: "Crie projeto, envie SRT/TXT e inicie processamento."
  },
  {
    key: "results",
    label: "Resultados e ajustes",
    shortLabel: "Resultados",
    description: "Audite qualidade, compare variações e ajuste cada saída."
  }
];

type WorkflowMode = "setup" | "create" | "generate" | "review";

const WORKFLOW_MODES: Array<{
  key: WorkflowMode;
  label: string;
  description: string;
}> = [
  {
    key: "setup",
    label: "Setup",
    description: "Conectar IA, prompts e diretrizes."
  },
  {
    key: "create",
    label: "Create",
    description: "Criar projeto e enviar transcricao."
  },
  {
    key: "generate",
    label: "Generate",
    description: "Executar pipeline e monitorar run."
  },
  {
    key: "review",
    label: "Review",
    description: "Revisar, refinar e publicar."
  }
];

type ProfilePresetId = "growth" | "authority" | "conversion";

const PROFILE_PRESETS: Array<{
  id: ProfilePresetId;
  label: string;
  description: string;
}> = [
  {
    id: "growth",
    label: "Growth agressivo",
    description: "Maximiza follows, comentarios e cortes com alto impacto."
  },
  {
    id: "authority",
    label: "Autoridade B2B",
    description: "Foco em profundidade, framework e posicionamento senior."
  },
  {
    id: "conversion",
    label: "Conversao qualificada",
    description: "Prioriza leads, CTA de acao e aplicacao comercial."
  }
];

const TASK_CHANNEL_PRESETS: Record<
  AITask,
  Array<{
    id: string;
    label: string;
    description: string;
    config: GenerationProfile["tasks"][AITask];
  }>
> = {
  analysis: [
    {
      id: "analysis-framework",
      label: "Framework estrategico",
      description: "Diagnostico + mecanismo causal + plano aplicavel",
      config: {
        strategy: "framework",
        focus: "authority",
        targetOutcome: "authority",
        audienceLevel: "warm",
        length: "long",
        ctaMode: "none",
        scoreWeights: { judge: 0.82, heuristic: 0.18 }
      }
    },
    {
      id: "analysis-contrarian",
      label: "Contrarian com prova",
      description: "Tese forte com tensao editorial e exemplos concretos",
      config: {
        strategy: "contrarian",
        focus: "contrarian",
        targetOutcome: "authority",
        audienceLevel: "warm",
        length: "standard",
        ctaMode: "none",
        scoreWeights: { judge: 0.8, heuristic: 0.2 }
      }
    }
  ],
  reels: [
    {
      id: "reels-provocative-growth",
      label: "Provocativo para growth",
      description: "Hook forte, friccao e CTA para seguir/comentar",
      config: {
        strategy: "provocative",
        focus: "provocative",
        targetOutcome: "followers",
        audienceLevel: "cold",
        length: "long",
        ctaMode: "comment",
        scoreWeights: { judge: 0.84, heuristic: 0.16 }
      }
    },
    {
      id: "reels-educational-authority",
      label: "Educacional com autoridade",
      description: "Didatico, aplicavel e com retenção consistente",
      config: {
        strategy: "educational",
        focus: "authority",
        targetOutcome: "shares",
        audienceLevel: "warm",
        length: "standard",
        ctaMode: "share",
        scoreWeights: { judge: 0.8, heuristic: 0.2 }
      }
    }
  ],
  newsletter: [
    {
      id: "newsletter-premium-long",
      label: "Premium densa",
      description: "Estrutura longa com framework e checklist prático",
      config: {
        strategy: "framework",
        focus: "authority",
        targetOutcome: "authority",
        audienceLevel: "warm",
        length: "long",
        ctaMode: "lead",
        scoreWeights: { judge: 0.83, heuristic: 0.17 }
      }
    },
    {
      id: "newsletter-conversion",
      label: "Conversão qualificada",
      description: "Aplicacao comercial e CTA orientado a lead",
      config: {
        strategy: "educational",
        focus: "conversion",
        targetOutcome: "leads",
        audienceLevel: "hot",
        length: "standard",
        ctaMode: "lead",
        scoreWeights: { judge: 0.8, heuristic: 0.2 }
      }
    }
  ],
  linkedin: [
    {
      id: "linkedin-authority-comment",
      label: "Autoridade para comentários",
      description: "Hook direto, progressão de argumento e CTA diagnóstico",
      config: {
        strategy: "contrarian",
        focus: "authority",
        targetOutcome: "comments",
        audienceLevel: "warm",
        length: "long",
        ctaMode: "comment",
        scoreWeights: { judge: 0.82, heuristic: 0.18 }
      }
    },
    {
      id: "linkedin-leads",
      label: "Lead consultivo",
      description: "Corpo prático e chamada para próxima ação comercial",
      config: {
        strategy: "framework",
        focus: "conversion",
        targetOutcome: "leads",
        audienceLevel: "hot",
        length: "standard",
        ctaMode: "lead",
        scoreWeights: { judge: 0.8, heuristic: 0.2 }
      }
    }
  ],
  x: [
    {
      id: "x-viral-substance",
      label: "Viral com substância",
      description: "Thread forte com conflito, prova e progressão clara",
      config: {
        strategy: "provocative",
        focus: "contrarian",
        targetOutcome: "shares",
        audienceLevel: "cold",
        length: "standard",
        ctaMode: "share",
        scoreWeights: { judge: 0.84, heuristic: 0.16 }
      }
    },
    {
      id: "x-authority",
      label: "Autoridade técnica",
      description: "Ideias densas e aplicáveis para audiência qualificada",
      config: {
        strategy: "educational",
        focus: "authority",
        targetOutcome: "authority",
        audienceLevel: "warm",
        length: "long",
        ctaMode: "comment",
        scoreWeights: { judge: 0.81, heuristic: 0.19 }
      }
    }
  ]
};

const BASE_PROMPT_VARIABLE_HINTS: Array<{ key: string; description: string }> = [
  { key: "audience", description: "Publico alvo definido no brief estrategico." },
  { key: "goal", description: "Objetivo de negocio/comunicacao deste processamento." },
  { key: "tone", description: "Tom de escrita e postura editorial." },
  { key: "language", description: "Idioma principal de saida." },
  { key: "strategy", description: "Estrategia editorial escolhida para esta tarefa." },
  { key: "focus", description: "Foco editorial dominante da tarefa." },
  { key: "target_outcome", description: "Resultado principal esperado para o canal." },
  { key: "audience_level", description: "Nivel de consciencia do publico no funil." },
  { key: "length", description: "Intensidade/tamanho esperado da copy." },
  { key: "cta_mode", description: "Tipo de CTA esperado para o canal." },
  { key: "quality_mode", description: "Modo de qualidade global (standard ou max)." },
  { key: "quality_variations", description: "Quantidade alvo de variacoes por tarefa." },
  { key: "quality_refine_passes", description: "Quantidade alvo de passes de refinamento." },
  { key: "voice_identity", description: "Identidade de voz da marca." },
  { key: "voice_rules", description: "Regras de escrita da marca." },
  { key: "voice_banned_terms", description: "Termos proibidos na escrita." },
  { key: "voice_signature_phrases", description: "Assinaturas linguisticas desejadas." },
  { key: "performance_wins", description: "Padroes que performaram bem historicamente." },
  { key: "performance_avoid", description: "Padroes que devem ser evitados." },
  { key: "performance_kpi", description: "KPI principal para este canal." },
  { key: "performance_memory_json", description: "JSON da memoria de performance desta tarefa." },
  { key: "generation_profile_json", description: "JSON completo do brief estrategico." }
];

function cloneGenerationProfile(profile: GenerationProfile): GenerationProfile {
  return JSON.parse(JSON.stringify(profile)) as GenerationProfile;
}

const TASK_VARIABLE_HINTS: Record<AITask, Array<{ key: string; description: string }>> = {
  analysis: [
    ...BASE_PROMPT_VARIABLE_HINTS,
    {
      key: "evidence_map_json",
      description: "JSON com mapa de evidencias (numeros e trechos-fonte)."
    },
    {
      key: "evidence_map_excerpt",
      description: "Resumo textual do mapa de evidencias para grounding."
    },
    {
      key: "transcript_excerpt",
      description: "Trecho principal da transcricao para analise narrativa."
    }
  ],
  reels: [
    ...BASE_PROMPT_VARIABLE_HINTS,
    {
      key: "transcript_excerpt",
      description: "Trecho da transcricao para contexto editorial."
    },
    {
      key: "analysis_json",
      description: "Analise estruturada para guiar escolhas de hook e copy."
    },
    {
      key: "duration_sec",
      description: "Duracao estimada do video."
    },
    {
      key: "clips_context",
      description: "Mapa de cortes candidatos com indices e texto-fonte."
    },
    {
      key: "task_profile_json",
      description: "Resumo JSON da estrategia desta tarefa."
    },
    {
      key: "evidence_map_json",
      description: "JSON com mapa de evidencias para ancorar claims e numeros."
    },
    {
      key: "evidence_map_excerpt",
      description: "Resumo textual do mapa de evidencias."
    }
  ],
  newsletter: [
    ...BASE_PROMPT_VARIABLE_HINTS,
    {
      key: "transcript_excerpt",
      description: "Trecho base da transcricao."
    },
    {
      key: "analysis_json",
      description: "Analise narrativa com tese, temas e recomendacoes."
    },
    {
      key: "task_profile_json",
      description: "Resumo JSON da estrategia desta tarefa."
    },
    {
      key: "evidence_map_json",
      description: "JSON com mapa de evidencias para grounding editorial."
    },
    {
      key: "evidence_map_excerpt",
      description: "Resumo textual do mapa de evidencias."
    }
  ],
  linkedin: [
    ...BASE_PROMPT_VARIABLE_HINTS,
    {
      key: "transcript_excerpt",
      description: "Trecho base da transcricao."
    },
    {
      key: "analysis_json",
      description: "Analise narrativa para orientar angulo do post."
    },
    {
      key: "task_profile_json",
      description: "Resumo JSON da estrategia desta tarefa."
    },
    {
      key: "evidence_map_json",
      description: "JSON com mapa de evidencias para claims do post."
    },
    {
      key: "evidence_map_excerpt",
      description: "Resumo textual do mapa de evidencias."
    }
  ],
  x: [
    ...BASE_PROMPT_VARIABLE_HINTS,
    {
      key: "transcript_excerpt",
      description: "Trecho base da transcricao."
    },
    {
      key: "analysis_json",
      description: "Analise narrativa para orientar hooks e thread."
    },
    {
      key: "task_profile_json",
      description: "Resumo JSON da estrategia desta tarefa."
    },
    {
      key: "evidence_map_json",
      description: "JSON com mapa de evidencias para posts e thread."
    },
    {
      key: "evidence_map_excerpt",
      description: "Resumo textual do mapa de evidencias."
    }
  ]
};

type OpenRouterModelFamily = "top" | "claude" | "gemini" | "openai" | "deepseek" | "others";

const OPENROUTER_MODEL_FAMILIES: Array<{ key: OpenRouterModelFamily; label: string }> = [
  { key: "top", label: "Top" },
  { key: "claude", label: "Claude" },
  { key: "gemini", label: "Gemini" },
  { key: "openai", label: "OpenAI" },
  { key: "deepseek", label: "DeepSeek" },
  { key: "others", label: "Outros" }
];

const DEFAULT_MODEL_FAMILY_BY_TASK: Record<AITask, OpenRouterModelFamily> = {
  analysis: "top",
  reels: "top",
  newsletter: "top",
  linkedin: "top",
  x: "top"
};

function isCatalogProvider(provider: AIProvider): provider is "openai" | "openrouter" {
  return provider === "openai" || provider === "openrouter";
}

function badgeClass(status: string): string {
  if (status === "succeeded" || status === "parsed" || status === "done" || status === "ready") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "failed") {
    return "bg-red-100 text-red-700";
  }

  if (status === "running" || status === "processing" || status === "pending") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-100 text-slate-700";
}

function defaultModelByProvider(provider: AIProvider): string {
  if (provider === "openai") {
    return "gpt-5-mini";
  }

  if (provider === "openrouter") {
    return "openrouter/auto";
  }

  return "heuristic-v1";
}

function detectOpenRouterFamily(modelId: string): OpenRouterModelFamily {
  const id = modelId.toLowerCase();

  if (id === "openrouter/auto") {
    return "others";
  }

  if (id.startsWith("anthropic/claude")) {
    return "claude";
  }

  if (id.startsWith("google/gemini")) {
    return "gemini";
  }

  if (id.startsWith("openai/") || id.startsWith("o") || id.includes("/gpt-")) {
    return "openai";
  }

  if (id.startsWith("deepseek/") || id.includes("deepseek")) {
    return "deepseek";
  }

  return "others";
}

function modelPriorityScore(modelId: string): number {
  const id = modelId.toLowerCase();

  if (id === "openrouter/auto") return 0;
  if (id.includes("claude-sonnet-4.5")) return 1;
  if (id.includes("claude-opus")) return 2;
  if (id.includes("gemini-2.5-pro")) return 3;
  if (id.includes("gemini-2.5-flash")) return 4;
  if (id.includes("gpt-5.1")) return 5;
  if (id.includes("gpt-5-mini")) return 6;
  if (id.includes("gpt-5")) return 7;
  if (id.includes("deepseek-v3.2") || id.includes("deepseek-v3")) return 8;
  if (id.includes("deepseek-r1")) return 9;
  if (id.includes("llama-4")) return 10;
  if (id.includes("grok-4")) return 11;
  return 99;
}

function buildQuickPickModels(
  provider: "openai" | "openrouter",
  models: AIModelOption[],
  family: OpenRouterModelFamily
): AIModelOption[] {
  if (provider === "openrouter") {
    const source =
      family === "top" ? models : models.filter((model) => detectOpenRouterFamily(model.id) === family);

    return [...source]
      .sort((a, b) => {
        const score = modelPriorityScore(a.id) - modelPriorityScore(b.id);
        if (score !== 0) {
          return score;
        }
        return a.id.localeCompare(b.id);
      })
      .slice(0, 16);
  }

  const preferredKeys =
    provider === "openai"
      ? ["gpt-5.1", "gpt-5-mini", "gpt-5", "o4-mini", "gpt-4.1"]
      : [];

  const picked: AIModelOption[] = [];
  const seen = new Set<string>();

  for (const key of preferredKeys) {
    const match = models.find((model) => model.id.toLowerCase().includes(key));
    if (match && !seen.has(match.id)) {
      picked.push(match);
      seen.add(match.id);
    }
  }

  for (const model of models) {
    if (picked.length >= 12) {
      break;
    }
    if (!seen.has(model.id)) {
      picked.push(model);
      seen.add(model.id);
    }
  }

  return picked;
}

function applyProfilePreset(
  currentProfile: GenerationProfile,
  presetId: ProfilePresetId
): GenerationProfile {
  const next = cloneGenerationProfile(currentProfile);

  if (presetId === "growth") {
    next.goal = "Ganhar seguidores qualificados, elevar compartilhamentos e comentarios relevantes";
    next.tone = "Direto, energico e pragmatico";
    next.quality.mode = "max";
    next.quality.variationCount = Math.max(5, next.quality.variationCount);
    next.quality.refinePasses = Math.max(2, next.quality.refinePasses);
    next.tasks.reels.strategy = "provocative";
    next.tasks.reels.focus = "provocative";
    next.tasks.reels.targetOutcome = "followers";
    next.tasks.reels.length = "long";
    next.tasks.reels.ctaMode = "comment";
    next.tasks.linkedin.strategy = "contrarian";
    next.tasks.linkedin.focus = "authority";
    next.tasks.linkedin.targetOutcome = "comments";
    next.tasks.x.strategy = "provocative";
    next.tasks.x.focus = "contrarian";
    next.tasks.x.targetOutcome = "shares";
    return next;
  }

  if (presetId === "authority") {
    next.goal = "Construir autoridade premium com clareza, profundidade e aplicacao pratica";
    next.tone = "Senior, didatico e estrategico";
    next.quality.mode = "max";
    next.quality.variationCount = Math.max(4, next.quality.variationCount);
    next.quality.refinePasses = Math.max(2, next.quality.refinePasses);
    next.tasks.analysis.strategy = "framework";
    next.tasks.analysis.focus = "authority";
    next.tasks.newsletter.strategy = "educational";
    next.tasks.newsletter.focus = "framework";
    next.tasks.newsletter.targetOutcome = "authority";
    next.tasks.newsletter.length = "long";
    next.tasks.linkedin.strategy = "framework";
    next.tasks.linkedin.focus = "authority";
    next.tasks.linkedin.targetOutcome = "authority";
    next.tasks.reels.strategy = "educational";
    next.tasks.reels.focus = "educational";
    next.tasks.reels.targetOutcome = "followers";
    return next;
  }

  next.goal = "Gerar leads com conteudo de alta confianca e CTA acionavel";
  next.tone = "Consultivo, objetivo e comercial";
  next.quality.mode = "max";
  next.quality.variationCount = Math.max(4, next.quality.variationCount);
  next.quality.refinePasses = Math.max(2, next.quality.refinePasses);
  next.tasks.newsletter.strategy = "framework";
  next.tasks.newsletter.focus = "conversion";
  next.tasks.newsletter.targetOutcome = "leads";
  next.tasks.newsletter.ctaMode = "lead";
  next.tasks.linkedin.strategy = "educational";
  next.tasks.linkedin.focus = "conversion";
  next.tasks.linkedin.targetOutcome = "leads";
  next.tasks.linkedin.ctaMode = "lead";
  next.tasks.reels.strategy = "framework";
  next.tasks.reels.focus = "conversion";
  next.tasks.reels.targetOutcome = "comments";
  next.tasks.reels.ctaMode = "dm";
  next.tasks.x.strategy = "educational";
  next.tasks.x.focus = "conversion";
  next.tasks.x.targetOutcome = "leads";
  return next;
}

function timestampToMs(value: string): number {
  const match = value.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const millis = Number(match[4] ?? 0);
  return (((hours * 60 + minutes) * 60 + seconds) * 1000) + millis;
}

function clipDurationLabel(start: string, end: string): string {
  const deltaMs = Math.max(0, timestampToMs(end) - timestampToMs(start));
  const sec = Math.round(deltaMs / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }

  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

interface EditableBlockOption {
  path: string;
  label: string;
}

function tokenizePath(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const matcher = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(path)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
      continue;
    }
    tokens.push(Number(match[2] ?? 0));
  }

  return tokens;
}

function getByPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const token of tokenizePath(path)) {
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

function setByPath(root: unknown, path: string, value: unknown): boolean {
  if (!root || typeof root !== "object") {
    return false;
  }

  const tokens = tokenizePath(path);
  if (tokens.length === 0) {
    return false;
  }

  let current: unknown = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
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

function formatBlockValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      return value.join("\n");
    }
    return JSON.stringify(value, null, 2);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function parseEditedBlockValue(input: string, original: unknown): unknown {
  if (Array.isArray(original)) {
    if (original.every((item) => typeof item === "string")) {
      return input
        .split(/\n+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    try {
      return JSON.parse(input) as unknown;
    } catch {
      return original;
    }
  }

  if (typeof original === "number") {
    const num = Number(input);
    return Number.isFinite(num) ? num : original;
  }

  if (typeof original === "boolean") {
    if (/^(true|1|sim)$/i.test(input.trim())) {
      return true;
    }
    if (/^(false|0|nao)$/i.test(input.trim())) {
      return false;
    }
    return original;
  }

  if (original && typeof original === "object") {
    try {
      return JSON.parse(input) as unknown;
    } catch {
      return original;
    }
  }

  return input.trim();
}

function buildEditableBlocks(asset: GeneratedAsset | null): EditableBlockOption[] {
  if (!asset) {
    return [];
  }

  if (asset.type === "analysis") {
    const payload = asset.payload as AnalysisPayload;
    const list: EditableBlockOption[] = [
      { path: "thesis", label: "Tese principal" }
    ];
    if (payload.structure) {
      list.push(
        { path: "structure.problem", label: "Estrutura: problema" },
        { path: "structure.tension", label: "Estrutura: tensao" },
        { path: "structure.insight", label: "Estrutura: insight" },
        { path: "structure.application", label: "Estrutura: aplicacao" }
      );
    }
    payload.recommendations.forEach((_, idx) => {
      list.push({
        path: `recommendations[${idx}]`,
        label: `Recomendacao ${idx + 1}`
      });
    });
    return list;
  }

  if (asset.type === "reels") {
    const payload = asset.payload as ReelsPayload;
    const list: EditableBlockOption[] = [];
    payload.clips.forEach((_, idx) => {
      list.push(
        { path: `clips[${idx}].title`, label: `Clip ${idx + 1}: titulo` },
        { path: `clips[${idx}].caption`, label: `Clip ${idx + 1}: legenda` },
        { path: `clips[${idx}].hashtags`, label: `Clip ${idx + 1}: hashtags` },
        { path: `clips[${idx}].whyItWorks`, label: `Clip ${idx + 1}: racional` }
      );
    });
    return list;
  }

  if (asset.type === "newsletter") {
    const payload = asset.payload as NewsletterPayload;
    const list: EditableBlockOption[] = [
      { path: "headline", label: "Headline" },
      { path: "subheadline", label: "Subheadline" }
    ];
    payload.sections.forEach((section, idx) => {
      if (section.type === "application") {
        list.push({
          path: `sections[${idx}].bullets`,
          label: `Secao ${idx + 1}: bullets`
        });
      } else if ("title" in section) {
        list.push(
          { path: `sections[${idx}].title`, label: `Secao ${idx + 1}: titulo` },
          { path: `sections[${idx}].text`, label: `Secao ${idx + 1}: texto` }
        );
      } else {
        list.push({
          path: `sections[${idx}].text`,
          label: `Secao ${idx + 1}: texto`
        });
      }
    });
    return list;
  }

  if (asset.type === "linkedin") {
    const payload = asset.payload as LinkedinPayload;
    const list: EditableBlockOption[] = [
      { path: "hook", label: "Hook" },
      { path: "ctaQuestion", label: "CTA final" }
    ];
    payload.body.forEach((_, idx) => {
      list.push({ path: `body[${idx}]`, label: `Paragrafo ${idx + 1}` });
    });
    return list;
  }

  if (asset.type === "x") {
    const payload = asset.payload as XPostsPayload;
    const list: EditableBlockOption[] = [
      { path: "notes.style", label: "Nota de estilo" }
    ];
    payload.standalone.forEach((_, idx) => {
      list.push({ path: `standalone[${idx}]`, label: `Post avulso ${idx + 1}` });
    });
    payload.thread.forEach((_, idx) => {
      list.push({ path: `thread[${idx}]`, label: `Thread ${idx + 1}` });
    });
    return list;
  }

  return [];
}

function nextPromptVersionName(task: AITask, versions: PromptVersion[]): string {
  const highest = versions.length > 0 ? Math.max(...versions.map((item) => item.version)) : 0;
  return `${task}-v${highest + 1}`;
}

function formatAssetForCopy(asset: GeneratedAsset): string {
  return JSON.stringify(asset.payload, null, 2);
}

function formatDebugJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "null";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/d";
  }
  return `US$ ${value.toFixed(4)}`;
}

function formatDurationSeconds(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "n/d";
  }
  if (value < 60) {
    return `${Math.round(value)}s`;
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds}s`;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("pt-BR");
}

function resolveQualityScore(item: TaskGenerationDiagnostics): number {
  if (typeof item.qualityScore === "number" && Number.isFinite(item.qualityScore)) {
    return item.qualityScore;
  }
  return item.qualityFinal;
}

function resolvePublishabilityScore(item: TaskGenerationDiagnostics): number {
  if (typeof item.publishabilityScore === "number" && Number.isFinite(item.publishabilityScore)) {
    return item.publishabilityScore;
  }
  return item.judgeQualityScore;
}

function resolvePublishabilityThreshold(item: TaskGenerationDiagnostics): number {
  if (
    typeof item.publishabilityThreshold === "number" &&
    Number.isFinite(item.publishabilityThreshold)
  ) {
    return item.publishabilityThreshold;
  }
  return item.qualityThreshold;
}

function isTaskReadyForPublish(item: TaskGenerationDiagnostics): boolean {
  const qualityScore = resolveQualityScore(item);
  const publishabilityScore = resolvePublishabilityScore(item);
  const qualityOk =
    typeof item.meetsQualityThreshold === "boolean"
      ? item.meetsQualityThreshold
      : qualityScore >= item.qualityThreshold;
  const publishabilityOk =
    typeof item.meetsPublishabilityThreshold === "boolean"
      ? item.meetsPublishabilityThreshold
      : publishabilityScore >= resolvePublishabilityThreshold(item);
  return qualityOk && publishabilityOk;
}

function diagnosticIssuePool(item: TaskGenerationDiagnostics): string {
  const variantReasons = item.variants
    .map((variant) => variant.reason ?? "")
    .filter((value) => value.length > 0)
    .join(" | ");

  return [item.judgeSummary, item.fallbackReason, variantReasons]
    .filter((value) => value && value.length > 0)
    .join(" | ")
    .toLowerCase();
}

function buildActionableAlerts(item: TaskGenerationDiagnostics): Array<{
  level: "critical" | "warn";
  text: string;
}> {
  const alerts: Array<{ level: "critical" | "warn"; text: string }> = [];
  const issuePool = diagnosticIssuePool(item);
  const qualityScore = resolveQualityScore(item);
  const publishabilityScore = resolvePublishabilityScore(item);
  const publishabilityThreshold = resolvePublishabilityThreshold(item);

  if (qualityScore < item.qualityThreshold) {
    alerts.push({
      level: "critical",
      text: "Abaixo da meta de qualidade. Rode refine e ajuste estratégia/foco do canal."
    });
  }

  if (publishabilityScore < publishabilityThreshold) {
    alerts.push({
      level: "critical",
      text: "Abaixo da meta de publicacao. Revise clareza, aplicabilidade e CTA antes de marcar ready."
    });
  }

  if (
    issuePool.includes("numeric_claim_outside_source_hard") ||
    issuePool.includes("numeric_claim_outside_source_excessive")
  ) {
    alerts.push({
      level: "critical",
      text: "Muitos numeros fora do SRT. Reduza claims numericos ou use evidence-only."
    });
  } else if (
    issuePool.includes("numeric_claim_outside_source") ||
    issuePool.includes("ungrounded_numeric")
  ) {
    alerts.push({
      level: "warn",
      text: "Numero sem evidencia direta no SRT. Revise claims sensiveis."
    });
  } else if (issuePool.includes("numeric_claim_example_context")) {
    alerts.push({
      level: "warn",
      text: "Numero em contexto ilustrativo detectado. Se for factual, ancore no SRT."
    });
  }

  if (issuePool.includes("missing_proof_layer") || (item.judgeSubscores?.depth ?? 0) < 7) {
    alerts.push({
      level: "warn",
      text: "Faltou prova concreta. Inclua caso, metrica, percentual ou valor monetario."
    });
  }

  if (
    issuePool.includes("weak_intent") ||
    issuePool.includes("missing_cta_intent") ||
    issuePool.includes("ctaquestion: low_specificity") ||
    (item.judgeSubscores?.applicability ?? 0) < 7
  ) {
    alerts.push({
      level: "warn",
      text: "CTA genérico. Peça ação específica com contexto e métrica temporal."
    });
  }

  if (
    item.variants.length > 0 &&
    item.variants.every((variant) => variant.status !== "ok")
  ) {
    alerts.push({
      level: "critical",
      text: "Nenhuma variação válida por schema. Ajuste prompt e use modelo mais estável."
    });
  }

  if (item.usedHeuristicFallback) {
    alerts.push({
      level: "warn",
      text: "Fallback heurístico ativado. Verifique provider/modelo/chave para máxima qualidade."
    });
  }

  return alerts.slice(0, 4);
}

function buildJsonDiffLines(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
  limit = 220
): Array<{ left: string; right: string; changed: boolean }> {
  const leftLines = formatDebugJson(left).split("\n");
  const rightLines = formatDebugJson(right).split("\n");
  const max = Math.min(limit, Math.max(leftLines.length, rightLines.length));
  const rows: Array<{ left: string; right: string; changed: boolean }> = [];

  for (let idx = 0; idx < max; idx += 1) {
    const l = leftLines[idx] ?? "";
    const r = rightLines[idx] ?? "";
    rows.push({
      left: l,
      right: r,
      changed: l !== r
    });
  }

  return rows;
}

function AssetRenderer({ asset }: { asset: GeneratedAsset | null }) {
  if (!asset) {
    return (
      <p className="text-sm text-slate-600">
        Output ainda nao gerado para esta aba. Aguarde os jobs finalizarem.
      </p>
    );
  }

  if (asset.type === "analysis") {
    const payload = asset.payload as AnalysisPayload;
    return (
      <div className="space-y-2 text-sm text-slate-700">
        <p><strong>Tese:</strong> {payload.thesis}</p>
        <div>
          <p><strong>Topicos:</strong></p>
          {payload.topics.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {payload.topics.map((topic, idx) => (
                <li key={`analysis-topic-${idx}`} className="break-words">{topic}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">-</p>
          )}
        </div>
        <p>
          <strong>Tipo:</strong> {payload.contentType} | <strong>Polaridade:</strong> {payload.polarityScore}/10
        </p>
        <div>
          <strong>Recomendacoes:</strong>
          <ul className="mt-1 list-disc pl-5">
            {payload.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
        {payload.structure ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="font-semibold text-slate-900">Estrutura narrativa</p>
            <p className="mt-1"><strong>Problema:</strong> {payload.structure.problem}</p>
            <p className="mt-1"><strong>Tensao:</strong> {payload.structure.tension}</p>
            <p className="mt-1"><strong>Insight:</strong> {payload.structure.insight}</p>
            <p className="mt-1"><strong>Aplicacao:</strong> {payload.structure.application}</p>
          </div>
        ) : null}
        {payload.qualityScores ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-semibold text-slate-900">Scores editoriais</p>
            <p className="mt-1">
              insight density {payload.qualityScores.insightDensity.toFixed(1)} | standalone clarity{" "}
              {payload.qualityScores.standaloneClarity.toFixed(1)}
            </p>
            <p>
              polarity {payload.qualityScores.polarity.toFixed(1)} | practical value{" "}
              {payload.qualityScores.practicalValue.toFixed(1)}
            </p>
          </div>
        ) : null}
        {payload.retentionMoments && payload.retentionMoments.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-semibold text-slate-900">Momentos de retencao</p>
            <ul className="mt-1 list-disc pl-5">
              {payload.retentionMoments.map((moment, idx) => (
                <li key={`${moment.text}-${idx}`}>
                  <strong>{moment.type}:</strong> {moment.text} <span className="text-slate-500">({moment.whyItGrabs})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {payload.editorialAngles && payload.editorialAngles.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="font-semibold text-slate-900">Angulos editoriais</p>
            <ul className="mt-1 list-disc pl-5">
              {payload.editorialAngles.map((angle, idx) => (
                <li key={`${angle.angle}-${idx}`}>
                  <strong>{angle.idealChannel}/{angle.format}:</strong> {angle.angle}{" "}
                  <span className="text-slate-500">({angle.whyStronger})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {payload.weakSpots && payload.weakSpots.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="font-semibold text-amber-900">Pontos fracos detectados</p>
            <ul className="mt-1 list-disc pl-5 text-amber-900">
              {payload.weakSpots.map((spot, idx) => (
                <li key={`${spot.issue}-${idx}`}>
                  <strong>{spot.issue}:</strong> {spot.why}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  if (asset.type === "reels") {
    const payload = asset.payload as ReelsPayload;
    return (
      <div className="space-y-3">
        {payload.clips.map((clip, idx) => (
          <div
            key={`${clip.start}-${idx}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-900">{clip.title}</p>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                {clipDurationLabel(clip.start, clip.end)}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {clip.start} → {clip.end}
            </p>
            <p className="mt-3 whitespace-pre-line leading-relaxed">{clip.caption}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-4">
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                hook {clip.scores.hook}/10
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                clareza {clip.scores.clarity}/10
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                retencao {clip.scores.retention}/10
              </span>
              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                share {clip.scores.share}/10
              </span>
            </div>
            <p className="mt-3 text-xs text-slate-600">{clip.hashtags.join(" ")}</p>
            <p className="mt-2 text-xs text-slate-500">
              <strong>Racional:</strong> {clip.whyItWorks}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (asset.type === "newsletter") {
    const payload = asset.payload as NewsletterPayload;
    return (
      <div className="space-y-3 text-sm text-slate-700">
        <p className="text-base font-semibold text-slate-900">{payload.headline}</p>
        <p>{payload.subheadline}</p>
        {payload.sections.map((section, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">{section.type}</p>
            {section.type === "application" ? (
              <ul className="mt-2 list-disc pl-5">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : (
              <>
                {"title" in section ? <p className="mt-1 font-medium">{section.title}</p> : null}
                <p className="mt-1">{section.text}</p>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (asset.type === "linkedin") {
    const payload = asset.payload as LinkedinPayload;
    return (
      <div className="space-y-2 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">{payload.hook}</p>
        {payload.body.map((paragraph, idx) => (
          <p key={idx}>{paragraph}</p>
        ))}
        <p className="font-medium">{payload.ctaQuestion}</p>
      </div>
    );
  }

  if (asset.type === "x") {
    const payload = asset.payload as XPostsPayload;
    return (
      <div className="space-y-4 text-sm text-slate-700">
        <div>
          <p className="font-semibold text-slate-900">Posts avulsos</p>
          <ul className="mt-2 list-disc pl-5">
            {payload.standalone.map((post) => (
              <li key={post}>{post}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold text-slate-900">Thread</p>
          <ul className="mt-2 list-disc pl-5">
            {payload.thread.map((post) => (
              <li key={post}>{post}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
      {JSON.stringify(asset.payload, null, 2)}
    </pre>
  );
}

export function SrtWorkflow() {
  const [projectName, setProjectName] = useState("Authority Sprint 2");
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [srtId, setSrtId] = useState("");
  const [detail, setDetail] = useState<SrtDetailResponse | null>(null);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [diagnostics, setDiagnostics] = useState<TaskGenerationDiagnostics[]>([]);
  const [activeTab, setActiveTab] = useState<GeneratedAssetType>("analysis");
  const [diagnosticsTaskTab, setDiagnosticsTaskTab] = useState<AITask>("analysis");
  const [workspaceStage, setWorkspaceStage] = useState<WorkspaceStage>("models");
  const [resultsView, setResultsView] = useState<ResultsWorkspaceView>("overview");
  const [projects, setProjects] = useState<Project[]>([]);
  const [historyProjectId, setHistoryProjectId] = useState("");
  const [historyItems, setHistoryItems] = useState<ProjectHistoryItem[]>([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [generationProfile, setGenerationProfile] = useState<GenerationProfile>(
    cloneGenerationProfile(DEFAULT_GENERATION_PROFILE)
  );
  const [loadedProfileSrtId, setLoadedProfileSrtId] = useState("");
  const [preferencesUpdatedAt, setPreferencesUpdatedAt] = useState("");

  const [aiRouting, setAiRouting] = useState<AIRouting | null>(null);
  const [judgeRouting, setJudgeRouting] = useState<AIRouting | null>(null);
  const [configuredKeys, setConfiguredKeys] = useState({ openai: false, openrouter: false });
  const [aiModelCatalog, setAiModelCatalog] = useState<{
    openai: AIModelOption[];
    openrouter: AIModelOption[];
  }>({
    openai: [],
    openrouter: []
  });
  const [isLoadingModels, setIsLoadingModels] = useState<{
    openai: boolean;
    openrouter: boolean;
  }>({
    openai: false,
    openrouter: false
  });
  const [modelFamilyByTask, setModelFamilyByTask] = useState<OpenRouterModelFamilyByTask>(
    DEFAULT_MODEL_FAMILY_BY_TASK
  );
  const [promptCatalog, setPromptCatalog] = useState<PromptCatalog | null>(null);
  const [promptTask, setPromptTask] = useState<AITask>("analysis");
  const [inspectedPromptVersion, setInspectedPromptVersion] = useState<number | null>(null);
  const [newPromptName, setNewPromptName] = useState("");
  const [newSystemPrompt, setNewSystemPrompt] = useState("");
  const [newUserPromptTemplate, setNewUserPromptTemplate] = useState("");

  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingTxt, setIsExportingTxt] = useState(false);
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [isSavingRouting, setIsSavingRouting] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isApplyingProfile, setIsApplyingProfile] = useState(false);
  const [isRefiningAsset, setIsRefiningAsset] = useState(false);
  const [isSavingBlock, setIsSavingBlock] = useState(false);
  const [isRefiningBlock, setIsRefiningBlock] = useState(false);
  const [isSelectingVariant, setIsSelectingVariant] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [refineMessage, setRefineMessage] = useState("");
  const [refineInstruction, setRefineInstruction] = useState("");
  const [blockMessage, setBlockMessage] = useState("");
  const [selectedBlockPath, setSelectedBlockPath] = useState("");
  const [selectedBlockAction, setSelectedBlockAction] = useState<AssetRefineAction>("improve");
  const [blockDraft, setBlockDraft] = useState("");
  const [routingMessage, setRoutingMessage] = useState("");
  const [promptMessage, setPromptMessage] = useState("");
  const [modelsMessage, setModelsMessage] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [historyMessage, setHistoryMessage] = useState("");
  const [variantActionMessage, setVariantActionMessage] = useState("");
  const [variantCompareLeft, setVariantCompareLeft] = useState<number | null>(null);
  const [variantCompareRight, setVariantCompareRight] = useState<number | null>(null);

  const applyPreferencesToWorkspace = (response: AIPreferencesResponse) => {
    setGenerationProfile(cloneGenerationProfile(response.preferences.generationProfile));
    setModelFamilyByTask({
      ...DEFAULT_MODEL_FAMILY_BY_TASK,
      ...response.preferences.modelFamilyByTask
    });
    setPreferencesUpdatedAt(response.updatedAt);
  };

  useEffect(() => {
    let mounted = true;

    const loadWorkspaceSetup = async () => {
      try {
        const [routingResponse, promptsResponse, preferencesResponse, projectsResponse] = await Promise.all([
          getAiRouting(),
          getAiPrompts(),
          getAiPreferences(),
          getProjects()
        ]);
        if (!mounted) {
          return;
        }

        setAiRouting(routingResponse.routing);
        setJudgeRouting(routingResponse.judgeRouting);
        setConfiguredKeys(routingResponse.configuredKeys);
        setPromptCatalog(promptsResponse.prompts);
        applyPreferencesToWorkspace(preferencesResponse);
        setProjects(projectsResponse);

        const nextHistoryProjectId = projectsResponse[0]?.id ?? "";
        setHistoryProjectId(nextHistoryProjectId);

        const providers = new Set<"openai" | "openrouter">();
        for (const task of AI_TASKS) {
          const generationProvider = routingResponse.routing[task.key].provider;
          const judgeProvider = routingResponse.judgeRouting[task.key].provider;
          if (isCatalogProvider(generationProvider)) {
            providers.add(generationProvider);
          }
          if (isCatalogProvider(judgeProvider)) {
            providers.add(judgeProvider);
          }
        }

        await Promise.all([...providers].map((provider) => loadModelCatalog(provider)));

        const activePrompt =
          promptsResponse.prompts[promptTask].versions.find(
            (version) => version.version === promptsResponse.prompts[promptTask].activeVersion
          ) ?? promptsResponse.prompts[promptTask].versions[0];

        if (activePrompt) {
          setNewPromptName(
            nextPromptVersionName(promptTask, promptsResponse.prompts[promptTask].versions)
          );
          setNewSystemPrompt(activePrompt.systemPrompt);
          setNewUserPromptTemplate(activePrompt.userPromptTemplate);
          setInspectedPromptVersion(activePrompt.version);
        }
      } catch (err) {
        if (!mounted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Falha ao carregar configuracao de IA");
      }
    };

    loadWorkspaceSetup();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!historyProjectId) {
      setHistoryItems([]);
      return;
    }

    let active = true;
    setIsLoadingHistory(true);

    getProjectHistory(historyProjectId)
      .then((response) => {
        if (!active) {
          return;
        }
        setHistoryItems(response.items);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setHistoryMessage(err instanceof Error ? err.message : "Falha ao carregar historico.");
      })
      .finally(() => {
        if (!active) {
          return;
        }
        setIsLoadingHistory(false);
      });

    return () => {
      active = false;
    };
  }, [historyProjectId]);

  useEffect(() => {
    if (!srtId) {
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        const [nextDetail, nextJobs, nextAssets, nextDiagnostics] = await Promise.all([
          getSrtDetail(srtId),
          getSrtJobs(srtId),
          getSrtAssets(srtId),
          getSrtDiagnostics(srtId).catch(() => ({ diagnostics: [] }))
        ]);

        if (!active) {
          return;
        }

        setDetail(nextDetail);
        setJobs(nextJobs.jobs);
        setAssets(nextAssets.assets);
        setDiagnostics(nextDiagnostics.diagnostics);
        if (loadedProfileSrtId !== nextDetail.asset.id) {
          setGenerationProfile(cloneGenerationProfile(nextDetail.asset.generationProfile));
          setLoadedProfileSrtId(nextDetail.asset.id);
        }
      } catch (err) {
        if (!active) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to refresh status");
      }
    };

    refresh();

    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadedProfileSrtId, srtId]);

  const canUpload = useMemo(
    () => Boolean(projectId) && Boolean(file) && !isUploading,
    [projectId, file, isUploading]
  );

  const activeAsset = useMemo(
    () => assets.find((asset) => asset.type === activeTab) ?? null,
    [assets, activeTab]
  );

  const canRefineActiveTab = useMemo(
    () => REFINABLE_ASSET_TYPES.includes(activeTab),
    [activeTab]
  );

  const editableBlocks = useMemo(
    () => buildEditableBlocks(activeAsset),
    [activeAsset]
  );

  useEffect(() => {
    if (!activeAsset || editableBlocks.length === 0) {
      setSelectedBlockPath("");
      setBlockDraft("");
      return;
    }

    const hasCurrent = editableBlocks.some((item) => item.path === selectedBlockPath);
    const nextPath = hasCurrent ? selectedBlockPath : editableBlocks[0]?.path ?? "";
    const value = nextPath ? getByPath(activeAsset.payload, nextPath) : "";
    setSelectedBlockPath(nextPath);
    setBlockDraft(formatBlockValue(value));
  }, [activeAsset, editableBlocks, selectedBlockPath]);

  const diagnosticsByTask = useMemo(() => {
    const map = new Map<AITask, TaskGenerationDiagnostics>();
    for (const item of diagnostics) {
      map.set(item.task, item);
    }
    return map;
  }, [diagnostics]);

  useEffect(() => {
    if (diagnosticsByTask.size === 0 || diagnosticsByTask.has(diagnosticsTaskTab)) {
      return;
    }

    const firstTask = AI_TASKS.find((task) => diagnosticsByTask.has(task.key));
    if (firstTask) {
      setDiagnosticsTaskTab(firstTask.key);
    }
  }, [diagnosticsByTask, diagnosticsTaskTab]);

  const diagnosticsTaskDetail = useMemo(
    () => diagnosticsByTask.get(diagnosticsTaskTab) ?? null,
    [diagnosticsByTask, diagnosticsTaskTab]
  );

  useEffect(() => {
    if (!diagnosticsTaskDetail) {
      setVariantCompareLeft(null);
      setVariantCompareRight(null);
      return;
    }

    const validVariants = diagnosticsTaskDetail.variants.filter(
      (variant) => variant.normalizedOutput
    );
    if (validVariants.length === 0) {
      setVariantCompareLeft(null);
      setVariantCompareRight(null);
      return;
    }

    const selected =
      validVariants.find((variant) => variant.selected) ??
      validVariants[0];
    const second =
      validVariants.find((variant) => variant.variant !== selected.variant) ?? selected;

    setVariantCompareLeft(selected.variant);
    setVariantCompareRight(second.variant);
  }, [diagnosticsTaskDetail?.task, diagnosticsTaskDetail?.updatedAt]);

  const compareVariantLeftDetail = useMemo(() => {
    if (!diagnosticsTaskDetail || variantCompareLeft === null) {
      return null;
    }
    return (
      diagnosticsTaskDetail.variants.find((variant) => variant.variant === variantCompareLeft) ??
      null
    );
  }, [diagnosticsTaskDetail, variantCompareLeft]);

  const compareVariantRightDetail = useMemo(() => {
    if (!diagnosticsTaskDetail || variantCompareRight === null) {
      return null;
    }
    return (
      diagnosticsTaskDetail.variants.find((variant) => variant.variant === variantCompareRight) ??
      null
    );
  }, [diagnosticsTaskDetail, variantCompareRight]);

  const compareDiffRows = useMemo(
    () =>
      buildJsonDiffLines(
        compareVariantLeftDetail?.normalizedOutput ?? null,
        compareVariantRightDetail?.normalizedOutput ?? null
      ),
    [compareVariantLeftDetail, compareVariantRightDetail]
  );

  const selectedPromptTask = useMemo(
    () => (promptCatalog ? promptCatalog[promptTask] : null),
    [promptCatalog, promptTask]
  );

  const promptVersionsSorted = useMemo(
    () =>
      selectedPromptTask
        ? [...selectedPromptTask.versions].sort((a, b) => b.version - a.version)
        : [],
    [selectedPromptTask]
  );

  const inspectedPrompt = useMemo(() => {
    if (!selectedPromptTask || selectedPromptTask.versions.length === 0) {
      return null;
    }

    if (inspectedPromptVersion !== null) {
      const target = selectedPromptTask.versions.find(
        (version) => version.version === inspectedPromptVersion
      );
      if (target) {
        return target;
      }
    }

    return (
      selectedPromptTask.versions.find(
        (version) => version.version === selectedPromptTask.activeVersion
      ) ?? selectedPromptTask.versions[0]
    );
  }, [selectedPromptTask, inspectedPromptVersion]);

  const commandCenter = useMemo(() => {
    const totalTasks = AI_TASKS.length;
    const passedTasks = diagnostics.filter((item) => isTaskReadyForPublish(item)).length;
    const fallbackTasks = diagnostics.filter((item) => item.usedHeuristicFallback).length;
    const readyAssets = assets.filter((asset) => asset.status === "ready").length;
    const totalEstimatedCost = diagnostics.reduce(
      (sum, item) => sum + (item.estimatedCostUsd ?? 0),
      0
    );
    const totalActualCost = diagnostics.reduce(
      (sum, item) => sum + (item.actualCostUsd ?? 0),
      0
    );
    const totalTokens = diagnostics.reduce(
      (sum, item) => sum + (item.totalTokens ?? 0),
      0
    );
    const providersConnected =
      Number(configuredKeys.openai) + Number(configuredKeys.openrouter);

    const steps = [
      {
        id: "models",
        label: "Modelos",
        done: providersConnected > 0
      },
      {
        id: "prompts",
        label: "Prompts",
        done: Boolean(promptCatalog)
      },
      {
        id: "guidelines",
        label: "Diretrizes",
        done: Boolean(generationProfile.goal.trim()) && Boolean(generationProfile.tone.trim())
      },
      {
        id: "project",
        label: "Projeto",
        done: Boolean(projectId) && Boolean(srtId)
      },
      {
        id: "results",
        label: "Resultados",
        done: readyAssets > 0 || diagnostics.length > 0
      }
    ];

    const completedSteps = steps.filter((step) => step.done).length;
    return {
      totalTasks,
      passedTasks,
      fallbackTasks,
      readyAssets,
      totalEstimatedCost,
      totalActualCost,
      totalTokens,
      providersConnected,
      steps,
      completedSteps
    };
  }, [
    assets,
    configuredKeys.openai,
    configuredKeys.openrouter,
    diagnostics,
    generationProfile.goal,
    generationProfile.tone,
    projectId,
    promptCatalog,
    srtId
  ]);

  const pipelineSummary = useMemo(() => {
    const baseJobs = [
      "parse_srt",
      "analyze_narrative",
      "generate_reels",
      "generate_newsletter",
      "generate_linkedin",
      "generate_x_posts"
    ];
    const succeeded = new Set(
      jobs.filter((job) => job.status === "succeeded").map((job) => job.name)
    );
    const failed = jobs.some(
      (job) => baseJobs.includes(job.name) && job.status === "failed"
    );
    const runningJob =
      jobs.find((job) => job.status === "running") ??
      detail?.latestJob ??
      null;
    const completedBaseSteps = baseJobs.filter((name) => succeeded.has(name)).length;
    const progressPct = Math.max(
      0,
      Math.min(100, Math.round((completedBaseSteps / baseJobs.length) * 100))
    );
    const readyTasks = diagnostics.filter((item) => isTaskReadyForPublish(item)).length;

    return {
      baseJobs,
      completedBaseSteps,
      progressPct,
      failed,
      runningJob,
      readyTasks
    };
  }, [detail?.latestJob, diagnostics, jobs]);

  const resultsTaskRows = useMemo(() => {
    return AI_TASKS.map((task) => {
      const diagnosticsItem = diagnosticsByTask.get(task.key) ?? null;
      const asset = assets.find((item) => item.type === (task.key as GeneratedAssetType)) ?? null;
      const qualityScore = diagnosticsItem ? resolveQualityScore(diagnosticsItem) : 0;
      const publishabilityScore = diagnosticsItem ? resolvePublishabilityScore(diagnosticsItem) : 0;
      const publishabilityThreshold = diagnosticsItem
        ? resolvePublishabilityThreshold(diagnosticsItem)
        : 0;
      const ready = diagnosticsItem ? isTaskReadyForPublish(diagnosticsItem) : false;
      const allVariantsFailed =
        diagnosticsItem !== null &&
        diagnosticsItem.variants.length > 0 &&
        diagnosticsItem.variants.every((variant) => variant.status !== "ok");

      const lane: "ready" | "tune" | "blocked" | "waiting" = !diagnosticsItem
        ? "waiting"
        : allVariantsFailed
          ? "blocked"
          : ready
            ? "ready"
            : "tune";

      const alerts = diagnosticsItem ? buildActionableAlerts(diagnosticsItem) : [];

      return {
        task,
        diagnosticsItem,
        asset,
        qualityScore,
        publishabilityScore,
        publishabilityThreshold,
        ready,
        lane,
        alerts,
        allVariantsFailed
      };
    }).sort((left, right) => right.publishabilityScore - left.publishabilityScore);
  }, [assets, diagnosticsByTask]);

  const resultsLaneSummary = useMemo(() => {
    const laneOrder: Array<"ready" | "tune" | "blocked" | "waiting"> = [
      "ready",
      "tune",
      "blocked",
      "waiting"
    ];
    const laneLabel: Record<(typeof laneOrder)[number], string> = {
      ready: "Pronto para publicar",
      tune: "Precisa ajustar",
      blocked: "Bloqueado por qualidade/schema",
      waiting: "Aguardando execucao"
    };
    const laneTone: Record<(typeof laneOrder)[number], string> = {
      ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
      tune: "border-amber-200 bg-amber-50 text-amber-800",
      blocked: "border-red-200 bg-red-50 text-red-800",
      waiting: "border-slate-200 bg-slate-50 text-slate-700"
    };

    return laneOrder.map((lane) => ({
      lane,
      label: laneLabel[lane],
      tone: laneTone[lane],
      items: resultsTaskRows.filter((row) => row.lane === lane)
    }));
  }, [resultsTaskRows]);

  const workspaceStageIndex = useMemo(
    () => WORKSPACE_STAGES.findIndex((stage) => stage.key === workspaceStage),
    [workspaceStage]
  );

  const workspaceStageMeta = useMemo(
    () => WORKSPACE_STAGES[Math.max(0, workspaceStageIndex)] ?? WORKSPACE_STAGES[0],
    [workspaceStageIndex]
  );

  const workspaceStageCompletion = useMemo<Record<WorkspaceStage, boolean>>(
    () => ({
      models: commandCenter.providersConnected > 0,
      prompts: Boolean(promptCatalog),
      guidelines: Boolean(generationProfile.goal.trim()) && Boolean(generationProfile.tone.trim()),
      project: Boolean(projectId) && Boolean(srtId),
      results: commandCenter.readyAssets > 0 || diagnostics.length > 0
    }),
    [
      commandCenter.providersConnected,
      commandCenter.readyAssets,
      diagnostics.length,
      generationProfile.goal,
      generationProfile.tone,
      projectId,
      promptCatalog,
      srtId
    ]
  );

  const workspaceCompletedStages = useMemo(
    () => Object.values(workspaceStageCompletion).filter(Boolean).length,
    [workspaceStageCompletion]
  );

  const workflowMode = useMemo<WorkflowMode>(() => {
    if (workspaceStage === "models" || workspaceStage === "prompts" || workspaceStage === "guidelines") {
      return "setup";
    }
    if (workspaceStage === "project") {
      return "create";
    }
    if (workspaceStage === "results" && resultsView === "overview") {
      return "generate";
    }
    return "review";
  }, [resultsView, workspaceStage]);

  const workflowModeCompletion = useMemo<Record<WorkflowMode, boolean>>(
    () => ({
      setup:
        workspaceStageCompletion.models &&
        workspaceStageCompletion.prompts &&
        workspaceStageCompletion.guidelines,
      create: workspaceStageCompletion.project,
      generate: Boolean(srtId) && jobs.length > 0,
      review: workspaceStageCompletion.results
    }),
    [jobs.length, srtId, workspaceStageCompletion]
  );

  const nextGuidedAction = useMemo(() => {
    if (!workspaceStageCompletion.models) {
      return "Conecte pelo menos um provider de IA e salve o roteamento.";
    }
    if (!workspaceStageCompletion.prompts) {
      return "Revise os prompts ativos para cada canal antes de gerar.";
    }
    if (!workspaceStageCompletion.guidelines) {
      return "Defina objetivo, tom e diretrizes para reduzir output generico.";
    }
    if (!workspaceStageCompletion.project) {
      return "Crie o projeto e envie o arquivo SRT/TXT para iniciar.";
    }
    if (!workspaceStageCompletion.results) {
      return "Acompanhe o pipeline em Results e rode refino quando ficar abaixo da meta.";
    }
    return "Pipeline pronto. Revise no Content Studio e exporte para publicação.";
  }, [workspaceStageCompletion]);

  const nextWorkflowMode = useMemo<WorkflowMode>(() => {
    return WORKFLOW_MODES.find((mode) => !workflowModeCompletion[mode.key])?.key ?? "review";
  }, [workflowModeCompletion]);

  const nextWorkflowModeLabel = useMemo(() => {
    return WORKFLOW_MODES.find((mode) => mode.key === nextWorkflowMode)?.label ?? "Review";
  }, [nextWorkflowMode]);

  const workspaceCompletionPct = useMemo(
    () =>
      Math.max(
        0,
        Math.min(100, Math.round((workspaceCompletedStages / WORKSPACE_STAGES.length) * 100))
      ),
    [workspaceCompletedStages]
  );

  const canGoPrevStage = workspaceStageIndex > 0;
  const canGoNextStage = workspaceStageIndex < WORKSPACE_STAGES.length - 1;

  const moveWorkspaceStage = (direction: -1 | 1) => {
    const nextIndex = workspaceStageIndex + direction;
    if (nextIndex < 0 || nextIndex >= WORKSPACE_STAGES.length) {
      return;
    }
    setWorkspaceStage(WORKSPACE_STAGES[nextIndex].key);
  };

  const jumpToWorkflowMode = (mode: WorkflowMode) => {
    if (mode === "setup") {
      setWorkspaceStage("models");
      return;
    }
    if (mode === "create") {
      setWorkspaceStage("project");
      return;
    }
    if (mode === "generate") {
      setWorkspaceStage("results");
      setResultsView("overview");
      return;
    }
    setWorkspaceStage("results");
    setResultsView("quality");
  };

  const loadModelCatalog = async (
    provider: "openai" | "openrouter",
    forceRefresh = false
  ) => {
    setIsLoadingModels((current) => ({ ...current, [provider]: true }));

    try {
      const response = await getAiModels(provider, forceRefresh);
      setAiModelCatalog((current) => ({
        ...current,
        [provider]: response.models
      }));

      if (forceRefresh) {
        setModelsMessage(
          `${provider} atualizado (${response.models.length} modelos, fonte: ${response.source}).`
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Falha ao carregar modelos";
      setModelsMessage(reason);
    } finally {
      setIsLoadingModels((current) => ({ ...current, [provider]: false }));
    }
  };

  const modelSuggestionsForRoute = (route: AIRoute | undefined): AIModelOption[] => {
    if (!route || !isCatalogProvider(route.provider)) {
      return [];
    }

    const list = aiModelCatalog[route.provider];
    if (list.some((item) => item.id === route.model)) {
      return list;
    }

    if (!route.model.trim()) {
      return list;
    }

    return [
      {
        id: route.model,
        name: `${route.model} (manual)`,
        provider: route.provider,
        contextLength: null,
        description: null
      },
      ...list
    ];
  };

  const handleProfileFieldChange = (
    field: keyof Pick<GenerationProfile, "audience" | "goal" | "tone" | "language">,
    value: string
  ) => {
    setGenerationProfile((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleTaskProfileChange = <K extends keyof GenerationProfile["tasks"][AITask]>(
    task: AITask,
    field: K,
    value: GenerationProfile["tasks"][AITask][K]
  ) => {
    setGenerationProfile((current) => ({
      ...current,
      tasks: {
        ...current.tasks,
        [task]: {
          ...current.tasks[task],
          [field]: value
        }
      }
    }));
  };

  const handleTaskScoreWeightChange = (
    task: AITask,
    field: "judge" | "heuristic",
    value: number
  ) => {
    const bounded = Number.isFinite(value) ? Math.max(0.05, Math.min(0.95, value)) : 0.5;
    setGenerationProfile((current) => ({
      ...current,
      tasks: {
        ...current.tasks,
        [task]: {
          ...current.tasks[task],
          scoreWeights: {
            ...current.tasks[task].scoreWeights,
            [field]: Number(bounded.toFixed(2))
          }
        }
      }
    }));
  };

  const handleApplyTaskChannelPreset = (task: AITask, presetId: string) => {
    const preset = TASK_CHANNEL_PRESETS[task].find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    setGenerationProfile((current) => ({
      ...current,
      tasks: {
        ...current.tasks,
        [task]: JSON.parse(JSON.stringify(preset.config)) as GenerationProfile["tasks"][AITask]
      }
    }));

    setProfileMessage(`Preset aplicado em ${task}: ${preset.label}.`);
    window.setTimeout(() => setProfileMessage(""), 2400);
  };

  const handleQualityChange = <K extends keyof GenerationProfile["quality"]>(
    field: K,
    value: GenerationProfile["quality"][K]
  ) => {
    setGenerationProfile((current) => ({
      ...current,
      quality: {
        ...current.quality,
        [field]: value
      }
    }));
  };

  const handleVoiceChange = <K extends keyof GenerationProfile["voice"]>(
    field: K,
    value: GenerationProfile["voice"][K]
  ) => {
    setGenerationProfile((current) => ({
      ...current,
      voice: {
        ...current.voice,
        [field]: value
      }
    }));
  };

  const handlePerformanceMemoryChange = (
    task: AITask,
    field: keyof GenerationProfile["performanceMemory"][AITask],
    value: string
  ) => {
    setGenerationProfile((current) => ({
      ...current,
      performanceMemory: {
        ...current.performanceMemory,
        [task]: {
          ...current.performanceMemory[task],
          [field]: value
        }
      }
    }));
  };

  const handleResetGenerationProfile = () => {
    setGenerationProfile(cloneGenerationProfile(DEFAULT_GENERATION_PROFILE));
    setProfileMessage("Brief resetado para padrao.");
    window.setTimeout(() => setProfileMessage(""), 2200);
  };

  const handleApplyProfilePreset = (presetId: ProfilePresetId) => {
    setGenerationProfile((current) => applyProfilePreset(current, presetId));
    setProfileMessage(`Preset aplicado: ${PROFILE_PRESETS.find((item) => item.id === presetId)?.label ?? presetId}.`);
    window.setTimeout(() => setProfileMessage(""), 2600);
  };

  const handleApplyProfileToCurrentSrt = async () => {
    if (!srtId) {
      return;
    }

    setProfileMessage("");
    setIsApplyingProfile(true);

    try {
      const response = await updateSrtGenerationProfile(srtId, generationProfile, true);
      setGenerationProfile(cloneGenerationProfile(response.asset.generationProfile));
      setDetail((current) => (current ? { ...current, asset: response.asset } : current));
      setWorkspaceStage("results");
      setResultsView("overview");
      setProfileMessage("Profile aplicado e reprocessamento enfileirado.");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Falha ao aplicar profile.");
    } finally {
      setIsApplyingProfile(false);
      window.setTimeout(() => setProfileMessage(""), 2600);
    }
  };

  const handleCreateProject = async () => {
    setError("");
    setIsCreatingProject(true);

    try {
      const project = await createProject(projectName.trim());
      setProjectId(project.id);
      setProjects((current) => [
        project,
        ...current.filter((item) => item.id !== project.id)
      ]);
      setHistoryProjectId(project.id);
      setHistoryItems([]);
      setWorkspaceStage("project");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleUpload = async () => {
    if (!projectId || !file) {
      return;
    }

    setError("");
    setCopyMessage("");
    setProfileMessage("");
    setAssets([]);
    setDiagnostics([]);
    setIsUploading(true);

    try {
      const response = await uploadSrt(projectId, file, {
        generationProfile
      });
      setSrtId(response.srtAssetId);
      setLoadedProfileSrtId("");
      setHistoryProjectId(projectId);
      void refreshProjectsAndHistory(projectId);
      setWorkspaceStage("results");
      setResultsView("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyActiveAsset = async () => {
    if (!activeAsset) {
      return;
    }

    setCopyMessage("");
    setIsCopying(true);

    try {
      await navigator.clipboard.writeText(formatAssetForCopy(activeAsset));
      setCopyMessage("Conteudo copiado.");
    } catch {
      setCopyMessage("Falha ao copiar no clipboard.");
    } finally {
      setIsCopying(false);
      window.setTimeout(() => setCopyMessage(""), 2000);
    }
  };

  const handleExportPdf = async () => {
    if (!srtId) {
      return;
    }

    setExportMessage("");
    setIsExportingPdf(true);

    try {
      const blob = await downloadSrtPdfExport(srtId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName =
        detail?.asset.filename?.replace(/\.[^/.]+$/, "") ??
        `authority-${srtId.slice(0, 8)}`;
      link.href = url;
      link.download = `${baseName}-authority-export.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportMessage("PDF exportado com sucesso.");
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao exportar PDF.");
    } finally {
      setIsExportingPdf(false);
      window.setTimeout(() => setExportMessage(""), 3000);
    }
  };

  const handleExportTxt = async () => {
    if (!srtId) {
      return;
    }

    setExportMessage("");
    setIsExportingTxt(true);

    try {
      const blob = await downloadSrtTxtExport(srtId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName =
        detail?.asset.filename?.replace(/\.[^/.]+$/, "") ??
        `authority-${srtId.slice(0, 8)}`;
      link.href = url;
      link.download = `${baseName}-authority-export.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportMessage("TXT exportado com sucesso.");
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao exportar TXT.");
    } finally {
      setIsExportingTxt(false);
      window.setTimeout(() => setExportMessage(""), 3000);
    }
  };

  const handleExportMarkdown = async () => {
    if (!srtId) {
      return;
    }

    setExportMessage("");
    setIsExportingMarkdown(true);

    try {
      const blob = await downloadSrtMarkdownExport(srtId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName =
        detail?.asset.filename?.replace(/\.[^/.]+$/, "") ??
        `authority-${srtId.slice(0, 8)}`;
      link.href = url;
      link.download = `${baseName}-authority-export.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportMessage("Markdown exportado com sucesso.");
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Falha ao exportar Markdown.");
    } finally {
      setIsExportingMarkdown(false);
      window.setTimeout(() => setExportMessage(""), 3000);
    }
  };

  const handleRefineActiveAsset = async (action: AssetRefineAction) => {
    if (!srtId || !canRefineActiveTab) {
      return;
    }

    setRefineMessage("");
    setIsRefiningAsset(true);

    try {
      await refineSrtAsset(srtId, activeTab, action, refineInstruction);
      setRefineMessage(`Refino enfileirado: ${action}. Aguarde alguns segundos para a nova versao.`);
    } catch (err) {
      setRefineMessage(err instanceof Error ? err.message : "Falha ao enfileirar refino.");
    } finally {
      setIsRefiningAsset(false);
      window.setTimeout(() => setRefineMessage(""), 3200);
    }
  };

  const handleChangeSelectedBlockPath = (path: string) => {
    if (!activeAsset) {
      return;
    }

    setSelectedBlockPath(path);
    const value = getByPath(activeAsset.payload, path);
    setBlockDraft(formatBlockValue(value));
  };

  const handleSaveSelectedBlock = async () => {
    if (!srtId || !activeAsset || !selectedBlockPath) {
      return;
    }

    setBlockMessage("");
    setIsSavingBlock(true);
    try {
      const currentValue = getByPath(activeAsset.payload, selectedBlockPath);
      const parsedValue = parseEditedBlockValue(blockDraft, currentValue);
      const nextPayload = clonePayload(activeAsset.payload as GeneratedAssetPayload);
      const applied = setByPath(nextPayload, selectedBlockPath, parsedValue);
      if (!applied) {
        throw new Error("Bloco selecionado nao foi encontrado.");
      }

      const response = await saveSrtAssetManual(srtId, activeTab, nextPayload);
      setAssets((current) => [
        response.asset,
        ...current.filter((item) => item.id !== response.asset.id)
      ]);
      setBlockMessage("Bloco salvo em nova versao manual.");
    } catch (err) {
      setBlockMessage(err instanceof Error ? err.message : "Falha ao salvar bloco.");
    } finally {
      setIsSavingBlock(false);
      window.setTimeout(() => setBlockMessage(""), 3000);
    }
  };

  const handleRefineSelectedBlock = async (evidenceOnly = false) => {
    if (!srtId || !activeAsset || !selectedBlockPath) {
      return;
    }

    setBlockMessage("");
    setIsRefiningBlock(true);
    try {
      await refineSrtAssetBlock(
        srtId,
        activeTab,
        selectedBlockPath,
        selectedBlockAction,
        refineInstruction,
        evidenceOnly
      );
      setBlockMessage(
        evidenceOnly
          ? "Regeneracao evidence-only enfileirada. Aguarde nova versao."
          : "Regeneracao do bloco enfileirada. Aguarde nova versao."
      );
    } catch (err) {
      setBlockMessage(err instanceof Error ? err.message : "Falha ao regenerar bloco.");
    } finally {
      setIsRefiningBlock(false);
      window.setTimeout(() => setBlockMessage(""), 3200);
    }
  };

  const handleSelectVariant = async (task: AITask, variant: number) => {
    if (!srtId) {
      return;
    }

    setVariantActionMessage("");
    setIsSelectingVariant(true);

    try {
      const response = await selectSrtAssetVariant(srtId, task, variant);
      setAssets((current) => [
        response.asset,
        ...current.filter((item) => item.id !== response.asset.id)
      ]);
      setDiagnostics((current) =>
        current.map((item) =>
          item.task === task
            ? {
                ...item,
                selectedVariant: variant,
                variants: item.variants.map((entry) => ({
                  ...entry,
                  selected: entry.variant === variant
                }))
              }
            : item
        )
      );
      setVariantActionMessage(`Variacao v${variant} aplicada como output oficial de ${task}.`);
    } catch (err) {
      setVariantActionMessage(err instanceof Error ? err.message : "Falha ao aplicar variacao.");
    } finally {
      setIsSelectingVariant(false);
      window.setTimeout(() => setVariantActionMessage(""), 3200);
    }
  };

  const handleRoutingChange = <K extends keyof AIRouting[AITask]>(
    kind: "generation" | "judge",
    task: AITask,
    field: K,
    value: AIRouting[AITask][K]
  ) => {
    const setter = kind === "generation" ? setAiRouting : setJudgeRouting;
    setter((current) => {
      if (!current) {
        return current;
      }

      const nextRoute = {
        ...current[task],
        [field]: value
      };

      if (field === "provider") {
        nextRoute.model = defaultModelByProvider(value as AIProvider);
      }

      return {
        ...current,
        [task]: nextRoute
      };
    });

    if (field === "provider") {
      const nextProvider = value as AIProvider;
      if (
        isCatalogProvider(nextProvider) &&
        aiModelCatalog[nextProvider].length === 0 &&
        !isLoadingModels[nextProvider]
      ) {
        void loadModelCatalog(nextProvider);
      }
    }
  };

  const handleModelFamilyChange = (task: AITask, family: OpenRouterModelFamily) => {
    setModelFamilyByTask((current) => ({
      ...current,
      [task]: family
    }));
  };

  const refreshProjectsAndHistory = async (preferredProjectId?: string) => {
    const nextProjects = await getProjects();
    setProjects(nextProjects);

    const resolvedProjectId =
      (preferredProjectId && nextProjects.some((item) => item.id === preferredProjectId)
        ? preferredProjectId
        : undefined) ??
      (historyProjectId && nextProjects.some((item) => item.id === historyProjectId)
        ? historyProjectId
        : undefined) ??
      nextProjects[0]?.id ??
      "";

    setHistoryProjectId(resolvedProjectId);

    if (!resolvedProjectId) {
      setHistoryItems([]);
      return;
    }

    const response = await getProjectHistory(resolvedProjectId);
    setHistoryItems(response.items);
  };

  const handleLoadPreferences = async () => {
    setProfileMessage("");
    setIsLoadingPreferences(true);

    try {
      const response = await getAiPreferences();
      applyPreferencesToWorkspace(response);
      setProfileMessage("Preferencias carregadas.");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Falha ao carregar preferencias.");
    } finally {
      setIsLoadingPreferences(false);
      window.setTimeout(() => setProfileMessage(""), 2500);
    }
  };

  const handleSavePreferences = async () => {
    setProfileMessage("");
    setIsSavingPreferences(true);

    try {
      const response = await patchAiPreferences({
        generationProfile,
        modelFamilyByTask
      });
      applyPreferencesToWorkspace(response);
      setProfileMessage("Preferencias globais salvas.");
    } catch (err) {
      setProfileMessage(err instanceof Error ? err.message : "Falha ao salvar preferencias.");
    } finally {
      setIsSavingPreferences(false);
      window.setTimeout(() => setProfileMessage(""), 2500);
    }
  };

  const handleRefreshHistory = async () => {
    setHistoryMessage("");
    setIsLoadingHistory(true);
    try {
      await refreshProjectsAndHistory(historyProjectId || projectId || undefined);
      setHistoryMessage("Historico atualizado.");
    } catch (err) {
      setHistoryMessage(err instanceof Error ? err.message : "Falha ao atualizar historico.");
    } finally {
      setIsLoadingHistory(false);
      window.setTimeout(() => setHistoryMessage(""), 2400);
    }
  };

  const handleOpenHistoryRun = (runSrtId: string) => {
    setSrtId(runSrtId);
    setWorkspaceStage("results");
    setResultsView("overview");
  };

  const handleSaveRouting = async () => {
    if (!aiRouting || !judgeRouting) {
      return;
    }

    setRoutingMessage("");
    setIsSavingRouting(true);

    try {
      const response = await patchAiRouting({
        routing: aiRouting,
        judgeRouting
      });
      setAiRouting(response.routing);
      setJudgeRouting(response.judgeRouting);
      setConfiguredKeys(response.configuredKeys);
      setRoutingMessage("Configuracao de IA salva.");
    } catch (err) {
      setRoutingMessage(err instanceof Error ? err.message : "Falha ao salvar configuracao de IA.");
    } finally {
      setIsSavingRouting(false);
      window.setTimeout(() => setRoutingMessage(""), 2500);
    }
  };

  const handleSelectPromptTask = (task: AITask) => {
    setPromptTask(task);

    const taskCatalog = promptCatalog?.[task];
    const activePrompt =
      taskCatalog?.versions.find((version) => version.version === taskCatalog.activeVersion) ??
      taskCatalog?.versions[0];

    if (activePrompt) {
      setNewPromptName(nextPromptVersionName(task, taskCatalog?.versions ?? []));
      setNewSystemPrompt(activePrompt.systemPrompt);
      setNewUserPromptTemplate(activePrompt.userPromptTemplate);
      setInspectedPromptVersion(activePrompt.version);
    } else {
      setNewPromptName(`${task}-v1`);
      setNewSystemPrompt("");
      setNewUserPromptTemplate("");
      setInspectedPromptVersion(null);
    }
  };

  const handleInspectPromptVersion = (version: PromptVersion) => {
    setPromptTask(version.task);
    setInspectedPromptVersion(version.version);
  };

  const handleLoadPromptVersionForEdit = (version: PromptVersion) => {
    const taskCatalog = promptCatalog?.[version.task];
    setPromptTask(version.task);
    setInspectedPromptVersion(version.version);
    setNewPromptName(nextPromptVersionName(version.task, taskCatalog?.versions ?? [version]));
    setNewSystemPrompt(version.systemPrompt);
    setNewUserPromptTemplate(version.userPromptTemplate);
    setPromptMessage(`Versao v${version.version} carregada para edicao.`);
    window.setTimeout(() => setPromptMessage(""), 2500);
  };

  const handleCreatePromptVersion = async () => {
    if (!newPromptName.trim() || !newSystemPrompt.trim() || !newUserPromptTemplate.trim()) {
      setPromptMessage("Preencha nome, system prompt e user template.");
      return;
    }

    setPromptMessage("");
    setIsSavingPrompt(true);

    try {
      const response = await createAiPromptVersion(promptTask, {
        name: newPromptName.trim(),
        systemPrompt: newSystemPrompt.trim(),
        userPromptTemplate: newUserPromptTemplate.trim(),
        activate: true
      });

      setPromptCatalog(response.prompts);
      const active = response.prompts[promptTask].activeVersion;
      setInspectedPromptVersion(active);
      setNewPromptName(nextPromptVersionName(promptTask, response.prompts[promptTask].versions));
      setPromptMessage("Nova versao criada e ativada.");
    } catch (err) {
      setPromptMessage(err instanceof Error ? err.message : "Falha ao criar versao de prompt.");
    } finally {
      setIsSavingPrompt(false);
      window.setTimeout(() => setPromptMessage(""), 3000);
    }
  };

  const handleActivatePromptVersion = async (task: AITask, version: number) => {
    setPromptMessage("");
    setIsSavingPrompt(true);

    try {
      const response = await activateAiPromptVersion(task, version);
      setPromptCatalog(response.prompts);
      setPromptTask(task);
      setInspectedPromptVersion(version);
      const activePrompt =
        response.prompts[task].versions.find((item) => item.version === version) ??
        response.prompts[task].versions[0];
      if (activePrompt) {
        setNewPromptName(nextPromptVersionName(task, response.prompts[task].versions));
        setNewSystemPrompt(activePrompt.systemPrompt);
        setNewUserPromptTemplate(activePrompt.userPromptTemplate);
      }
      setPromptMessage(`Versao v${version} ativada para ${task}.`);
    } catch (err) {
      setPromptMessage(err instanceof Error ? err.message : "Falha ao ativar versao.");
    } finally {
      setIsSavingPrompt(false);
      window.setTimeout(() => setPromptMessage(""), 3000);
    }
  };

  return (
    <section className="mx-auto grid max-w-[1320px] gap-6 px-4 pb-16 pt-6 md:grid-cols-3 md:px-6">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-[#f7fbff] via-[#edf6ff] to-[#f4fffb] p-6 shadow-[0_20px_50px_-25px_rgba(15,23,42,0.35)] md:col-span-3">
        <div className="pointer-events-none absolute -left-20 -top-20 h-48 w-48 rounded-full bg-cyan-200/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 right-0 h-56 w-56 rounded-full bg-emerald-200/30 blur-3xl" />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full border border-slate-300 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                Premium Command Center
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900">
                Visao executiva da qualidade
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Status real do pipeline para evitar output mediocre antes de publicar.
              </p>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                checklist {commandCenter.completedSteps}/{commandCenter.steps.length}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  configuredKeys.openai ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                OpenAI {configuredKeys.openai ? "conectado" : "off"}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  configuredKeys.openrouter ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                OpenRouter {configuredKeys.openrouter ? "conectado" : "off"}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Providers ativos</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{commandCenter.providersConnected}/2</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Tasks prontas para publicar</p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {commandCenter.passedTasks}/{commandCenter.totalTasks}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Fallback heuristico</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{commandCenter.fallbackTasks}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Assets prontos</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{commandCenter.readyAssets}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Custo estimado</p>
              <p className="mt-1 text-xl font-black text-slate-900">
                {formatUsd(commandCenter.totalEstimatedCost)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                real {formatUsd(commandCenter.totalActualCost)} | {commandCenter.totalTokens} tokens
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[1.8fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Macro fluxo guiado
                </p>
                <p className="text-xs font-semibold text-slate-700">
                  modo atual: {WORKFLOW_MODES.find((mode) => mode.key === workflowMode)?.label ?? "Setup"}
                </p>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                {WORKFLOW_MODES.map((mode) => {
                  const isActive = mode.key === workflowMode;
                  const isDone = workflowModeCompletion[mode.key];
                  const tone = isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : isDone
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400";

                  return (
                    <button
                      key={`workflow-mode-${mode.key}`}
                      type="button"
                      onClick={() => jumpToWorkflowMode(mode.key)}
                      className={`rounded-xl border px-3 py-2 text-left transition ${tone}`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
                        {isDone ? "concluido" : isActive ? "em andamento" : "pendente"}
                      </p>
                      <p className="mt-1 text-xs font-semibold">{mode.label}</p>
                      <p className="mt-1 text-[11px] opacity-80">{mode.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Proxima acao sugerida
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">{nextGuidedAction}</p>
              <button
                type="button"
                onClick={() => jumpToWorkflowMode(nextWorkflowMode)}
                className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Ir para {nextWorkflowModeLabel}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Workspace por etapas
              </p>
              <p className="text-xs font-semibold text-slate-700">{workspaceCompletionPct}% concluido</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-slate-900 via-blue-600 to-emerald-500 transition-all duration-500"
                style={{ width: `${workspaceCompletionPct}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              {WORKSPACE_STAGES.map((stage, index) => {
                const isActive = stage.key === workspaceStage;
                const isDone = workspaceStageCompletion[stage.key];
                const stageTone = isActive
                  ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/20"
                  : isDone
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400";
                return (
                  <button
                    key={`workspace-stage-${stage.key}`}
                    type="button"
                    onClick={() => setWorkspaceStage(stage.key)}
                    className={`animate-premium-in rounded-xl border px-3 py-2 text-left transition ${stageTone}`}
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
                      Etapa {index + 1}
                    </p>
                    <p className="mt-1 text-xs font-semibold">{stage.shortLabel}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                <strong>Etapa atual:</strong> {workspaceStageMeta.label}. {workspaceStageMeta.description}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHistoryPanel((current) => !current)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500"
                >
                  {showHistoryPanel
                    ? "Ocultar historico"
                    : `Historico (${historyItems.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => moveWorkspaceStage(-1)}
                  disabled={!canGoPrevStage}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-50"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={() => moveWorkspaceStage(1)}
                  disabled={!canGoNextStage}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {canGoNextStage ? "Avancar" : "Ultima etapa"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {commandCenter.steps.map((step) => (
              <div
                key={step.id}
                className={`rounded-xl border px-3 py-2 text-xs ${
                  step.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <p className="font-semibold">{step.label}</p>
                <p className="mt-1 text-[11px]">{step.done ? "concluido" : "pendente"}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside className="md:col-span-1 md:sticky md:top-6 md:self-start">
        <div className="animate-premium-in rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Mission Control
            </p>
            <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-white">
              live
            </span>
          </div>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pipeline</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {pipelineSummary.completedBaseSteps}/{pipelineSummary.baseJobs.length} etapas concluídas
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pipelineSummary.failed
                    ? "bg-red-500"
                    : "bg-gradient-to-r from-slate-900 via-blue-600 to-emerald-500"
                }`}
                style={{ width: `${pipelineSummary.progressPct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-600">{pipelineSummary.progressPct}% progresso técnico</p>
          </div>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qualidade</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {pipelineSummary.readyTasks}/{AI_TASKS.length} tarefas prontas para publicar
            </p>
            <p className="mt-1 text-[11px] text-slate-600">
              assets ready: {commandCenter.readyAssets} | fallback: {commandCenter.fallbackTasks}
            </p>
          </div>

          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Execução atual</p>
            {!srtId ? (
              <p className="mt-1 text-[11px] text-slate-600">Sem SRT em execução no momento.</p>
            ) : (
              <>
                <p className="mt-1 text-[11px] text-slate-600">
                  SRT: <code>{srtId.slice(0, 8)}</code>
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Status:{" "}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass(detail?.asset.status ?? "pending")}`}>
                    {detail?.asset.status ?? "pending"}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-slate-600">
                  Job: {pipelineSummary.runningJob?.name ?? "aguardando"}
                </p>
              </>
            )}
          </div>

          <div className="mt-4 space-y-2">
            {WORKSPACE_STAGES.map((stage, index) => {
              const isActive = stage.key === workspaceStage;
              const isDone = workspaceStageCompletion[stage.key];
              return (
                <button
                  key={`sidebar-stage-${stage.key}`}
                  type="button"
                  onClick={() => setWorkspaceStage(stage.key)}
                  className={`animate-premium-in w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : isDone
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                  }`}
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <p className="font-semibold">{index + 1}. {stage.label}</p>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowHistoryPanel((current) => !current)}
              className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                showHistoryPanel
                  ? "border-cyan-300 bg-cyan-50 text-cyan-800"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              }`}
            >
              Historico de execucoes ({historyItems.length})
            </button>
          </div>
        </div>
      </aside>

      <div key={`stage-panel-${workspaceStage}`} className="animate-premium-in md:col-span-2 grid gap-6 md:grid-cols-2">
      {(workspaceStage === "models" || workspaceStage === "prompts") ? (
      <div id="routing" className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-cyan-50/30 p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur md:col-span-2">
        <h2 className="text-xl font-bold text-slate-900">
          {workspaceStage === "models" ? "1. Modelos e roteamento de IA" : "2. Prompts por tarefa"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {workspaceStage === "models"
            ? "Escolha provider/modelo por etapa. Sem chave configurada, o backend cai automaticamente no modo heuristic."
            : "Inspecione e evolua prompts versionados por canal com ativacao controlada."}
        </p>

        <div className="mt-4 inline-flex rounded-xl border border-slate-300 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setWorkspaceStage("models")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              workspaceStage === "models"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Modelos
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceStage("prompts")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              workspaceStage === "prompts"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Prompts
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-600">
          Chaves detectadas: OpenAI <strong>{configuredKeys.openai ? "ok" : "nao configurada"}</strong> | OpenRouter <strong>{configuredKeys.openrouter ? "ok" : "nao configurada"}</strong>
        </p>

        {workspaceStage === "models" ? (
        <>
        <div className="mt-4 grid gap-3">
          {AI_TASKS.map((task) => {
            const route = aiRouting?.[task.key];
            const suggestions = modelSuggestionsForRoute(route);
            const providerWithCatalog =
              route?.provider && isCatalogProvider(route.provider) ? route.provider : null;
            const catalogCount = providerWithCatalog
              ? aiModelCatalog[providerWithCatalog].length
              : 0;
            const selectedFamily = modelFamilyByTask[task.key];
            const quickPicks = providerWithCatalog
              ? buildQuickPickModels(providerWithCatalog, suggestions, selectedFamily)
              : [];
            const datalistId = providerWithCatalog ? `model-catalog-${providerWithCatalog}` : "";
            const canRefresh = Boolean(providerWithCatalog);
            const isRefreshing = providerWithCatalog
              ? isLoadingModels[providerWithCatalog]
              : false;
            const judgeRoute = judgeRouting?.[task.key];
            const judgeSuggestions = modelSuggestionsForRoute(judgeRoute);
            const judgeProviderWithCatalog =
              judgeRoute?.provider && isCatalogProvider(judgeRoute.provider)
                ? judgeRoute.provider
                : null;
            const judgeCatalogCount = judgeProviderWithCatalog
              ? aiModelCatalog[judgeProviderWithCatalog].length
              : 0;
            const judgeQuickPicks = judgeProviderWithCatalog
              ? buildQuickPickModels(judgeProviderWithCatalog, judgeSuggestions, selectedFamily)
              : [];
            const judgeDatalistId = judgeProviderWithCatalog
              ? `model-catalog-${judgeProviderWithCatalog}`
              : "";
            const canRefreshJudge = Boolean(judgeProviderWithCatalog);
            const isRefreshingJudge = judgeProviderWithCatalog
              ? isLoadingModels[judgeProviderWithCatalog]
              : false;

            return (
              <div
                key={task.key}
                className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{task.label}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                      gen {route?.provider ?? "heuristic"}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      judge {judgeRoute?.provider ?? "heuristic"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Provider
                    </p>
                    <div className="mt-1 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-300 bg-slate-50">
                      {(["heuristic", "openai", "openrouter"] as const).map((provider) => {
                        const isSelected = route?.provider === provider;
                        return (
                          <button
                            key={`${task.key}-${provider}`}
                            type="button"
                            onClick={() =>
                              handleRoutingChange(
                                "generation",
                                task.key,
                                "provider",
                                provider as AIProvider
                              )
                            }
                            disabled={!aiRouting}
                            className={`px-2 py-2 text-xs font-semibold transition ${
                              isSelected
                                ? "bg-slate-900 text-white shadow-inner"
                                : "text-slate-700 hover:bg-white"
                            }`}
                          >
                            {provider}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:col-span-6">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                        Modelo
                      </p>
                      <button
                        type="button"
                        disabled={!canRefresh || isRefreshing}
                        onClick={() => {
                          if (providerWithCatalog) {
                            void loadModelCatalog(providerWithCatalog, true);
                          }
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                      >
                        {canRefresh && isRefreshing
                          ? "Atualizando..."
                          : canRefresh
                            ? `Atualizar (${catalogCount})`
                            : "Sem catalogo"}
                      </button>
                    </div>

                    <input
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                      list={datalistId || undefined}
                      value={route?.model ?? ""}
                      onChange={(event) =>
                        handleRoutingChange("generation", task.key, "model", event.target.value)
                      }
                      placeholder={
                        route?.provider === "heuristic"
                          ? "heuristic-v1"
                          : "Busque no catalogo ou digite manualmente"
                      }
                      disabled={!aiRouting}
                    />

                    {providerWithCatalog ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {catalogCount} modelos no catalogo desta provider.
                      </p>
                    ) : null}

                    {providerWithCatalog === "openrouter" ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {OPENROUTER_MODEL_FAMILIES.map((family) => {
                          const active = family.key === selectedFamily;
                          return (
                            <button
                              key={`${task.key}-family-${family.key}`}
                              type="button"
                              onClick={() => handleModelFamilyChange(task.key, family.key)}
                              className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                                active
                                  ? "border-slate-900 bg-slate-900 text-white"
                                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
                              }`}
                            >
                              {family.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {route?.provider !== "heuristic" ? (
                      <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2">
                        {quickPicks.map((model) => (
                          <button
                            key={`${task.key}-${model.id}`}
                            type="button"
                            onClick={() =>
                              handleRoutingChange("generation", task.key, "model", model.id)
                            }
                            className={`rounded-md border px-2 py-1 text-[11px] transition ${
                              route?.model === model.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-100"
                            }`}
                            title={model.description ?? model.name}
                          >
                            {model.id}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {route?.provider !== "heuristic" && quickPicks.length === 0 ? (
                      <p className="mt-2 text-[11px] text-slate-500">
                        Sem modelos nesta categoria. Use a busca manual no campo acima.
                      </p>
                    ) : null}
                  </div>

                  <div className="md:col-span-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      Temperatura
                    </p>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                      type="number"
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={route?.temperature ?? 0.3}
                      onChange={(event) =>
                        handleRoutingChange(
                          "generation",
                          task.key,
                          "temperature",
                          Number(event.target.value)
                        )
                      }
                      disabled={!aiRouting}
                    />
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                    Roteamento do Judge
                  </p>
                  <div className="mt-2 grid gap-3 md:grid-cols-12">
                    <div className="md:col-span-4">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                        Provider
                      </p>
                      <div className="mt-1 grid grid-cols-3 overflow-hidden rounded-xl border border-emerald-200 bg-white">
                        {(["heuristic", "openai", "openrouter"] as const).map((provider) => {
                          const isSelected = judgeRoute?.provider === provider;
                          return (
                            <button
                              key={`${task.key}-judge-${provider}`}
                              type="button"
                              onClick={() =>
                                handleRoutingChange(
                                  "judge",
                                  task.key,
                                  "provider",
                                  provider as AIProvider
                                )
                              }
                              disabled={!judgeRouting}
                              className={`px-2 py-2 text-xs font-semibold transition ${
                                isSelected
                                  ? "bg-emerald-700 text-white shadow-inner"
                                  : "text-slate-700 hover:bg-emerald-50"
                              }`}
                            >
                              {provider}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="md:col-span-6">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                          Modelo
                        </p>
                        <button
                          type="button"
                          disabled={!canRefreshJudge || isRefreshingJudge}
                          onClick={() => {
                            if (judgeProviderWithCatalog) {
                              void loadModelCatalog(judgeProviderWithCatalog, true);
                            }
                          }}
                          className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:border-emerald-500 disabled:opacity-50"
                        >
                          {canRefreshJudge && isRefreshingJudge
                            ? "Atualizando..."
                            : canRefreshJudge
                              ? `Atualizar (${judgeCatalogCount})`
                              : "Sem catalogo"}
                        </button>
                      </div>

                      <input
                        className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500"
                        list={judgeDatalistId || undefined}
                        value={judgeRoute?.model ?? ""}
                        onChange={(event) =>
                          handleRoutingChange("judge", task.key, "model", event.target.value)
                        }
                        placeholder={
                          judgeRoute?.provider === "heuristic"
                            ? "heuristic-v1"
                            : "Busque no catalogo ou digite manualmente"
                        }
                        disabled={!judgeRouting}
                      />

                      {judgeProviderWithCatalog ? (
                        <p className="mt-1 text-[11px] text-emerald-700">
                          {judgeCatalogCount} modelos no catalogo desta provider.
                        </p>
                      ) : null}

                      {judgeProviderWithCatalog === "openrouter" ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {OPENROUTER_MODEL_FAMILIES.map((family) => {
                            const active = family.key === selectedFamily;
                            return (
                              <button
                                key={`${task.key}-judge-family-${family.key}`}
                                type="button"
                                onClick={() => handleModelFamilyChange(task.key, family.key)}
                                className={`rounded-full border px-2 py-1 text-[11px] font-semibold transition ${
                                  active
                                    ? "border-emerald-700 bg-emerald-700 text-white"
                                    : "border-emerald-300 bg-white text-emerald-700 hover:border-emerald-500"
                                }`}
                              >
                                {family.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

                      {judgeRoute?.provider !== "heuristic" ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-emerald-200 bg-white p-2">
                          {judgeQuickPicks.map((model) => (
                            <button
                              key={`${task.key}-judge-model-${model.id}`}
                              type="button"
                              onClick={() =>
                                handleRoutingChange("judge", task.key, "model", model.id)
                              }
                              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                                judgeRoute?.model === model.id
                                  ? "border-emerald-700 bg-emerald-700 text-white"
                                  : "border-emerald-300 bg-white text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50"
                              }`}
                              title={model.description ?? model.name}
                            >
                              {model.id}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {judgeRoute?.provider !== "heuristic" && judgeQuickPicks.length === 0 ? (
                        <p className="mt-2 text-[11px] text-emerald-700">
                          Sem modelos nesta categoria. Use a busca manual no campo acima.
                        </p>
                      ) : null}
                    </div>

                    <div className="md:col-span-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                        Temperatura
                      </p>
                      <input
                        className="mt-1 w-full rounded-lg border border-emerald-200 bg-white px-2 py-2 text-sm"
                        type="number"
                        min={0}
                        max={1.5}
                        step={0.1}
                        value={judgeRoute?.temperature ?? 0.2}
                        onChange={(event) =>
                          handleRoutingChange(
                            "judge",
                            task.key,
                            "temperature",
                            Number(event.target.value)
                          )
                        }
                        disabled={!judgeRouting}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <datalist id="model-catalog-openai">
          {aiModelCatalog.openai.map((model) => (
            <option key={`openai-option-${model.id}`} value={model.id}>
              {model.name}
            </option>
          ))}
        </datalist>
        <datalist id="model-catalog-openrouter">
          {aiModelCatalog.openrouter.map((model) => (
            <option key={`openrouter-option-${model.id}`} value={model.id}>
              {model.name}
            </option>
          ))}
        </datalist>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSaveRouting}
            disabled={!aiRouting || !judgeRouting || isSavingRouting}
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isSavingRouting ? "Salvando..." : "Salvar roteamento (geracao + judge)"}
          </button>
          <button
            type="button"
            onClick={handleSavePreferences}
            disabled={isSavingPreferences}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {isSavingPreferences ? "Salvando..." : "Salvar preferencias globais"}
          </button>
          <button
            type="button"
            onClick={handleLoadPreferences}
            disabled={isLoadingPreferences}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {isLoadingPreferences ? "Carregando..." : "Carregar preferencias"}
          </button>
          {routingMessage ? <p className="text-xs text-slate-600">{routingMessage}</p> : null}
        </div>
        {preferencesUpdatedAt ? (
          <p className="mt-2 text-xs text-slate-500">
            Preferencias atualizadas em {formatDateTime(preferencesUpdatedAt)}
          </p>
        ) : null}
        {modelsMessage ? <p className="mt-2 text-xs text-slate-600">{modelsMessage}</p> : null}
        </>
        ) : null}

        {workspaceStage === "prompts" ? (
        <div className="mt-4 border-t border-slate-200 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Versionamento de prompts</h3>
              <p className="mt-1 text-xs text-slate-600">
                Inspecione cada versao, carregue para edicao e publique nova versao ativa.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700" htmlFor="prompt-task-select">
                Tarefa
              </label>
              <select
                id="prompt-task-select"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm md:w-72"
                value={promptTask}
                onChange={(event) => handleSelectPromptTask(event.target.value as AITask)}
              >
                {AI_TASKS.map((task) => (
                  <option key={task.key} value={task.key}>
                    {task.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Versoes da tarefa
              </p>
              {!selectedPromptTask ? (
                <p className="mt-2 text-xs text-slate-600">Carregando...</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {promptVersionsSorted.map((version) => {
                    const isInspected = inspectedPrompt?.version === version.version;
                    return (
                      <li
                        key={`${version.task}-${version.version}`}
                        className={`rounded-xl border px-3 py-2 ${
                          isInspected
                            ? "border-slate-900 bg-slate-900/5"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-900">
                            v{version.version} · {version.name}
                          </p>
                          <div className="flex items-center gap-1">
                            {version.isActive ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                ativa
                              </span>
                            ) : null}
                            {isInspected ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                aberta
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{version.createdAt}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleInspectPromptVersion(version)}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:border-slate-500"
                          >
                            Inspecionar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadPromptVersionForEdit(version)}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:border-slate-500"
                          >
                            Editar
                          </button>
                          {!version.isActive ? (
                            <button
                              type="button"
                              disabled={isSavingPrompt}
                              onClick={() =>
                                handleActivatePromptVersion(version.task, version.version)
                              }
                              className="rounded-md bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-60"
                            >
                              Ativar
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Inspecao da versao
              </p>
              {!inspectedPrompt ? (
                <p className="mt-2 text-xs text-slate-600">
                  Selecione uma versao para analisar o prompt completo.
                </p>
              ) : (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-slate-900">
                    v{inspectedPrompt.version} · {inspectedPrompt.name}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">{inspectedPrompt.createdAt}</p>

                  <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    System prompt
                  </label>
                  <textarea
                    readOnly
                    className="mt-1 h-32 w-full rounded-xl border border-slate-300 bg-slate-50 px-2 py-2 text-[11px] text-slate-700"
                    value={inspectedPrompt.systemPrompt}
                  />

                  <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    User template
                  </label>
                  <textarea
                    readOnly
                    className="mt-1 h-36 w-full rounded-xl border border-slate-300 bg-slate-50 px-2 py-2 text-[11px] text-slate-700"
                    value={inspectedPrompt.userPromptTemplate}
                  />
                </div>
              )}
            </div>

            <div className="md:col-span-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Editor de nova versao
              </p>

              <label className="mt-2 block text-xs font-medium text-slate-700" htmlFor="prompt-name">
                Nome da versao
              </label>
              <input
                id="prompt-name"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm outline-none focus:border-slate-500"
                value={newPromptName}
                onChange={(event) => setNewPromptName(event.target.value)}
                placeholder={`${promptTask}-vN`}
              />

              <div className="mt-3 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700" htmlFor="system-prompt">
                  System prompt
                </label>
                <span className="text-[10px] text-slate-500">{newSystemPrompt.length} chars</span>
              </div>
              <textarea
                id="system-prompt"
                className="mt-1 h-28 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs outline-none focus:border-slate-500"
                value={newSystemPrompt}
                onChange={(event) => setNewSystemPrompt(event.target.value)}
              />

              <div className="mt-3 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700" htmlFor="user-template">
                  User template
                </label>
                <span className="text-[10px] text-slate-500">
                  {newUserPromptTemplate.length} chars
                </span>
              </div>
              <textarea
                id="user-template"
                className="mt-1 h-32 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs outline-none focus:border-slate-500"
                value={newUserPromptTemplate}
                onChange={(event) => setNewUserPromptTemplate(event.target.value)}
              />

              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Placeholders desta tarefa
                </p>
                <div className="mt-2 space-y-1.5">
                  {TASK_VARIABLE_HINTS[promptTask].map((item) => (
                    <div key={`${promptTask}-${item.key}`} className="rounded-md bg-slate-50 px-2 py-1">
                      <code className="text-[11px] font-semibold text-slate-800">{`{{${item.key}}}`}</code>
                      <p className="mt-0.5 text-[10px] text-slate-600">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCreatePromptVersion}
                disabled={isSavingPrompt}
                className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
              >
                {isSavingPrompt ? "Salvando..." : "Criar versao e ativar"}
              </button>
              {promptMessage ? <p className="mt-2 text-xs text-slate-600">{promptMessage}</p> : null}
            </div>
          </div>
        </div>
        ) : null}
      </div>
      ) : null}

      {workspaceStage === "guidelines" ? (
      <div id="brief" className="md:col-span-2 rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-amber-50/35 to-rose-50/25 p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">3. Diretrizes por canal</h2>
            <p className="mt-1 text-sm text-slate-600">
              Defina publico, objetivo e estrategia de copy por aba antes de processar ou para reprocessar o SRT atual.
            </p>
          </div>
          <button
            type="button"
            onClick={handleResetGenerationProfile}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500"
          >
            Resetar padrao
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Presets premium</p>
          <p className="mt-1 text-xs text-slate-600">
            Aplicam uma configuracao completa para acelerar teste com padrao de alto nivel.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {PROFILE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyProfilePreset(preset.id)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-left transition hover:border-slate-500 hover:bg-slate-50"
              >
                <p className="text-xs font-semibold text-slate-900">{preset.label}</p>
                <p className="mt-1 text-[11px] text-slate-600">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publico alvo</span>
            <textarea
              className="mt-1 h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              value={generationProfile.audience}
              onChange={(event) => handleProfileFieldChange("audience", event.target.value)}
            />
          </label>
          <label>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objetivo</span>
            <textarea
              className="mt-1 h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
              value={generationProfile.goal}
              onChange={(event) => handleProfileFieldChange("goal", event.target.value)}
            />
          </label>
          <div className="grid gap-3">
            <label>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tom</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                value={generationProfile.tone}
                onChange={(event) => handleProfileFieldChange("tone", event.target.value)}
              />
            </label>
            <label>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Idioma</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-500"
                value={generationProfile.language}
                onChange={(event) => handleProfileFieldChange("language", event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Motor de qualidade</p>
          <div className="mt-2 grid gap-3 md:grid-cols-4">
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Modo</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                value={generationProfile.quality.mode}
                onChange={(event) =>
                  handleQualityChange("mode", event.target.value as GenerationQualityMode)
                }
              >
                {GENERATION_QUALITY_MODES.map((mode) => (
                  <option key={`quality-mode-${mode}`} value={mode}>
                    {QUALITY_MODE_LABEL[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Variacoes</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                type="number"
                min={1}
                max={8}
                value={generationProfile.quality.variationCount}
                onChange={(event) =>
                  handleQualityChange(
                    "variationCount",
                    Math.max(1, Math.min(8, Number(event.target.value) || 1))
                  )
                }
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Refine passes</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                type="number"
                min={1}
                max={3}
                value={generationProfile.quality.refinePasses}
                onChange={(event) =>
                  handleQualityChange(
                    "refinePasses",
                    Math.max(1, Math.min(3, Number(event.target.value) || 1))
                  )
                }
              />
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Em <strong>Max Quality</strong>, o backend faz best-of-N, juiz por canal e refino multi-pass.
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">Biblioteca de voz e estilo</p>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Identidade</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                value={generationProfile.voice.identity}
                onChange={(event) => handleVoiceChange("identity", event.target.value)}
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Regras de escrita</span>
              <textarea
                className="mt-1 h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                value={generationProfile.voice.writingRules}
                onChange={(event) => handleVoiceChange("writingRules", event.target.value)}
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Termos proibidos</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                value={generationProfile.voice.bannedTerms}
                onChange={(event) => handleVoiceChange("bannedTerms", event.target.value)}
              />
            </label>
            <label>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Frases assinatura</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                value={generationProfile.voice.signaturePhrases}
                onChange={(event) => handleVoiceChange("signaturePhrases", event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {AI_TASKS.map((task) => (
            <div key={`profile-${task.key}`} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">{task.label}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TASK_CHANNEL_PRESETS[task.key].map((preset) => (
                  <button
                    key={`${task.key}-preset-${preset.id}`}
                    type="button"
                    onClick={() => handleApplyTaskChannelPreset(task.key, preset.id)}
                    className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estrategia</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].strategy}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "strategy",
                        event.target.value as GenerationStrategy
                      )
                    }
                  >
                    {GENERATION_STRATEGIES.map((strategy) => (
                      <option key={`${task.key}-strategy-${strategy}`} value={strategy}>
                        {STRATEGY_LABEL[strategy]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Foco</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].focus}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "focus",
                        event.target.value as GenerationFocus
                      )
                    }
                  >
                    {GENERATION_FOCUS_OPTIONS.map((focus) => (
                      <option key={`${task.key}-focus-${focus}`} value={focus}>
                        {FOCUS_LABEL[focus]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Outcome</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].targetOutcome}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "targetOutcome",
                        event.target.value as GenerationTargetOutcome
                      )
                    }
                  >
                    {GENERATION_TARGET_OUTCOMES.map((outcome) => (
                      <option key={`${task.key}-outcome-${outcome}`} value={outcome}>
                        {OUTCOME_LABEL[outcome]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Nivel publico</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].audienceLevel}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "audienceLevel",
                        event.target.value as GenerationAudienceLevel
                      )
                    }
                  >
                    {GENERATION_AUDIENCE_LEVELS.map((level) => (
                      <option key={`${task.key}-audience-${level}`} value={level}>
                        {AUDIENCE_LEVEL_LABEL[level]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Intensidade</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].length}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "length",
                        event.target.value as GenerationLength
                      )
                    }
                  >
                    {GENERATION_LENGTHS.map((length) => (
                      <option key={`${task.key}-length-${length}`} value={length}>
                        {LENGTH_LABEL[length]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CTA</span>
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={generationProfile.tasks[task.key].ctaMode}
                    onChange={(event) =>
                      handleTaskProfileChange(
                        task.key,
                        "ctaMode",
                        event.target.value as GenerationCtaMode
                      )
                    }
                  >
                    {GENERATION_CTA_MODES.map((mode) => (
                      <option key={`${task.key}-cta-${mode}`} value={mode}>
                        {CTA_MODE_LABEL[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Peso Judge
                  </span>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    type="number"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    value={generationProfile.tasks[task.key].scoreWeights.judge}
                    onChange={(event) =>
                      handleTaskScoreWeightChange(
                        task.key,
                        "judge",
                        Number(event.target.value)
                      )
                    }
                  />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Peso Heuristico
                  </span>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    type="number"
                    min={0.05}
                    max={0.95}
                    step={0.05}
                    value={generationProfile.tasks[task.key].scoreWeights.heuristic}
                    onChange={(event) =>
                      handleTaskScoreWeightChange(
                        task.key,
                        "heuristic",
                        Number(event.target.value)
                      )
                    }
                  />
                </label>
              </div>

              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                Score composto: judge{" "}
                <strong>
                  {(generationProfile.tasks[task.key].scoreWeights.judge * 100).toFixed(0)}%
                </strong>{" "}
                + heuristico{" "}
                <strong>
                  {(generationProfile.tasks[task.key].scoreWeights.heuristic * 100).toFixed(0)}%
                </strong>
                . Se a soma nao for 100%, o backend normaliza automaticamente.
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Memoria: wins</span>
                  <textarea
                    className="mt-1 h-16 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                    value={generationProfile.performanceMemory[task.key].wins}
                    onChange={(event) =>
                      handlePerformanceMemoryChange(task.key, "wins", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Memoria: evitar</span>
                  <textarea
                    className="mt-1 h-16 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                    value={generationProfile.performanceMemory[task.key].avoid}
                    onChange={(event) =>
                      handlePerformanceMemoryChange(task.key, "avoid", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">KPI principal</span>
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                    value={generationProfile.performanceMemory[task.key].kpi}
                    onChange={(event) =>
                      handlePerformanceMemoryChange(task.key, "kpi", event.target.value)
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!srtId || isApplyingProfile}
            onClick={handleApplyProfileToCurrentSrt}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            {isApplyingProfile ? "Aplicando..." : "Aplicar no SRT atual e reprocessar"}
          </button>
          <button
            type="button"
            disabled={isSavingPreferences}
            onClick={handleSavePreferences}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {isSavingPreferences ? "Salvando..." : "Salvar preferencias globais"}
          </button>
          <button
            type="button"
            disabled={isLoadingPreferences}
            onClick={handleLoadPreferences}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
          >
            {isLoadingPreferences ? "Carregando..." : "Carregar preferencias"}
          </button>
          <p className="text-xs text-slate-600">
            No upload, esse brief ja e enviado automaticamente.
          </p>
          {profileMessage ? <p className="text-xs text-slate-600">{profileMessage}</p> : null}
        </div>
      </div>
      ) : null}

      {workspaceStage === "project" ? (
      <>
      <div id="project" className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white to-emerald-50/25 p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
        <h2 className="text-xl font-bold text-slate-900">4. Criar projeto</h2>
        <p className="mt-1 text-sm text-slate-600">Defina o conteiner inicial para os arquivos de transcricao.</p>

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="project-name">
          Nome do projeto
        </label>
        <input
          id="project-name"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="Authority Sprint 2"
        />

        <button
          type="button"
          onClick={handleCreateProject}
          disabled={isCreatingProject || projectName.trim().length < 2}
          className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {isCreatingProject ? "Criando..." : "Criar projeto"}
        </button>

        {projectId ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Projeto criado: <code>{projectId}</code>
          </p>
        ) : null}
      </div>

      <div id="upload" className="rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white to-amber-50/25 p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
        <h2 className="text-xl font-bold text-slate-900">4. Upload de transcricao</h2>
        <p className="mt-1 text-sm text-slate-600">Aceita `.srt` e `.txt` desde que o conteudo esteja no padrao SRT.</p>

        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="srt-file">
          Arquivo
        </label>
        <input
          id="srt-file"
          type="file"
          accept=".srt,.txt"
          className="mt-1 block w-full text-sm text-slate-700"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          disabled={!canUpload}
          onClick={handleUpload}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {isUploading ? "Enviando..." : "Upload e processar"}
        </button>

        {!projectId ? <p className="mt-3 text-xs text-amber-700">Crie um projeto antes do upload.</p> : null}
      </div>

      <div className="md:col-span-2 rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-cyan-50/30 p-6 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.35)]">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Workflow Canvas</h3>
          <p className="text-[11px] text-slate-500">Source -&gt; Engine -&gt; Channels</p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">SRT/TXT principal</p>
            <p className="mt-1 text-xs text-slate-600">
              Arquivo de transcricao com base real para evidence map.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Engine</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Analise + Geração + Judge</p>
            <p className="mt-1 text-xs text-slate-600">
              Seleciona variacoes, aplica quality gate e evita claims fora da fonte.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Channels</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">Reels, Newsletter, LinkedIn, X</p>
            <p className="mt-1 text-xs text-slate-600">
              Saidas prontas para copiar, refinar por bloco e exportar em lote.
            </p>
          </div>
        </div>
      </div>
      </>
      ) : null}

      {showHistoryPanel ? (
      <div className="md:col-span-2 rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-indigo-50/25 to-cyan-50/30 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Historico de execucoes</h2>
            <p className="mt-1 text-sm text-slate-600">
              Reabra qualquer run para revisar saídas, custos e status sem repetir upload.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshHistory}
              disabled={isLoadingHistory}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
            >
              {isLoadingHistory ? "Atualizando..." : "Atualizar historico"}
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceStage("results")}
              disabled={!srtId}
              className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              Ir para resultados
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryPanel(false)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500"
            >
              Fechar
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="md:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Projeto
            </span>
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              value={historyProjectId}
              onChange={(event) => {
                setHistoryProjectId(event.target.value);
                setHistoryMessage("");
              }}
            >
              {projects.length === 0 ? (
                <option value="">Sem projetos</option>
              ) : (
                projects.map((project) => (
                  <option key={`history-project-${project.id}`} value={project.id}>
                    {project.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Resumo</p>
            <p className="mt-1">
              Runs: <strong>{historyItems.length}</strong>
            </p>
            <p className="mt-1">
              Projeto atual: <strong>{historyProjectId ? historyProjectId.slice(0, 8) : "n/d"}</strong>
            </p>
          </div>
        </div>

        {historyMessage ? (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700">{historyMessage}</p>
        ) : null}

        {!historyProjectId ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Crie um projeto para habilitar o historico.
          </p>
        ) : isLoadingHistory ? (
          <p className="mt-4 text-sm text-slate-600">Carregando historico...</p>
        ) : historyItems.length === 0 ? (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            Ainda nao existem runs nesse projeto.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {historyItems.map((item) => (
              <div
                key={`history-item-${item.srtAssetId}`}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.filename}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatDateTime(item.createdAt)} · {item.language} · {formatDurationSeconds(item.durationSec)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badgeClass(item.status)}`}>
                      {item.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenHistoryRun(item.srtAssetId)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                    >
                      Abrir run
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    segmentos <strong>{item.segmentCount}</strong>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    ready <strong>{item.readyTasks}/{item.totalTasks}</strong>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    quality <strong>{item.qualityAvg?.toFixed(2) ?? "n/d"}</strong>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    publishability <strong>{item.publishabilityAvg?.toFixed(2) ?? "n/d"}</strong>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                    custo <strong>{formatUsd(item.totalActualCostUsd ?? item.totalEstimatedCostUsd)}</strong>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-slate-600">
                  Ultimo job: {item.latestJob?.name ?? "n/d"} · {item.latestJob?.status ?? "n/d"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  SRT ID: <code>{item.srtAssetId}</code>
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      ) : null}

      {workspaceStage === "results" ? (
      <div id="pipeline" className="md:col-span-2 rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-blue-50/20 p-6 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
        <h2 className="text-xl font-bold text-slate-900">5. Resultados e ajustes</h2>

        {error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        {!srtId ? (
          <p className="mt-3 text-sm text-slate-600">Faca upload para visualizar jobs e resultados gerados.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            <div className="sticky top-3 z-20 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  {RESULTS_WORKSPACE_VIEWS.map((view) => {
                    const isActive = view.key === resultsView;
                    return (
                      <button
                        key={`results-view-${view.key}`}
                        type="button"
                        onClick={() => setResultsView(view.key)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          isActive
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                        }`}
                        title={view.description}
                      >
                        {view.label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setResultsView("quality")}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500"
                  >
                    Ver quality board
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultsView("studio")}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
                  >
                    Abrir content studio
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={!srtId || isExportingPdf}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                  >
                    {isExportingPdf ? "Exportando PDF..." : "Export PDF postagem"}
                  </button>
                </div>
              </div>
            </div>

            {resultsView === "overview" ? (
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-blue-50/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">Canal Health Board</h3>
                  <p className="text-[11px] text-slate-500">
                    Padrão inspirado em workflows de revisão multicanal
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-4">
                  {resultsLaneSummary.map((lane) => (
                    <div key={`lane-${lane.lane}`} className={`rounded-xl border p-3 ${lane.tone}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide">{lane.label}</p>
                      <p className="mt-1 text-2xl font-black">{lane.items.length}</p>
                      <div className="mt-2 space-y-1">
                        {lane.items.slice(0, 3).map((item) => (
                          <button
                            key={`lane-item-${lane.lane}-${item.task.key}`}
                            type="button"
                            onClick={() => {
                              setActiveTab(item.task.key as GeneratedAssetType);
                              setResultsView("studio");
                            }}
                            className="block w-full rounded-lg border border-current/25 bg-white/60 px-2 py-1 text-left text-[11px] font-semibold transition hover:bg-white"
                          >
                            {item.task.label}
                          </button>
                        ))}
                        {lane.items.length > 3 ? (
                          <p className="text-[10px] opacity-80">+{lane.items.length - 3} canais</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-5">
                  {resultsTaskRows.map((row) => (
                    <button
                      key={`overview-task-${row.task.key}`}
                      type="button"
                      onClick={() => {
                        setActiveTab(row.task.key as GeneratedAssetType);
                        setResultsView("studio");
                      }}
                      className={`rounded-xl border p-3 text-left transition hover:shadow-sm ${
                        row.ready
                          ? "border-emerald-200 bg-emerald-50"
                          : row.lane === "blocked"
                            ? "border-red-200 bg-red-50"
                            : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-900">{row.task.label}</p>
                      <p className="mt-1 text-[11px] text-slate-600">
                        Q {row.qualityScore.toFixed(2)} | P {row.publishabilityScore.toFixed(2)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {row.diagnosticsItem
                          ? row.ready
                            ? "Ready para publicar"
                            : "Precisa ajuste"
                          : "Sem execucao"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(resultsView === "overview" || resultsView === "quality") ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Resumo</h3>
                <p className="mt-2 text-sm text-slate-700">
                  ID: <code>{srtId}</code>
                </p>
                {detail ? (
                  <>
                    <p className="mt-1 text-sm text-slate-700">
                      Status: <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeClass(detail.asset.status)}`}>{detail.asset.status}</span>
                    </p>
                    <p className="mt-1 text-sm text-slate-700">Segmentos: {detail.segmentCount}</p>
                    <p className="mt-1 text-sm text-slate-700">Duracao estimada: {detail.asset.durationSec ?? 0}s</p>
                  </>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800">Jobs</h3>
                {jobs.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">Sem jobs registrados ainda.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {jobs.map((job) => (
                      <li key={job.id} className="rounded-lg border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-800">{job.name}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeClass(job.status)}`}>{job.status}</span>
                        </div>
                        {job.error ? <p className="mt-1 text-xs text-red-600">{job.error}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            ) : null}

            {(resultsView === "overview" || resultsView === "quality") ? (
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Debug IA por tarefa</h3>
                <p className="text-[11px] text-slate-500">
                  provider, best-of-n, quality_score, publishability_score, juiz, refino e guard
                </p>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {AI_TASKS.map((task) => {
                  const item = diagnosticsByTask.get(task.key);
                  const judgeRoute = judgeRouting?.[task.key];
                  const alerts = item ? buildActionableAlerts(item) : [];
                  const qualityScore = item ? resolveQualityScore(item) : 0;
                  const publishabilityScore = item ? resolvePublishabilityScore(item) : 0;
                  const publishabilityThreshold = item ? resolvePublishabilityThreshold(item) : 0;
                  const taskReady = item ? isTaskReadyForPublish(item) : false;
                  const scoreClass =
                    item && taskReady
                      ? "text-emerald-700"
                      : "text-amber-700";

                  return (
                    <div
                      key={`diag-${task.key}`}
                      className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900">{task.label}</p>
                        {item ? (
                          <span className={`rounded px-2 py-0.5 font-semibold ${item.usedHeuristicFallback ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                            {item.usedHeuristicFallback ? "heuristic" : "ia"}
                          </span>
                        ) : (
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                            sem dados
                          </span>
                        )}
                      </div>

                      {!item ? (
                        <p className="mt-2 text-[11px] text-slate-500">
                          Aguardando execucao desta tarefa.
                        </p>
                      ) : (
                        <>
                          <p className="mt-2">
                            <strong>Provider:</strong> {item.provider}
                          </p>
                          <p className="mt-1 break-all">
                            <strong>Modelo:</strong> {item.model}
                          </p>
                          <p className="mt-1 break-all">
                            <strong>Prompt:</strong> {item.promptName}
                          </p>
                          <p className={`mt-1 font-semibold ${scoreClass}`}>
                            Score composto {qualityScore.toFixed(2)} (heuristico {item.qualityInitial.toFixed(2)} | judge {(item.judgeQualityScore ?? 0).toFixed(2)} | meta {item.qualityThreshold.toFixed(2)})
                          </p>
                          <p className="mt-1">
                            <strong>Publishability:</strong> {publishabilityScore.toFixed(2)} / {publishabilityThreshold.toFixed(2)}
                          </p>
                          <p className="mt-1">
                            <strong>Ready gate:</strong> {taskReady ? "passou" : "abaixo da meta"}
                          </p>
                          <p className="mt-1 break-all text-[11px] text-slate-600">
                            <strong>Judge route:</strong>{" "}
                            {judgeRoute
                              ? `${judgeRoute.provider} / ${judgeRoute.model}`
                              : "nao configurado"}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {item.judgeSummary ?? "Judge indisponivel para esta execucao"}
                          </p>
                          <p className="mt-1">
                            <strong>Custo estimado:</strong> {formatUsd(item.estimatedCostUsd)} |{" "}
                            <strong>Custo real:</strong> {formatUsd(item.actualCostUsd)}
                          </p>
                          <p className="mt-1">
                            <strong>Tokens:</strong> p {item.promptTokens ?? "-"} | c{" "}
                            {item.completionTokens ?? "-"} | total {item.totalTokens ?? "-"}
                          </p>
                          <p className="mt-1">
                            <strong>Variacoes:</strong> {item.successfulVariants ?? 0}/{item.requestedVariants ?? 1} validas
                          </p>
                          <p className="mt-1">
                            <strong>Selecao:</strong>{" "}
                            {item.selectedVariant && item.selectedVariant > 0
                              ? `variacao ${item.selectedVariant}`
                              : "fallback heuristico"}
                          </p>
                          <p className="mt-1">
                            <strong>Refine:</strong>{" "}
                            {item.refinementRequested
                              ? item.refinementApplied
                                ? "aplicado"
                                : "tentado sem melhora"
                              : "nao necessario"}
                            {" · "}passes {item.refinePassesAppliedCount ?? 0}/{item.refinePassesTarget ?? 1}
                          </p>
                          <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
                            <p className="font-semibold text-slate-700">Subnotas finais</p>
                            <p className="mt-1">
                              clareza {(item.qualitySubscoresFinal?.clarity ?? 0).toFixed(1)} | profundidade {(item.qualitySubscoresFinal?.depth ?? 0).toFixed(1)}
                            </p>
                            <p>
                              originalidade {(item.qualitySubscoresFinal?.originality ?? 0).toFixed(1)} | aplicabilidade {(item.qualitySubscoresFinal?.applicability ?? 0).toFixed(1)}
                            </p>
                            <p>retencao {(item.qualitySubscoresFinal?.retentionPotential ?? 0).toFixed(1)}</p>
                          </div>
                          <div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-[11px]">
                            <p className="font-semibold text-slate-700">Subnotas do judge</p>
                            <p className="mt-1">
                              clareza {(item.judgeSubscores?.clarity ?? 0).toFixed(1)} | profundidade {(item.judgeSubscores?.depth ?? 0).toFixed(1)}
                            </p>
                            <p>
                              originalidade {(item.judgeSubscores?.originality ?? 0).toFixed(1)} | aplicabilidade {(item.judgeSubscores?.applicability ?? 0).toFixed(1)}
                            </p>
                            <p>retencao {(item.judgeSubscores?.retentionPotential ?? 0).toFixed(1)}</p>
                          </div>
                          {item.variants && item.variants.length > 0 ? (
                            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]">
                              <p className="font-semibold text-slate-700">Placar por variacao</p>
                              <div className="mt-1 space-y-1">
                                {item.variants.map((variant) => (
                                  <p key={`${task.key}-variant-${variant.variant}`} className="text-slate-700">
                                    v{variant.variant}: {variant.status}
                                    {variant.selected ? " · escolhida" : ""}
                                    {variant.heuristicScore !== null
                                      ? ` · h ${variant.heuristicScore.toFixed(2)}`
                                      : ""}
                                    {variant.judgeScore !== null
                                      ? ` · j ${variant.judgeScore.toFixed(2)}`
                                      : ""}
                                    {variant.reason ? ` · ${variant.reason}` : ""}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {item.inflationGuardApplied ? (
                            <p className="mt-1 text-[11px] text-amber-700">
                              <strong>Inflation guard:</strong> {item.inflationGuardReason ?? "aplicado"}
                            </p>
                          ) : null}
                          {alerts.length > 0 ? (
                            <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
                              <p className="font-semibold text-slate-700">Alertas acionaveis</p>
                              <div className="mt-1 space-y-1">
                                {alerts.map((alert, index) => (
                                  <p
                                    key={`${task.key}-alert-${index}`}
                                    className={`text-[11px] ${
                                      alert.level === "critical" ? "text-red-700" : "text-amber-700"
                                    }`}
                                  >
                                    {alert.level === "critical" ? "critico" : "atencao"}: {alert.text}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {item.fallbackReason ? (
                            <p className="mt-1 text-[11px] text-amber-700">
                              <strong>Fallback reason:</strong> {item.fallbackReason}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-slate-500">
                            Atualizado: {item.updatedAt}
                          </p>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            ) : null}

            {resultsView === "variants" ? (
            <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-cyan-50/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">Aba de variacoes IA</h3>
                <p className="text-[11px] text-slate-500">
                  output bruto do modelo vs output normalizado por schema
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {AI_TASKS.map((task) => {
                  const hasData = diagnosticsByTask.has(task.key);
                  const isActive = diagnosticsTaskTab === task.key;
                  return (
                    <button
                      key={`diag-tab-${task.key}`}
                      type="button"
                      disabled={!hasData}
                      onClick={() => setDiagnosticsTaskTab(task.key)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : hasData
                            ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {task.label}
                    </button>
                  );
                })}
              </div>

              {!diagnosticsTaskDetail ? (
                <p className="mt-3 text-xs text-slate-500">
                  Rode o pipeline para liberar as variacoes desta tarefa.
                </p>
              ) : diagnosticsTaskDetail.variants.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">
                  Nenhuma variacao registrada nesta execucao.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {diagnosticsTaskDetail.variants.map((variant) => (
                    <details
                      key={`${diagnosticsTaskDetail.task}-variant-detail-${variant.variant}`}
                      open={variant.selected}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                      <summary className="cursor-pointer">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-slate-900">v{variant.variant}</span>
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                                variant.status === "ok"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : variant.status === "request_failed"
                                    ? "bg-red-100 text-red-700"
                                    : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {variant.status}
                            </span>
                            {variant.selected ? (
                              <span className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                                escolhida
                              </span>
                            ) : null}
                            {variant.reason ? (
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                                {variant.reason}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[11px] text-slate-600">
                            h {variant.heuristicScore?.toFixed(2) ?? "-"} | j{" "}
                            {variant.judgeScore?.toFixed(2) ?? "-"}
                          </p>
                        </div>
                      </summary>

                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-slate-600">
                          <strong>Normalizacao:</strong> {variant.normalization ?? "nao aplicada"}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          <strong>Custo estimado:</strong> {formatUsd(variant.estimatedCostUsd)} |{" "}
                          <strong>Custo real:</strong> {formatUsd(variant.actualCostUsd)} |{" "}
                          <strong>Tokens:</strong> {variant.totalTokens ?? "-"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={
                              isSelectingVariant ||
                              variant.status !== "ok" ||
                              !variant.normalizedOutput
                            }
                            onClick={() =>
                              handleSelectVariant(diagnosticsTaskDetail.task, variant.variant)
                            }
                            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
                          >
                            {isSelectingVariant ? "Aplicando..." : "Aplicar variacao no output"}
                          </button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                            <p className="text-[11px] font-semibold text-slate-700">Output do modelo</p>
                            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-900 p-2 text-[10px] text-slate-100">
                              {formatDebugJson(variant.modelOutput)}
                            </pre>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                            <p className="text-[11px] font-semibold text-slate-700">Output normalizado</p>
                            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-900 p-2 text-[10px] text-slate-100">
                              {formatDebugJson(variant.normalizedOutput)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}

                  {variantActionMessage ? (
                    <p className="text-xs text-slate-600">{variantActionMessage}</p>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Comparador lado a lado com diff
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <label>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Variacao esquerda
                        </span>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          value={variantCompareLeft ?? ""}
                          onChange={(event) =>
                            setVariantCompareLeft(Number(event.target.value) || null)
                          }
                        >
                          {diagnosticsTaskDetail.variants.map((variant) => (
                            <option
                              key={`${diagnosticsTaskDetail.task}-compare-left-${variant.variant}`}
                              value={variant.variant}
                            >
                              v{variant.variant} · {variant.status}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Variacao direita
                        </span>
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                          value={variantCompareRight ?? ""}
                          onChange={(event) =>
                            setVariantCompareRight(Number(event.target.value) || null)
                          }
                        >
                          {diagnosticsTaskDetail.variants.map((variant) => (
                            <option
                              key={`${diagnosticsTaskDetail.task}-compare-right-${variant.variant}`}
                              value={variant.variant}
                            >
                              v{variant.variant} · {variant.status}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-[11px] font-semibold text-slate-700">
                          Esquerda v{compareVariantLeftDetail?.variant ?? "-"}
                        </p>
                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">
                          {formatDebugJson(compareVariantLeftDetail?.normalizedOutput ?? null)}
                        </pre>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="text-[11px] font-semibold text-slate-700">
                          Direita v{compareVariantRightDetail?.variant ?? "-"}
                        </p>
                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">
                          {formatDebugJson(compareVariantRightDetail?.normalizedOutput ?? null)}
                        </pre>
                      </div>
                    </div>

                    <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white">
                      <table className="w-full border-collapse text-[10px]">
                        <thead className="sticky top-0 bg-slate-100 text-slate-700">
                          <tr>
                            <th className="border-b border-slate-200 px-2 py-1 text-left">
                              esquerda
                            </th>
                            <th className="border-b border-slate-200 px-2 py-1 text-left">
                              direita
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {compareDiffRows.map((row, idx) => (
                            <tr key={`${diagnosticsTaskDetail.task}-diff-${idx}`}>
                              <td
                                className={`border-b border-slate-100 px-2 py-1 align-top font-mono ${
                                  row.changed ? "bg-amber-50" : ""
                                }`}
                              >
                                {row.left || " "}
                              </td>
                              <td
                                className={`border-b border-slate-100 px-2 py-1 align-top font-mono ${
                                  row.changed ? "bg-emerald-50" : ""
                                }`}
                              >
                                {row.right || " "}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
            ) : null}

            {resultsView === "studio" ? (
            <div className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
              <div className="flex flex-wrap gap-2">
                {RESULT_TABS.map((tab) => (
                  <button
                    key={tab.type}
                    type="button"
                    onClick={() => setActiveTab(tab.type)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      activeTab === tab.type
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">
                    {RESULT_TABS.find((tab) => tab.type === activeTab)?.label}
                  </p>
                  <div className="flex items-center gap-2">
                    {activeAsset ? (
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${badgeClass(activeAsset.status)}`}>
                        {activeAsset.status}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleCopyActiveAsset}
                      disabled={!activeAsset || isCopying}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {isCopying ? "Copiando..." : "Copiar"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={!srtId || isExportingPdf}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                    >
                      {isExportingPdf ? "Exportando..." : "Baixar PDF postagem"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportTxt}
                      disabled={!srtId || isExportingTxt}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                    >
                      {isExportingTxt ? "Exportando..." : "Baixar TXT"}
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMarkdown}
                      disabled={!srtId || isExportingMarkdown}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                    >
                      {isExportingMarkdown ? "Exportando..." : "Baixar MD"}
                    </button>
                  </div>
                </div>

                {copyMessage ? <p className="mb-2 text-xs text-slate-600">{copyMessage}</p> : null}
                {exportMessage ? <p className="mb-2 text-xs text-slate-600">{exportMessage}</p> : null}
                {canRefineActiveTab ? (
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Editor pos-geracao
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Rode um refino direcionado para elevar qualidade da aba atual.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-4">
                      {ASSET_REFINE_ACTIONS.map((item) => (
                        <button
                          key={`refine-${activeTab}-${item.id}`}
                          type="button"
                          disabled={isRefiningAsset}
                          onClick={() => handleRefineActiveAsset(item.id)}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-left transition hover:border-slate-500 disabled:opacity-60"
                          title={item.description}
                        >
                          <p className="text-xs font-semibold text-slate-900">{item.label}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{item.description}</p>
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Direcao extra opcional
                      </span>
                      <textarea
                        className="mt-1 h-16 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-slate-500"
                        value={refineInstruction}
                        onChange={(event) => setRefineInstruction(event.target.value)}
                        placeholder="Ex.: foco em diagnostico B2B, exemplos mais concretos, CTA para seguir perfil"
                      />
                    </label>
                    {refineMessage ? <p className="mt-2 text-xs text-slate-600">{refineMessage}</p> : null}
                  </div>
                ) : null}
                {canRefineActiveTab && editableBlocks.length > 0 ? (
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Studio por bloco
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Edite um trecho especifico ou regenere apenas esse bloco com IA.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      <label>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Bloco
                        </span>
                        <select
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                          value={selectedBlockPath}
                          onChange={(event) => handleChangeSelectedBlockPath(event.target.value)}
                        >
                          {editableBlocks.map((item) => (
                            <option key={`block-${item.path}`} value={item.path}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Acao IA
                        </span>
                        <select
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs"
                          value={selectedBlockAction}
                          onChange={(event) =>
                            setSelectedBlockAction(event.target.value as AssetRefineAction)
                          }
                        >
                          {ASSET_REFINE_ACTIONS.map((item) => (
                            <option key={`block-action-${item.id}`} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="mt-3 block">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Conteudo do bloco
                      </span>
                      <textarea
                        className="mt-1 h-28 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs outline-none transition focus:border-slate-500"
                        value={blockDraft}
                        onChange={(event) => setBlockDraft(event.target.value)}
                      />
                    </label>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isSavingBlock || !selectedBlockPath}
                        onClick={handleSaveSelectedBlock}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                      >
                        {isSavingBlock ? "Salvando..." : "Salvar bloco"}
                      </button>
                      <button
                        type="button"
                        disabled={isRefiningBlock || !selectedBlockPath}
                        onClick={() => handleRefineSelectedBlock(false)}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
                      >
                        {isRefiningBlock ? "Regenerando..." : "Regenerar bloco com IA"}
                      </button>
                      <button
                        type="button"
                        disabled={isRefiningBlock || !selectedBlockPath}
                        onClick={() => handleRefineSelectedBlock(true)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-60"
                      >
                        {isRefiningBlock
                          ? "Regenerando..."
                          : "Regenerar do evidence map"}
                      </button>
                    </div>
                    {blockMessage ? <p className="mt-2 text-xs text-slate-600">{blockMessage}</p> : null}
                  </div>
                ) : null}
                <AssetRenderer asset={activeAsset} />
              </div>
            </div>
            ) : null}
          </div>
        )}
      </div>
      ) : null}
      </div>
    </section>
  );
}
