import test from "node:test";
import assert from "node:assert/strict";
import {
  activatePromptVersion,
  createPromptVersion,
  getPromptCatalogResponse,
  getActivePromptTemplate
} from "../services/promptTemplateService.js";

test("prompt versioning creates and activates versions by task", async () => {
  const before = getPromptCatalogResponse();
  const previousActive = before.prompts.analysis.activeVersion;

  const created = await createPromptVersion("analysis", {
    name: "analysis-v2-test",
    systemPrompt: "Teste de system prompt para analise.",
    userPromptTemplate: "Prompt usuario {{transcript_excerpt}}",
    activate: true
  });

  assert.ok(created.prompts.analysis.activeVersion > previousActive);

  const active = getActivePromptTemplate("analysis");
  assert.equal(active.version, created.prompts.analysis.activeVersion);
  assert.equal(active.name, "analysis-v2-test");

  const reverted = await activatePromptVersion("analysis", previousActive);
  assert.equal(reverted.prompts.analysis.activeVersion, previousActive);
});
