import { store } from "../storage/inMemoryStore.js";

type QueueHandler = () => Promise<void>;

export function enqueueLocalJob(srtAssetId: string, name: string, handler: QueueHandler): void {
  const job = store.createJob(srtAssetId, name);

  setImmediate(async () => {
    store.updateJob(job.id, {
      status: "running",
      attempts: job.attempts + 1,
      startedAt: new Date().toISOString(),
      error: null
    });

    try {
      await handler();
      store.updateJob(job.id, {
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        error: null
      });
    } catch (error) {
      store.updateJob(job.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown queue error"
      });
      store.updateSrtAssetStatus(srtAssetId, "failed");
    }
  });
}
