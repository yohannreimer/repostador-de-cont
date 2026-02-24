import test from "node:test";
import assert from "node:assert/strict";
import { getAiRoutingResponse, updateAiRouting } from "../services/aiRoutingService.js";

test("ai routing exposes all tasks", () => {
  const response = getAiRoutingResponse();

  assert.ok(response.routing.analysis);
  assert.ok(response.routing.reels);
  assert.ok(response.routing.newsletter);
  assert.ok(response.routing.linkedin);
  assert.ok(response.routing.x);
});

test("ai routing allows per-task provider/model update", async () => {
  const updated = await updateAiRouting({
    analysis: {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      temperature: 0.4
    }
  });

  assert.equal(updated.routing.analysis.provider, "openrouter");
  assert.equal(updated.routing.analysis.model, "openai/gpt-4o-mini");
  assert.equal(updated.routing.analysis.temperature, 0.4);
});

test("ai routing allows judge routing update", async () => {
  const updated = await updateAiRouting({
    judgeRouting: {
      reels: {
        provider: "openai",
        model: "gpt-5-mini",
        temperature: 0.1
      }
    }
  });

  assert.equal(updated.judgeRouting.reels.provider, "openai");
  assert.equal(updated.judgeRouting.reels.model, "gpt-5-mini");
  assert.equal(updated.judgeRouting.reels.temperature, 0.1);
});
