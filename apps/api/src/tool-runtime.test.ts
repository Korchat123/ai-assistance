import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ToolRuntime, redact } from "./tool-runtime.js";

describe("tool runtime policy", () => {
  it("runs the Level 0 read-only tool and records an audit trail", async () => {
    const runtime = new ToolRuntime();
    const call = runtime.propose("read_context", { key: "project" });
    const output = await runtime.execute(call, new AbortController().signal);

    expect(call.riskLevel).toBe(0);
    expect(output).toContain("Live2D");
    expect(runtime.audit.map((entry) => entry.state)).toEqual([
      "proposed",
      "running",
      "succeeded",
    ]);
  });

  it("redacts secrets from output and audit data", async () => {
    const runtime = new ToolRuntime();
    runtime.register({
      name: "secret_test",
      riskLevel: 0,
      input: z.object({ token: z.string() }),
      timeoutMs: 100,
      execute: () => Promise.resolve("api_key=super-secret"),
    });
    const call = runtime.propose("secret_test", { token: "private-value" });
    const output = await runtime.execute(call, new AbortController().signal);

    expect(output).toBe("api_key=[REDACTED]");
    expect(JSON.stringify(runtime.audit)).not.toContain("super-secret");
    expect(redact("authorization: bearer-secret")).toBe(
      "authorization=[REDACTED]",
    );
  });

  it("cancels an in-flight tool", async () => {
    const runtime = new ToolRuntime();
    runtime.register({
      name: "cancel_test",
      riskLevel: 0,
      input: z.object({}),
      timeoutMs: 1_000,
      execute: async (_input, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(toError(signal.reason)), {
            once: true,
          });
        }),
    });
    const call = runtime.propose("cancel_test", {});
    const controller = new AbortController();
    const pending = runtime.execute(call, controller.signal);
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(runtime.audit.at(-1)?.state).toBe("cancelled");
  });

  it("times out a slow tool", async () => {
    const runtime = new ToolRuntime();
    runtime.register({
      name: "timeout_test",
      riskLevel: 0,
      input: z.object({}),
      timeoutMs: 5,
      execute: async (_input, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(toError(signal.reason)), {
            once: true,
          });
        }),
    });
    const call = runtime.propose("timeout_test", {});

    await expect(
      runtime.execute(call, new AbortController().signal),
    ).rejects.toThrow("Tool timed out");
    expect(runtime.audit.at(-1)?.state).toBe("timed_out");
  });
});

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
