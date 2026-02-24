import type {
  AIPreferencesResponse,
  AssetRefineAction,
  AIModelsResponse,
  AIRoute,
  AIRoutingResponse,
  AITask,
  GenerationProfile,
  GeneratedAssetPayload,
  GeneratedAssetType,
  OpenRouterModelFamilyByTask,
  PromptCatalogResponse,
  Project,
  ProjectHistoryResponse,
  RefineAssetBlockResponse,
  RefineAssetResponse,
  SaveAssetManualResponse,
  SelectAssetVariantResponse,
  SrtDiagnosticsResponse,
  SrtAssetByTypeResponse,
  SrtAssetsResponse,
  SrtDetailResponse,
  SrtJobsResponse,
  UpdateSrtProfileResponse,
  UploadSrtResponse
} from "@authority/shared";

function normalizeApiBaseUrl(raw: string | undefined): string {
  const fallback =
    typeof window !== "undefined" ? `${window.location.origin}/api` : "http://localhost:4000";
  const candidate = (raw ?? "").trim();

  if (!candidate) {
    return fallback;
  }

  const withoutTrailingSlash = candidate.replace(/\/+$/, "");

  if (withoutTrailingSlash.startsWith("/")) {
    return withoutTrailingSlash;
  }

  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }

  // Accept host/path values passed without scheme in deployment dashboards.
  if (/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(withoutTrailingSlash)) {
    return `https://${withoutTrailingSlash}`;
  }

  return withoutTrailingSlash;
}

const API_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);

function apiUrl(pathname: string): string {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${API_URL}${path}`;
}

interface CreateProjectResponse {
  project: {
    id: string;
    name: string;
    createdAt: string;
  };
}

interface ProjectsResponse {
  projects: Project[];
}

export async function createProject(name: string): Promise<CreateProjectResponse["project"]> {
  const response = await fetch(apiUrl("/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    throw new Error("Failed to create project");
  }

  const payload = (await response.json()) as CreateProjectResponse;
  return payload.project;
}

export async function getProjects(): Promise<Project[]> {
  const response = await fetch(apiUrl("/projects"), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch projects");
  }

  const payload = (await response.json()) as ProjectsResponse;
  return payload.projects;
}

export async function getProjectHistory(projectId: string): Promise<ProjectHistoryResponse> {
  const response = await fetch(apiUrl(`/projects/${projectId}/history`), {
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to fetch project history" }));
    throw new Error(error.error ?? "Failed to fetch project history");
  }

  return (await response.json()) as ProjectHistoryResponse;
}

export async function uploadSrt(
  projectId: string,
  file: File,
  options?: { generationProfile?: GenerationProfile }
): Promise<UploadSrtResponse> {
  const data = new FormData();
  data.set("file", file);
  if (options?.generationProfile) {
    data.set("generationProfile", JSON.stringify(options.generationProfile));
  }

  const response = await fetch(apiUrl(`/projects/${projectId}/srts`), {
    method: "POST",
    body: data
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(error.error ?? "Upload failed");
  }

  return (await response.json()) as UploadSrtResponse;
}

export async function updateSrtGenerationProfile(
  srtId: string,
  generationProfile: GenerationProfile,
  rerun = true
): Promise<UpdateSrtProfileResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/profile`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationProfile, rerun })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to update profile" }));
    throw new Error(error.error ?? "Failed to update profile");
  }

  return (await response.json()) as UpdateSrtProfileResponse;
}

export async function getSrtDetail(srtId: string): Promise<SrtDetailResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}`), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch SRT detail");
  }

  return (await response.json()) as SrtDetailResponse;
}

export async function getSrtJobs(srtId: string): Promise<SrtJobsResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/jobs`), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch SRT jobs");
  }

  return (await response.json()) as SrtJobsResponse;
}

export async function getSrtAssets(srtId: string): Promise<SrtAssetsResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/assets`), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch generated assets");
  }

  return (await response.json()) as SrtAssetsResponse;
}

export async function downloadSrtPdfExport(srtId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/srts/${srtId}/export/pdf`), {
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to export PDF" }));
    throw new Error(error.error ?? "Failed to export PDF");
  }

  return response.blob();
}

export async function downloadSrtTxtExport(srtId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/srts/${srtId}/export/txt`), {
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to export TXT" }));
    throw new Error(error.error ?? "Failed to export TXT");
  }

  return response.blob();
}

export async function downloadSrtMarkdownExport(srtId: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/srts/${srtId}/export/markdown`), {
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to export Markdown" }));
    throw new Error(error.error ?? "Failed to export Markdown");
  }

  return response.blob();
}

