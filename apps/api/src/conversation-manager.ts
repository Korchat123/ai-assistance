import type { AssistantTurn, AgentProvider, ConversationMessage } from "./agent-types.js";
import {
  ToolRuntime,
  type ProposedToolCall,
} from "./tool-runtime.js";

export type ConversationEvent =
  | { type: "text.delta"; delta: string }
  | { type: "text.completed"; turn: AssistantTurn }
  | { type: "tool.started"; call: ProposedToolCall }
  | { type: "tool.completed"; call: ProposedToolCall; output: string }
  | {
      type: "tool.failed";
      call: ProposedToolCall;
      code: "cancelled" | "timed_out" | "execution_error";
      message: string;
    }
  | {
      type: "approval.required";
      approvalId: string;
      call: ProposedToolCall;
    };

export interface TurnHandle {
  status: "completed" | "waiting_approval";
  approvalId?: string;
}

interface PendingApproval {
  approvalId: string;
  call: ProposedToolCall;
  signal: AbortSignal;
  emit: (event: ConversationEvent) => void;
}

export class ConversationManager {
  private readonly history: ConversationMessage[] = [];
  private readonly pending = new Map<string, PendingApproval>();

  public constructor(
    private readonly provider: AgentProvider,
    public readonly tools = new ToolRuntime(),
    initialHistory: readonly ConversationMessage[] = [],
  ) {
    this.history.push(...initialHistory);
  }

  public async startTurn(
    userText: string,
    signal: AbortSignal,
    emit: (event: ConversationEvent) => void,
  ): Promise<TurnHandle> {
    this.history.push({ role: "user", text: userText });
    const invocation = parseExampleTool(userText);
    if (invocation !== undefined) {
      const call = this.tools.propose(invocation.name, invocation.input);
      if (call.riskLevel === 1) {
        const approvalId = crypto.randomUUID();
        this.tools.markAwaitingApproval(call);
        this.pending.set(approvalId, { approvalId, call, signal, emit });
        emit({ type: "approval.required", approvalId, call });
        return { status: "waiting_approval", approvalId };
      }
      await this.executeTool(call, signal, emit);
    }

    await this.completeAssistantTurn(signal, emit);
    return { status: "completed" };
  }

  public async resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<"completed" | "denied" | "not_found"> {
    const pending = this.pending.get(approvalId);
    if (pending === undefined) {
      return "not_found";
    }
    this.pending.delete(approvalId);
    if (decision === "denied") {
      return "denied";
    }
    await this.executeTool(pending.call, pending.signal, pending.emit);
    await this.completeAssistantTurn(pending.signal, pending.emit);
    return "completed";
  }

  private async executeTool(
    call: ProposedToolCall,
    signal: AbortSignal,
    emit: (event: ConversationEvent) => void,
  ): Promise<void> {
    emit({ type: "tool.started", call });
    try {
      const output = await this.tools.execute(call, signal);
      this.history.push({ role: "assistant", text: `Tool result: ${output}` });
      emit({ type: "tool.completed", call, output });
    } catch (error) {
      const code = signal.aborted
        ? "cancelled"
        : error instanceof Error && error.message === "Tool timed out"
          ? "timed_out"
          : "execution_error";
      emit({
        type: "tool.failed",
        call,
        code,
        message: error instanceof Error ? error.message : "Tool execution failed.",
      });
      throw error;
    }
  }

  private async completeAssistantTurn(
    signal: AbortSignal,
    emit: (event: ConversationEvent) => void,
  ): Promise<void> {
    const turn = await this.provider.createTurn(this.history, signal);
    for (const delta of turn.displayText.match(/\S+\s*/g) ?? [turn.displayText]) {
      signal.throwIfAborted();
      emit({ type: "text.delta", delta });
    }
    this.history.push({ role: "assistant", text: turn.displayText });
    emit({ type: "text.completed", turn });
  }
}

function parseExampleTool(
  text: string,
): { name: string; input: unknown } | undefined {
  const [command, key, ...rest] = text.trim().split(/\s+/);
  if (command === "/read" && key !== undefined) {
    return { name: "read_context", input: { key } };
  }
  if (command === "/set" && key !== undefined && rest.length > 0) {
    return { name: "set_context", input: { key, value: rest.join(" ") } };
  }
  return undefined;
}
