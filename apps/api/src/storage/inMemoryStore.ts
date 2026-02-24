import { v4 as uuidv4 } from "uuid";
import type { QueryResultRow } from "pg";
import type {
  GeneratedAsset,
  GeneratedAssetPayload,
  GeneratedAssetStatus,
  GeneratedAssetType,
  GenerationProfile,
  JobEntry,
  Project,
  SrtAsset,
  TaskGenerationDiagnostics,
  TranscriptSegment
} from "@authority/shared";
import type { Store, StoredSrtAsset } from "../types/domain.js";
import { defaultGenerationProfile } from "../services/generationProfileService.js";
import { initAiPersistenceSchema, queryAiPersistence } from "./postgres.js";

const SNAPSHOT_ID = "global";
const SNAPSHOT_DEBOUNCE_MS = 400;

interface StoreSnapshot {
  projects: Project[];
  srtAssets: StoredSrtAsset[];
  segmentsBySrt: Record<string, TranscriptSegment[]>;
  generatedAssets: GeneratedAsset[];
  generationDiagnostics: TaskGenerationDiagnostics[];
  jobs: JobEntry[];
}

interface SnapshotRow extends QueryResultRow {
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

class InMemoryStore implements Store {
  private readonly projects = new Map<string, Project>();
  private readonly srtAssets = new Map<string, StoredSrtAsset>();
  private readonly segments = new Map<string, TranscriptSegment[]>();
  private readonly generatedAssets = new Map<string, GeneratedAsset>();
  private readonly generationDiagnostics = new Map<string, TaskGenerationDiagnostics>();
  private readonly jobs = new Map<string, JobEntry>();

  private persistenceInitialized = false;
  private persistenceEnabled = false;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private snapshotWriteChain: Promise<void> = Promise.resolve();

  async initializePersistence(): Promise<void> {
    if (this.persistenceInitialized) {
      return;
    }

    this.persistenceInitialized = true;
    const hasPostgres = await initAiPersistenceSchema();
    if (!hasPostgres) {
      return;
    }

    this.persistenceEnabled = true;
    const rows = await queryAiPersistence<SnapshotRow>(
      `
        select payload
        from app_store_snapshots
        where id = $1
        limit 1
      `,
      [SNAPSHOT_ID]
    );

    const snapshot = rows?.[0]?.payload;
    if (snapshot) {
      this.restoreSnapshot(snapshot);
    }
  }

  async flushPersistence(): Promise<void> {
    if (!this.persistenceEnabled) {
      return;
    }

    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
      this.enqueueSnapshotPersist();
    }

    await this.snapshotWriteChain;
  }

  private buildSnapshot(): StoreSnapshot {
    const segmentsBySrt: Record<string, TranscriptSegment[]> = {};
    for (const [srtAssetId, segments] of this.segments.entries()) {
      segmentsBySrt[srtAssetId] = cloneDeep(segments);
    }

    return {
      projects: cloneDeep([...this.projects.values()]),
      srtAssets: cloneDeep([...this.srtAssets.values()]),
      segmentsBySrt,
      generatedAssets: cloneDeep([...this.generatedAssets.values()]),
      generationDiagnostics: cloneDeep([...this.generationDiagnostics.values()]),
      jobs: cloneDeep([...this.jobs.values()])
    };
  }

