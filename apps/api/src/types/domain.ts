import type {
  GeneratedAsset,
  GeneratedAssetPayload,
  GeneratedAssetStatus,
  GeneratedAssetType,
  TaskGenerationDiagnostics,
  GenerationProfile,
  JobEntry,
  Project,
  SrtAsset,
  TranscriptSegment
} from "@authority/shared";

export interface StoredSrtAsset extends SrtAsset {
  filePath: string;
}

export interface Store {
  createProject(name: string): Project;
  listProjects(): Project[];
  getProject(projectId: string): Project | undefined;

  createSrtAsset(params: {
    projectId: string;
    filename: string;
    filePath: string;
    language?: string;
    generationProfile?: GenerationProfile;
  }): StoredSrtAsset;
  getSrtAsset(id: string): StoredSrtAsset | undefined;
  updateSrtAssetStatus(id: string, status: SrtAsset["status"]): StoredSrtAsset | undefined;
  updateSrtAssetGenerationProfile(
    id: string,
    generationProfile: GenerationProfile
  ): StoredSrtAsset | undefined;
  listSrtAssets(projectId?: string): StoredSrtAsset[];

  replaceSegments(srtAssetId: string, segments: TranscriptSegment[]): void;
  getSegments(srtAssetId: string): TranscriptSegment[];

  upsertGeneratedAsset(input: {
    srtAssetId: string;
    type: GeneratedAssetType;
    status: GeneratedAssetStatus;
    payload: GeneratedAssetPayload;
  }): GeneratedAsset;
  listGeneratedAssets(srtAssetId: string): GeneratedAsset[];
  getGeneratedAssetByType(
    srtAssetId: string,
    type: GeneratedAssetType
  ): GeneratedAsset | null;

  upsertGenerationDiagnostics(
    input: Omit<TaskGenerationDiagnostics, "updatedAt">
  ): TaskGenerationDiagnostics;
  listGenerationDiagnostics(srtAssetId: string): TaskGenerationDiagnostics[];

  createJob(srtAssetId: string, name: string): JobEntry;
  updateJob(
    id: string,
    patch: Partial<
      Pick<JobEntry, "status" | "attempts" | "error" | "startedAt" | "finishedAt">
    >
  ): JobEntry | undefined;
  listJobs(srtAssetId: string): JobEntry[];
  getLatestJob(srtAssetId: string): JobEntry | null;
}
