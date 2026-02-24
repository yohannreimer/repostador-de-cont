import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRootDir = path.resolve(currentDir, "../../..");

// Always load monorepo root .env first, regardless of current working directory.
dotenv.config({ path: path.resolve(projectRootDir, ".env") });
// Allow extra overrides from the process current directory when present.
dotenv.config();

export const config = {
  apiPort: Number(process.env.API_PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  uploadDir: path.resolve(currentDir, "../uploads"),
  exportsDir: path.resolve(currentDir, "../exports"),
  ai: {
    persistenceBackend:
      process.env.AI_PERSISTENCE_BACKEND === "postgres" ? "postgres" : "memory",
    requestTimeoutMs: Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 120_000),
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY ?? "",
      baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? "",
      appName: process.env.OPENROUTER_APP_NAME ?? "Authority Distribution Engine"
    }
  }
};
