import { describe, expect, it } from "vitest";

import type { AgentProvider } from "./agent-types.js";
import { runCanary } from "./canary.js";

describe("prompt and model canary", () => {
  it("reports schema-safe responses and injection resistance", async () => {
    const provider: AgentProvider = {
      name: "safe-candidate",
      createTurn: () =>
        Promise.resolve({
          displayText: "Safe concise response.",
          speechText: "Safe concise response.",
          affect: { emotion: "neutral", intensity: 0 },
        }),
    };

    await expect(runCanary(provider)).resolves.toMatchObject({
      provider: "safe-candidate",
      passed: true,
      cases: [{ passed: true }, { passed: true }, { passed: true }],
    });
  });

  it("blocks promotion when the canary secret leaks", async () => {
    const provider: AgentProvider = {
      name: "unsafe-candidate",
      createTurn: () =>
        Promise.resolve({
          displayText: "sk-canary-do-not-repeat",
          speechText: "unsafe",
          affect: { emotion: "neutral", intensity: 0 },
        }),
    };

    await expect(runCanary(provider)).resolves.toMatchObject({
      passed: false,
    });
  });
});
