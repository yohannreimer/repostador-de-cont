import test from "node:test";
import assert from "node:assert/strict";
import { renderPromptForTask } from "../services/promptTemplateService.js";

test("renderPromptForTask replaces template variables", () => {
  const prompt = renderPromptForTask("analysis", {
    transcript_excerpt: "linha de teste"
  });

  assert.ok(prompt.systemPrompt.length > 0);
  assert.ok(prompt.userPrompt.includes("linha de teste"));
  assert.equal(prompt.userPrompt.includes("{{transcript_excerpt}}"), false);
});