  private restoreSnapshot(raw: unknown): void {
    if (!isRecord(raw)) {
      return;
    }

    this.projects.clear();
    this.srtAssets.clear();
    this.segments.clear();
    this.generatedAssets.clear();
    this.generationDiagnostics.clear();
    this.jobs.clear();

    for (const project of asArray<Project>(raw.projects)) {
      if (project?.id) {
        this.projects.set(project.id, project);
      }
    }

    for (const asset of asArray<StoredSrtAsset>(raw.srtAssets)) {
      if (asset?.id) {
        this.srtAssets.set(asset.id, asset);
      }
    }

    if (isRecord(raw.segmentsBySrt)) {
      for (const [srtAssetId, segments] of Object.entries(raw.segmentsBySrt)) {
        if (Array.isArray(segments)) {
          this.segments.set(srtAssetId, segments as TranscriptSegment[]);
        }
      }
    }

    for (const asset of asArray<GeneratedAsset>(raw.generatedAssets)) {
      if (asset?.id) {
        this.generatedAssets.set(asset.id, asset);
      }
    }

    for (const item of asArray<TaskGenerationDiagnostics>(raw.generationDiagnostics)) {
      if (item?.srtAssetId && item?.task) {
        const key = `${item.srtAssetId}:${item.task}`;
        this.generationDiagnostics.set(key, item);
      }
    }

    for (const job of asArray<JobEntry>(raw.jobs)) {
      if (job?.id) {
        this.jobs.set(job.id, job);
      }
    }
  }

