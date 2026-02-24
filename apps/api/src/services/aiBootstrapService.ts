import { initializeAiRouting } from "./aiRoutingService.js";
import { initializePromptTemplates } from "./promptTemplateService.js";
import { initializeAiPreferences } from "./aiPreferencesService.js";

let initialized = false;

export async function initializeAiLayer(): Promise<void> {
  if (initialized) {
    return;
  }

  await initializeAiRouting();
  await initializePromptTemplates();
  await initializeAiPreferences();
  initialized = true;
}
