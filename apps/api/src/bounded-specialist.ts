import type { AgentProvider } from "./agent-types.js";

export const SPECIALIST_LIMITS = {
  maxAgents: 1,
  maxConcurrency: 1,
  maxDepth: 1,
  maxInputTokens: 800,
  maxOutputTokens: 400,
  maxToolCalls: 0,
  maxRetries: 0,
  timeoutMs: 3_000,
} as const;

export type SpecialistStatus =
  | "completed"
  | "busy"
  | "input_limit"
  | "timed_out"
  | "failed";

export interface SpecialistRun {
  status: SpecialistStatus;
  finding?: string;
  metrics: {
    depth: number;
    agents: number;
    toolCalls: number;
    retries: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  };
}

export class BoundedCodeAnalysisSpecialist {
  private activeRuns = 0;

  public constructor(
    private readonly provider: AgentProvider,
    private readonly limits = SPECIALIST_LIMITS,
  ) {}

  public async run(
    request: string,
    parentSignal: AbortSignal,
    depth = 1,
  ): Promise<SpecialistRun> {
    const startedAt = performance.now();
    const inputTokens = estimateTokens(request);
    if (depth > this.limits.maxDepth || inputTokens > this.limits.maxInputTokens) {
      return this.result(
        "input_limit",
        startedAt,
        inputTokens,
        0,
      );
    }
    if (this.activeRuns >= this.limits.maxConcurrency) {
      return this.result("busy", startedAt, inputTokens, 0);
    }

    this.activeRuns += 1;
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Specialist timed out")),
      this.limits.timeoutMs,
    );
    try {
      const turn = await this.provider.createTurn(
        [
          {
            role: "user",
            text:
              "You are a read-only code-analysis specialist. Analyze only the " +
              "following supplied text. Do not claim to inspect files, run tools, " +
              "or make changes. Return concise evidence, uncertainty, and one " +
              `recommendation.\n\nRequest:\n${request}`,
          },
        ],
        controller.signal,
        { memories: [] },
      );
      const finding = truncateToTokens(
        turn.displayText,
        this.limits.maxOutputTokens,
      );
      return this.result(
        "completed",
        startedAt,
        inputTokens,
        estimateTokens(finding),
        finding,
      );
    } catch {
      return this.result(
        controller.signal.aborted && !parentSignal.aborted
          ? "timed_out"
          : "failed",
        startedAt,
        inputTokens,
        0,
      );
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", onAbort);
      this.activeRuns -= 1;
    }
  }

  private result(
    status: SpecialistStatus,
    startedAt: number,
    inputTokens: number,
    outputTokens: number,
    finding?: string,
  ): SpecialistRun {
    return {
      status,
      ...(finding === undefined ? {} : { finding }),
      metrics: {
        depth: 1,
        agents: status === "completed" || status === "failed" || status === "timed_out" ? 1 : 0,
        toolCalls: 0,
        retries: 0,
        inputTokens,
        outputTokens,
        latencyMs: Math.max(0, performance.now() - startedAt),
        estimatedCostUsd: 0,
      },
    };
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  return text.slice(0, maxTokens * 4);
}
