import { createHash } from "node:crypto";
import { z } from "zod";

export type ToolRiskLevel = 0 | 1;

export interface ToolAuditRecord {
  toolCallId: string;
  toolName: string;
  state:
    | "proposed"
    | "awaiting_approval"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "timed_out";
  arguments: unknown;
  output?: string;
  error?: string;
  timestamp: string;
}

export interface ToolDefinition<TInput> {
  name: string;
  riskLevel: ToolRiskLevel;
  input: z.ZodType<TInput>;
  timeoutMs: number;
  execute(input: TInput, signal: AbortSignal): Promise<string>;
}

export interface ProposedToolCall {
  toolCallId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  input: unknown;
  argumentsHash: string;
  summary: string;
}

const SECRET_PATTERN =
  /(api[_-]?key|authorization|token|password)\s*[:=]\s*([^\s,;]+)/gi;

export function redact(value: string): string {
  return value.replace(SECRET_PATTERN, "$1=[REDACTED]");
}

export class ToolRuntime {
  public readonly audit: ToolAuditRecord[] = [];
  private readonly values = new Map<string, string>([
    ["project", "Live2D Agentic Assistant"],
  ]);
  private readonly tools = new Map<string, ToolDefinition<unknown>>();

  public constructor() {
    this.register({
      name: "read_context",
      riskLevel: 0,
      input: z.object({ key: z.string().min(1).max(100) }).strict(),
      timeoutMs: 1_000,
      execute: ({ key }) =>
        Promise.resolve(this.values.get(key) ?? "not found"),
    });
    this.register({
      name: "set_context",
      riskLevel: 1,
      input: z
        .object({
          key: z.string().min(1).max(100),
          value: z.string().max(1_000),
        })
        .strict(),
      timeoutMs: 1_000,
      execute: ({ key, value }) => {
        this.values.set(key, value);
        return Promise.resolve(`Updated ${key}.`);
      },
    });
  }

  public propose(toolName: string, input: unknown): ProposedToolCall {
    const tool = this.tools.get(toolName);
    if (tool === undefined) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    const validated = tool.input.parse(input);
    const normalized = JSON.stringify(validated);
    const call = {
      toolCallId: crypto.randomUUID(),
      toolName,
      riskLevel: tool.riskLevel,
      input: validated,
      argumentsHash: createHash("sha256").update(normalized).digest("hex"),
      summary:
        tool.riskLevel === 0
          ? `Read scoped context with ${toolName}.`
          : `Allow ${toolName} to make a reversible local change?`,
    } satisfies ProposedToolCall;
    this.record(call, "proposed");
    return call;
  }

  public markAwaitingApproval(call: ProposedToolCall): void {
    this.record(call, "awaiting_approval");
  }

  public async execute(
    call: ProposedToolCall,
    parentSignal: AbortSignal,
  ): Promise<string> {
    const tool = this.tools.get(call.toolName);
    if (tool === undefined) {
      throw new Error(`Unknown tool: ${call.toolName}`);
    }
    const controller = new AbortController();
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    }
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("Tool timed out")),
      tool.timeoutMs,
    );
    this.record(call, "running");
    try {
      const output = redact(
        await tool.execute(tool.input.parse(call.input), controller.signal),
      ).slice(0, 8_000);
      if (controller.signal.aborted) {
        throw controller.signal.reason;
      }
      this.record(call, "succeeded", { output });
      return output;
    } catch (error) {
      const timedOut =
        controller.signal.aborted && !parentSignal.aborted;
      this.record(call, timedOut ? "timed_out" : parentSignal.aborted ? "cancelled" : "failed", {
        error: redact(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", onAbort);
    }
  }

  public register<TInput>(tool: ToolDefinition<TInput>): void {
    this.tools.set(tool.name, tool);
  }

  private record(
    call: ProposedToolCall,
    state: ToolAuditRecord["state"],
    extra: Pick<ToolAuditRecord, "output" | "error"> = {},
  ): void {
    this.audit.push({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      state,
      arguments: JSON.parse(redact(JSON.stringify(call.input))) as unknown,
      ...extra,
      timestamp: new Date().toISOString(),
    });
  }
}