export async function getSrtDiagnostics(srtId: string): Promise<SrtDiagnosticsResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/diagnostics`), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Failed to fetch generation diagnostics");
  }

  return (await response.json()) as SrtDiagnosticsResponse;
}

export async function getSrtAssetByType(
  srtId: string,
  type: GeneratedAssetType
): Promise<SrtAssetByTypeResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/assets/${type}`), {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch asset type ${type}`);
  }

  return (await response.json()) as SrtAssetByTypeResponse;
}

export async function refineSrtAsset(
  srtId: string,
  type: GeneratedAssetType,
  action: AssetRefineAction,
  instruction?: string
): Promise<RefineAssetResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/assets/${type}/refine`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      instruction: instruction?.trim() || undefined
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to refine asset" }));
    throw new Error(error.error ?? "Failed to refine asset");
  }

  return (await response.json()) as RefineAssetResponse;
}

export async function refineSrtAssetBlock(
  srtId: string,
  type: GeneratedAssetType,
  blockPath: string,
  action: AssetRefineAction,
  instruction?: string,
  evidenceOnly = false
): Promise<RefineAssetBlockResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/assets/${type}/blocks/refine`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blockPath,
      action,
      instruction: instruction?.trim() || undefined,
      evidenceOnly
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to refine asset block" }));
    throw new Error(error.error ?? "Failed to refine asset block");
  }

  return (await response.json()) as RefineAssetBlockResponse;
}

export async function selectSrtAssetVariant(
  srtId: string,
  task: AITask,
  variant: number
): Promise<SelectAssetVariantResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/diagnostics/${task}/select-variant`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to select variant" }));
    throw new Error(error.error ?? "Failed to select variant");
  }

  return (await response.json()) as SelectAssetVariantResponse;
}

export async function saveSrtAssetManual(
  srtId: string,
  type: GeneratedAssetType,
  payload: GeneratedAssetPayload
): Promise<SaveAssetManualResponse> {
  const response = await fetch(apiUrl(`/srts/${srtId}/assets/${type}/manual`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to save manual asset" }));
    throw new Error(error.error ?? "Failed to save manual asset");
  }

  return (await response.json()) as SaveAssetManualResponse;
}

export async function getAiRouting(): Promise<AIRoutingResponse> {
  const response = await fetch(apiUrl("/ai/routing"), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch AI routing");
  }

  return (await response.json()) as AIRoutingResponse;
}

export async function getAiPreferences(): Promise<AIPreferencesResponse> {
  const response = await fetch(apiUrl("/ai/preferences"), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch AI preferences");
  }

  return (await response.json()) as AIPreferencesResponse;
}

export async function patchAiPreferences(patch: {
  generationProfile?: GenerationProfile;
  modelFamilyByTask?: Partial<OpenRouterModelFamilyByTask>;
}): Promise<AIPreferencesResponse> {
  const response = await fetch(apiUrl("/ai/preferences"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to update AI preferences" }));
    throw new Error(error.error ?? "Failed to update AI preferences");
  }

  return (await response.json()) as AIPreferencesResponse;
}

export async function patchAiRouting(
  patch:
    | Partial<Record<AITask, Partial<AIRoute>>>
    | {
        routing?: Partial<Record<AITask, Partial<AIRoute>>>;
        judgeRouting?: Partial<Record<AITask, Partial<AIRoute>>>;
      }
): Promise<AIRoutingResponse> {
  const response = await fetch(apiUrl("/ai/routing"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to update AI routing" }));
    throw new Error(error.error ?? "Failed to update AI routing");
  }

  return (await response.json()) as AIRoutingResponse;
}

export async function getAiModels(
  provider: "openai" | "openrouter",
  forceRefresh = false
): Promise<AIModelsResponse> {
  const search = new URLSearchParams({ provider });
  if (forceRefresh) {
    search.set("force_refresh", "1");
  }
  const response = await fetch(`${apiUrl("/ai/models")}?${search.toString()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to fetch AI models" }));
    throw new Error(error.error ?? "Failed to fetch AI models");
  }

  return (await response.json()) as AIModelsResponse;
}

export async function getAiPrompts(): Promise<PromptCatalogResponse> {
  const response = await fetch(apiUrl("/ai/prompts"), { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to fetch AI prompts");
  }

  return (await response.json()) as PromptCatalogResponse;
}

export async function createAiPromptVersion(
  task: AITask,
  input: {
    name: string;
    systemPrompt: string;
    userPromptTemplate: string;
    activate?: boolean;
  }
): Promise<PromptCatalogResponse> {
  const response = await fetch(apiUrl(`/ai/prompts/${task}/versions`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to create prompt version" }));
    throw new Error(error.error ?? "Failed to create prompt version");
  }

  return (await response.json()) as PromptCatalogResponse;
}

export async function activateAiPromptVersion(
  task: AITask,
  version: number
): Promise<PromptCatalogResponse> {
  const response = await fetch(apiUrl(`/ai/prompts/${task}/activate`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to activate prompt version" }));
    throw new Error(error.error ?? "Failed to activate prompt version");
  }

  return (await response.json()) as PromptCatalogResponse;
}
