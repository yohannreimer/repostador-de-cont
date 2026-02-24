import { Router } from "express";
import { z } from "zod";
import type {
  ProjectHistoryItem,
  ProjectHistoryResponse,
  TaskGenerationDiagnostics
} from "@authority/shared";
import { store } from "../storage/inMemoryStore.js";

const createProjectSchema = z.object({
  name: z.string().min(2).max(80)
});

export const projectsRouter = Router();
const TASK_COUNT = 5;

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
  if (typeof item.judgeQualityScore === "number" && Number.isFinite(item.judgeQualityScore)) {
    return item.judgeQualityScore;
  }
  return item.qualityFinal;
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

function isReadyForPublish(item: TaskGenerationDiagnostics): boolean {
  const qualityScore = resolveQualityScore(item);
  const publishabilityScore = resolvePublishabilityScore(item);
  const meetsQuality =
    typeof item.meetsQualityThreshold === "boolean"
      ? item.meetsQualityThreshold
      : qualityScore >= item.qualityThreshold;
  const meetsPublishability =
    typeof item.meetsPublishabilityThreshold === "boolean"
      ? item.meetsPublishabilityThreshold
      : publishabilityScore >= resolvePublishabilityThreshold(item);
  return meetsQuality && meetsPublishability;
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function sumAsCurrency(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return Number(total.toFixed(4));
}

projectsRouter.get("/projects", (_req, res) => {
  res.json({ projects: store.listProjects() });
});

projectsRouter.get("/projects/:id/history", (req, res) => {
  const project = store.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const items: ProjectHistoryItem[] = store.listSrtAssets(project.id).map((asset) => {
    const diagnostics = store.listGenerationDiagnostics(asset.id);
    const qualityValues = diagnostics.map((item) => resolveQualityScore(item));
    const publishabilityValues = diagnostics.map((item) => resolvePublishabilityScore(item));
    const readyTasks = diagnostics.filter((item) => isReadyForPublish(item)).length;

    return {
      srtAssetId: asset.id,
      filename: asset.filename,
      language: asset.language,
      durationSec: asset.durationSec,
      status: asset.status,
      createdAt: asset.createdAt,
      segmentCount: store.getSegments(asset.id).length,
      latestJob: store.getLatestJob(asset.id),
      readyTasks,
      totalTasks: TASK_COUNT,
      qualityAvg: average(qualityValues),
      publishabilityAvg: average(publishabilityValues),
      totalEstimatedCostUsd: sumAsCurrency(
        diagnostics.map((item) => item.estimatedCostUsd)
      ),
      totalActualCostUsd: sumAsCurrency(
        diagnostics.map((item) => item.actualCostUsd)
      )
    };
  });

  const response: ProjectHistoryResponse = {
    project,
    items
  };

  return res.json(response);
});

projectsRouter.post("/projects", (req, res) => {
  const result = createProjectSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: result.error.flatten()
    });
  }

  const project = store.createProject(result.data.name);
  return res.status(201).json({ project });
});
