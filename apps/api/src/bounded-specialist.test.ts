import { describe, expect, it, vi } from "vitest";

import type { AgentProvider } from "./agent-types.js";
import {
  BoundedCodeAnalysisSpecialist,
  estimateTokens,
} from "./bounded-specialist.js";

function providerWith(
  createTurn: AgentProvider["createTurn"],
): AgentProvider {
  return { name: "specialist-test", createTurn };
}

describe("bounded code-analysis specialist", () => {
  it("returns a read-only result with measurable zero-tool limits", async () => {
    const createTurn = vi.fn<AgentProvider["createTurn"]>().mockResolvedValue({
      displayText: "Evidence: the supplied function has no null guard.",
      speechText: "A null guard is missing.",
      affect: { emotion: "thinking", intensity: 0.2 },
    });
    const specialist = new BoundedCodeAnalysisSpecialist(
      providerWith(createTurn),
    );

    const result = await specialist.run(
      "Review function read(value) { return value.name }",
      new AbortController().signal,
    );

    expect(result.status).toBe("completed");
    expect(result.finding).toContain("Evidence");
    expect(result.metrics).toMatchObject({
      agents: 1,
      depth: 1,
      toolCalls: 0,
      retries: 0,
      estimatedCostUsd: 0,
    });
    expect(createTurn).toHaveBeenCalledTimes(1);
    expect(createTurn.mock.calls[0]?.[2]).toEqual({ memories: [] });
  });

  it("rejects oversized input before invoking a model", async () => {
    const createTurn = vi.fn<AgentProvider["createTurn"]>();
    const specialist = new BoundedCodeAnalysisSpecialist(
      providerWith(createTurn),
    );
    const request = "x".repeat(3_201);

    const result = await specialist.run(
      request,
      new AbortController().signal,
    );

    expect(estimateTokens(request)).toBeGreaterThan(800);
    expect(result.status).toBe("input_limit");
    expect(result.metrics.agents).toBe(0);
    expect(createTurn).not.toHaveBeenCalled();
  });

  it("enforces one concurrent run", async () => {
    let resolveFirst: ((value: Awaited<ReturnType<AgentProvider["createTurn"]>>) => void) | undefined;
    const createTurn = vi.fn<AgentProvider["createTurn"]>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const specialist = new BoundedCodeAnalysisSpecialist(
      providerWith(createTurn),
    );
    const first = specialist.run("first", new AbortController().signal);
    const second = await specialist.run("second", new AbortController().signal);

    expect(second.status).toBe("busy");
    resolveFirst?.({
      displayText: "First complete.",
      speechText: "First complete.",
      affect: { emotion: "neutral", intensity: 0 },
    });
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("enforces the configured timeout without retrying", async () => {
    const createTurn = vi.fn<AgentProvider["createTurn"]>().mockImplementation(
      (_messages, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const specialist = new BoundedCodeAnalysisSpecialist(
      providerWith(createTurn),
      {
        maxAgents: 1,
        maxConcurrency: 1,
        maxDepth: 1,
        maxInputTokens: 800,
        maxOutputTokens: 400,
        maxToolCalls: 0,
        maxRetries: 0,
        timeoutMs: 10,
      },
    );

    const result = await specialist.run(
      "slow request",
      new AbortController().signal,
    );

    expect(result.status).toBe("timed_out");
    expect(result.metrics.retries).toBe(0);
    expect(createTurn).toHaveBeenCalledTimes(1);
  });
});
