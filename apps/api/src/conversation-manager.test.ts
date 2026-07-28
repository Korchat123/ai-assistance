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

  it("uses a bounded specialist finding only for explicit analysis", async () => {
    const contexts: unknown[] = [];
    let invocation = 0;
    const routedProvider: AgentProvider = {
      name: "routed-test",
      createTurn: (_messages, _signal, context) => {
        contexts.push(context);
        invocation += 1;
        return Promise.resolve({
          displayText:
            invocation === 1 ? "Specialist evidence." : "Manager synthesis.",
          speechText: invocation === 1 ? "Evidence." : "Synthesis.",
          affect: { emotion: "neutral", intensity: 0 },
        });
      },
    };
    const manager = new ConversationManager(routedProvider);
    const events: ConversationEvent[] = [];

    await manager.startTurn(
      "/analyze const value = input.name",
      new AbortController().signal,
      (event) => events.push(event),
    );

    expect(manager.specialistRuns).toHaveLength(1);
    expect(manager.specialistRuns[0]?.metrics.toolCalls).toBe(0);
    expect(contexts[0]).toEqual({ memories: [] });
    expect(contexts[1]).toMatchObject({
      specialistFindings: ["Specialist evidence."],
    });
    expect(
      events.find((event) => event.type === "text.completed"),
    ).toMatchObject({
      turn: { displayText: "Manager synthesis." },
    });
  });
});
