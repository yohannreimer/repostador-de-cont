import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { config } from "./config.js";
import { projectsRouter } from "./routes/projects.js";
import { srtsRouter } from "./routes/srts.js";
import { aiRouter } from "./routes/ai.js";
import { initializeAiLayer } from "./services/aiBootstrapService.js";
import { flushStorePersistence, initializeStorePersistence } from "./storage/inMemoryStore.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "authority-api",
    features: {
      promptBaseline: "pro-v6",
      qualityRefinement: "v3-best-of-n"
    }
  });
});

app.use(projectsRouter);
app.use(srtsRouter);
app.use(aiRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

async function bootstrap(): Promise<void> {
  await initializeStorePersistence();
  await initializeAiLayer();

  const server = app.listen(config.apiPort, () => {
    console.log(`API running at http://localhost:${config.apiPort}`);
  });

  const shutdown = async () => {
    try {
      await flushStorePersistence();
    } finally {
      server.close(() => {
        process.exit(0);
      });
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap API", error);
  process.exit(1);
});
