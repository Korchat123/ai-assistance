import { describe, expect, it } from "vitest";

import type { AgentProvider } from "./agent-types.js";
import { ConversationManager, type ConversationEvent } from "./conversation-manager.js";

const provider: AgentProvider = {
  name: "test",
  createTurn: () => Promise.resolve({
    displayText: "Done.",
    speechText: "Done.",
    affect: { emotion: "neutral", intensity: 0 },
  }),
};

describe("conversation manager approvals", () => {
  it("pauses and resumes a Level 1 tool with exact approval ID", async () => {
    const manager = new ConversationManager(provider);
    const events: ConversationEvent[] = [];
    const result = await manager.startTurn(
      "/set theme blue",
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(result.status).toBe("waiting_approval");
    expect(events.at(-1)?.type).toBe("approval.required");
    await expect(manager.resolveApproval("wrong", "approved")).resolves.toBe(
      "not_found",
    );
    await expect(
      manager.resolveApproval(result.approvalId!, "approved"),
    ).resolves.toBe("completed");
    expect(events.some((event) => event.type === "tool.completed")).toBe(true);
    expect(events.some((event) => event.type === "text.completed")).toBe(true);
  });

  it("does not execute a denied Level 1 tool", async () => {
    const manager = new ConversationManager(provider);
    const result = await manager.startTurn(
      "/set theme red",
      new AbortController().signal,
      () => undefined,
    );

    await expect(
      manager.resolveApproval(result.approvalId!, "denied"),
    ).resolves.toBe("denied");
    expect(
      manager.tools.audit.some((entry) => entry.state === "running"),
    ).toBe(false);
  });
});