  private scheduleSnapshotPersist(): void {
    if (!this.persistenceEnabled) {
      return;
    }

    if (this.snapshotTimer) {
      return;
    }

    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.enqueueSnapshotPersist();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private enqueueSnapshotPersist(): void {
    if (!this.persistenceEnabled) {
      return;
    }

    const snapshot = this.buildSnapshot();
    this.snapshotWriteChain = this.snapshotWriteChain
      .then(async () => {
        await queryAiPersistence(
          `
            insert into app_store_snapshots (id, payload, updated_at)
            values ($1, $2::jsonb, now())
            on conflict (id)
            do update set
              payload = excluded.payload,
              updated_at = now()
          `,
          [SNAPSHOT_ID, JSON.stringify(snapshot)]
        );
      })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : "unknown snapshot persistence error";
        console.warn(`[store] failed to persist snapshot: ${reason}`);
      });
  }

  createProject(name: string): Project {
    const project: Project = {
      id: uuidv4(),
      name,
      createdAt: new Date().toISOString()
    };

    this.projects.set(project.id, project);
    this.scheduleSnapshotPersist();
    return project;
  }

  listProjects(): Project[] {
    return [...this.projects.values()].sort((a, b) =>
      a.createdAt > b.createdAt ? -1 : 1
    );
  }

  getProject(projectId: string): Project | undefined {
    return this.projects.get(projectId);
  }

  createSrtAsset(params: {
    projectId: string;
    filename: string;
    filePath: string;
    language?: string;
    generationProfile?: GenerationProfile;
  }): StoredSrtAsset {
    const asset: StoredSrtAsset = {
      id: uuidv4(),
      projectId: params.projectId,
      filename: params.filename,
      filePath: params.filePath,
      language: params.language ?? params.generationProfile?.language ?? "pt-BR",
      generationProfile: params.generationProfile ?? defaultGenerationProfile(),
      durationSec: null,
      status: "uploaded",
      createdAt: new Date().toISOString()
    };

    this.srtAssets.set(asset.id, asset);
    this.segments.set(asset.id, []);
    this.scheduleSnapshotPersist();
    return asset;
  }

  getSrtAsset(id: string): StoredSrtAsset | undefined {
    return this.srtAssets.get(id);
  }

  updateSrtAssetStatus(id: string, status: SrtAsset["status"]): StoredSrtAsset | undefined {
    const current = this.srtAssets.get(id);
    if (!current) {
      return undefined;
    }

    const next: StoredSrtAsset = {
      ...current,
      status
    };

    this.srtAssets.set(id, next);
    this.scheduleSnapshotPersist();
    return next;
  }

  updateSrtAssetGenerationProfile(
    id: string,
    generationProfile: GenerationProfile
  ): StoredSrtAsset | undefined {
    const current = this.srtAssets.get(id);
    if (!current) {
      return undefined;
    }

    const next: StoredSrtAsset = {
      ...current,
      language: generationProfile.language,
      generationProfile
    };

    this.srtAssets.set(id, next);
    this.scheduleSnapshotPersist();
    return next;
  }

  listSrtAssets(projectId?: string): StoredSrtAsset[] {
    const all = [...this.srtAssets.values()];
    const filtered = projectId ? all.filter((asset) => asset.projectId === projectId) : all;

    return filtered.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  replaceSegments(srtAssetId: string, segments: TranscriptSegment[]): void {
    this.segments.set(srtAssetId, segments);

    const asset = this.srtAssets.get(srtAssetId);
    if (asset) {
      const durationSec =
        segments.length > 0
          ? Math.ceil(segments[segments.length - 1]?.endMs / 1000)
          : 0;
      this.srtAssets.set(srtAssetId, { ...asset, durationSec });
    }

    this.scheduleSnapshotPersist();
  }

  getSegments(srtAssetId: string): TranscriptSegment[] {
    return this.segments.get(srtAssetId) ?? [];
  }

  upsertGeneratedAsset(input: {
    srtAssetId: string;
    type: GeneratedAssetType;
    status: GeneratedAssetStatus;
    payload: GeneratedAssetPayload;
  }): GeneratedAsset {
    const latest = this.getGeneratedAssetByType(input.srtAssetId, input.type);

    const asset: GeneratedAsset = {
      id: uuidv4(),
      srtAssetId: input.srtAssetId,
      type: input.type,
      version: latest ? latest.version + 1 : 1,
      status: input.status,
      payload: input.payload,
      createdAt: new Date().toISOString()
    };

    this.generatedAssets.set(asset.id, asset);
    this.scheduleSnapshotPersist();
    return asset;
  }

  listGeneratedAssets(srtAssetId: string): GeneratedAsset[] {
    return [...this.generatedAssets.values()]
      .filter((asset) => asset.srtAssetId === srtAssetId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  getGeneratedAssetByType(
    srtAssetId: string,
    type: GeneratedAssetType
  ): GeneratedAsset | null {
    return (
      this.listGeneratedAssets(srtAssetId).find((asset) => asset.type === type) ?? null
    );
  }

  upsertGenerationDiagnostics(
    input: Omit<TaskGenerationDiagnostics, "updatedAt">
  ): TaskGenerationDiagnostics {
    const key = `${input.srtAssetId}:${input.task}`;
    const next: TaskGenerationDiagnostics = {
      ...input,
      updatedAt: new Date().toISOString()
    };

    this.generationDiagnostics.set(key, next);
    this.scheduleSnapshotPersist();
    return next;
  }

  listGenerationDiagnostics(srtAssetId: string): TaskGenerationDiagnostics[] {
    return [...this.generationDiagnostics.values()]
      .filter((item) => item.srtAssetId === srtAssetId)
      .sort((a, b) => a.task.localeCompare(b.task));
  }

  createJob(srtAssetId: string, name: string): JobEntry {
    const now = new Date().toISOString();

    const job: JobEntry = {
      id: uuidv4(),
      srtAssetId,
      name,
      status: "queued",
      attempts: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now
    };

    this.jobs.set(job.id, job);
    this.scheduleSnapshotPersist();
    return job;
  }

  updateJob(
    id: string,
    patch: Partial<
      Pick<JobEntry, "status" | "attempts" | "error" | "startedAt" | "finishedAt">
    >
  ): JobEntry | undefined {
    const current = this.jobs.get(id);
    if (!current) {
      return undefined;
    }

    const next: JobEntry = {
      ...current,
      ...patch
    };

    this.jobs.set(id, next);
    this.scheduleSnapshotPersist();
    return next;
  }

  listJobs(srtAssetId: string): JobEntry[] {
    return [...this.jobs.values()]
      .filter((job) => job.srtAssetId === srtAssetId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  getLatestJob(srtAssetId: string): JobEntry | null {
    return this.listJobs(srtAssetId)[0] ?? null;
  }
}

export const store = new InMemoryStore();

export async function initializeStorePersistence(): Promise<void> {
  await store.initializePersistence();
}

export async function flushStorePersistence(): Promise<void> {
  await store.flushPersistence();
}
