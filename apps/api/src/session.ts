import { ClientEventSchema, type ClientEvent } from "@live2d-agent/protocol";
import type { RawData, WebSocket } from "ws";

import type { ConversationEvent } from "./conversation-manager.js";
import type { SessionState, SessionStore } from "./session-store.js";

const HEARTBEAT_CHECK_MS = 15_000;
const STALE_CONNECTION_MS = 45_000;
export const DEFAULT_MAX_QUEUED_MESSAGES = 32;

function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  return raw.toString("utf8");
}

function sendDirect(socket: WebSocket, event: object): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export function attachSession(
  socket: WebSocket,
  store: SessionStore,
  maxQueuedMessages = DEFAULT_MAX_QUEUED_MESSAGES,
): void {
  let session: SessionState | undefined;
  let lastSeenAt = Date.now();
  let messageQueue = Promise.resolve();
  let queuedMessages = 0;

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeenAt > STALE_CONNECTION_MS) {
      socket.close(1001, "Heartbeat timeout");
    }
  }, HEARTBEAT_CHECK_MS);
  heartbeat.unref();

  socket.on("message", (raw: RawData) => {
    if (queuedMessages >= maxQueuedMessages) {
      socket.close(1013, "Session queue is full");
      return;
    }
    queuedMessages += 1;
    messageQueue = messageQueue.then(async () => {
      lastSeenAt = Date.now();
      const input = parseJson(raw);
      const parsed = ClientEventSchema.safeParse(input);

      if (!parsed.success) {
        if (session !== undefined) {
          session.emit({
            type: "server.error",
            payload: {
              code: "invalid_event",
              message: "The client event did not match protocol version 1.0.",
              retryable: false,
            },
          });
        } else {
          sendDirect(socket, {
            type: "connection.error",
            code: "invalid_event",
            message: "The first frame must be a valid session event.",
          });
        }
        return;
      }

      const event = parsed.data;
      if (session === undefined) {
        session = await initializeSession(socket, store, event);
        return;
      }

      if (
        event.sessionId !== session.sessionId ||
        event.conversationId !== session.conversationId
      ) {
        socket.close(1008, "Session identity changed");
        return;
      }

      await handleEvent(session, event);
    }).finally(() => {
      queuedMessages -= 1;
    });
    void messageQueue.catch((error: unknown) => {
      console.error("Session message processing failed.", error);
      socket.close(1011, "Session processing failed");
    });
  });

  socket.on("close", () => {
    clearInterval(heartbeat);
    session?.sockets.delete(socket);
  });
}

function parseJson(raw: RawData): unknown {
  try {
    return JSON.parse(decodeRawData(raw)) as unknown;
  } catch {
    return undefined;
  }
}

async function initializeSession(
  socket: WebSocket,
  store: SessionStore,
  event: ClientEvent,
): Promise<SessionState | undefined> {
  if (event.type === "session.start") {
    const session = store.create(
      event.sessionId,
      event.conversationId,
      event.payload.clientId,
    );
    session.sockets.add(socket);
    session.emit({
      type: "session.ready",
      payload: { resumed: false },
    });
    return session;
  }

  if (event.type === "session.resume") {
    const session = await store.load(event.sessionId);
    if (
      session === undefined ||
      session.conversationId !== event.conversationId
    ) {
      socket.close(1008, "Replay unavailable");
      return undefined;
    }

    const replay = session.eventsAfter(
      event.payload.lastAcknowledgedSequence,
    );
    if (replay === undefined) {
      session.sockets.add(socket);
      session.emit({
        type: "server.error",
        payload: {
          code: "replay_unavailable",
          message: "The requested replay history is no longer available.",
          retryable: false,
        },
      });
      return session;
    }

    session.sockets.add(socket);
    for (const replayedEvent of replay) {
      sendDirect(socket, replayedEvent);
    }
    session.emit({
      type: "session.ready",
      payload: {
        resumed: true,
        replayedThroughSequence:
          replay.at(-1)?.sequence ?? event.payload.lastAcknowledgedSequence,
      },
    });
    return session;
  }

  socket.close(1008, "Session handshake required");
  return undefined;
}

async function handleEvent(
  session: SessionState,
  event: ClientEvent,
): Promise<void> {
  switch (event.type) {
    case "session.start":
    case "session.resume":
      return;

    case "client.ping":
      session.emit({
        type: "server.pong",
        payload: { nonce: event.payload.nonce },
      });
      return;

    case "client.ack":
      session.acknowledge(event.payload.acknowledgedSequence);
      return;

    case "task.cancel":
      if (session.activeTurn?.turnId === event.payload.targetTurnId) {
        session.activeTurn.controller.abort();
      }
      return;

    case "approval.resolve":
      resolveApproval(session, event);
      return;

    case "memory.resolve":
      await resolveMemory(session, event);
      return;

    case "user.text":
      await startTextTurn(session, event);
  }
}

async function startTextTurn(
  session: SessionState,
  event: Extract<ClientEvent, { type: "user.text" }>,
): Promise<void> {
  const turnId = event.turnId ?? crypto.randomUUID();
  const fingerprint = JSON.stringify({
    turnId,
    text: event.payload.text,
  });
  const existing = session.commands.get(event.payload.commandId);

  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint) {
      session.emit({
        type: "server.error",
        turnId,
        payload: {
          code: "command_conflict",
          message: "A command ID was reused with different input.",
          retryable: false,
        },
      });
    }
    return;
  }

  if (session.activeTurn !== undefined) {
    session.emit({
      type: "server.error",
      turnId,
      payload: {
        code: "turn_in_progress",
        message: "Only one active text turn is supported in Phase 2.",
        retryable: true,
      },
    });
    return;
  }

  session.commands.set(event.payload.commandId, { fingerprint, turnId });
  session.recordMessage(turnId, { role: "user", text: event.payload.text });
  const memoryCommand = parseMemoryCommand(event.payload.text);
  if (memoryCommand?.type === "remember") {
    emitLocalTurnStarted(session, turnId, event.payload.commandId);
    await proposeMemory(session, turnId, event.payload.commandId, memoryCommand.content);
    return;
  }
  if (memoryCommand?.type === "list") {
    emitLocalTurnStarted(session, turnId, event.payload.commandId);
    const memories = await session.listMemories();
    session.emit({
      type: "memory.list",
      turnId,
      payload: { items: memories.map(toProtocolMemory) },
    });
    emitLocalResponse(
      session,
      turnId,
      event.payload.commandId,
      memories.length === 0
        ? "You have no saved memories."
        : `You have ${memories.length} saved ${memories.length === 1 ? "memory" : "memories"}.`,
    );
    return;
  }
  if (memoryCommand?.type === "forget") {
    emitLocalTurnStarted(session, turnId, event.payload.commandId);
    const deleted = await session.deleteMemory(memoryCommand.memoryId);
    if (deleted) {
      session.emit({
        type: "memory.changed",
        turnId,
        payload: { action: "deleted", memoryId: memoryCommand.memoryId },
      });
    }
    emitLocalResponse(
      session,
      turnId,
      event.payload.commandId,
      deleted ? "The memory was deleted." : "That memory was not found.",
    );
    return;
  }

  const memories = await session.listMemories();
  void runTextTurn(
    session,
    turnId,
    event.payload.commandId,
    event.payload.text,
    memories.map((memory) => memory.content),
  );
}

async function runTextTurn(
  session: SessionState,
  turnId: string,
  commandId: string,
  userText: string,
  memories: readonly string[],
): Promise<void> {
  const controller = new AbortController();
  session.activeTurn = { turnId, commandId, controller };
  session.emit({
    type: "turn.started",
    turnId,
    payload: { commandId },
  });
  session.emit({
    type: "agent.state.changed",
    turnId,
    payload: { state: "thinking" },
  });

  try {
    const result = await session.conversation.startTurn(
      userText,
      controller.signal,
      (event) => emitConversationEvent(session, turnId, event),
      { memories },
    );
    if (result.status === "waiting_approval") {
      return;
    }
    completeTurn(session, turnId, controller.signal.aborted ? "cancelled" : "completed");
  } catch (error) {
    const cancelled = controller.signal.aborted;
    if (!cancelled) {
      session.emit({
        type: "server.error",
        turnId,
        payload: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "Agent turn failed.",
          retryable: true,
        },
      });
    }
    completeTurn(session, turnId, cancelled ? "cancelled" : "failed");
  } finally {
    if (
      session.activeTurn?.turnId === turnId &&
      !session.conversationHasPendingApproval
    ) {
      session.activeTurn = undefined;
    }
  }
}

async function proposeMemory(
  session: SessionState,
  turnId: string,
  commandId: string,
  content: string,
): Promise<void> {
  if (containsSecretLikeContent(content)) {
    emitLocalResponse(
      session,
      turnId,
      commandId,
      "That looks sensitive, so I will not save it as memory.",
    );
    return;
  }
  const candidateId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  await session.createMemoryCandidate({
    candidateId,
    clientId: session.clientId,
    conversationId: session.conversationId,
    turnId,
    content,
    confidence: 1,
    sensitivity: "personal",
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  session.emit({
    type: "memory.candidate",
    turnId,
    payload: {
      candidateId,
      content,
      confidence: 1,
      sensitivity: "personal",
      expiresAt,
      provenance: {
        conversationId: session.conversationId,
        turnId,
      },
    },
  });
  emitLocalResponse(
    session,
    turnId,
    commandId,
    "Please approve or deny this memory candidate.",
  );
}

async function resolveMemory(
  session: SessionState,
  event: Extract<ClientEvent, { type: "memory.resolve" }>,
): Promise<void> {
  const memory = await session.resolveMemoryCandidate(
    event.payload.candidateId,
    event.payload.decision,
  );
  session.emit({
    type: "memory.changed",
    payload: {
      action:
        event.payload.decision === "approved" && memory !== undefined
          ? "created"
          : "denied",
      candidateId: event.payload.candidateId,
      ...(memory === undefined ? {} : { memoryId: memory.memoryId }),
    },
  });
  session.emit({
    type: "memory.list",
    payload: {
      items: (await session.listMemories()).map(toProtocolMemory),
    },
  });
}

function emitLocalTurnStarted(
  session: SessionState,
  turnId: string,
  commandId: string,
): void {
  session.emit({ type: "turn.started", turnId, payload: { commandId } });
}

function emitLocalResponse(
  session: SessionState,
  turnId: string,
  commandId: string,
  text: string,
): void {
  session.recordMessage(turnId, { role: "assistant", text });
  session.emit({
    type: "assistant.text.completed",
    turnId,
    payload: { text },
  });
  completeTurn(session, turnId, "completed");
}

function parseMemoryCommand(
  text: string,
):
  | { type: "remember"; content: string }
  | { type: "list" }
  | { type: "forget"; memoryId: string }
  | undefined {
  const trimmed = text.trim();
  if (trimmed === "/memories") {
    return { type: "list" };
  }
  if (trimmed.startsWith("/remember ")) {
    const content = trimmed.slice("/remember ".length).trim();
    return content === "" ? undefined : { type: "remember", content };
  }
  if (trimmed.startsWith("/forget ")) {
    const memoryId = trimmed.slice("/forget ".length).trim();
    return memoryId === "" ? undefined : { type: "forget", memoryId };
  }
  return undefined;
}

function containsSecretLikeContent(content: string): boolean {
  return /\b(password|passcode|api[_ -]?key|access[_ -]?token|secret)\b/i.test(
    content,
  );
}

function toProtocolMemory(memory: Awaited<ReturnType<SessionState["listMemories"]>>[number]) {
  return {
    memoryId: memory.memoryId,
    content: memory.content,
    confidence: memory.confidence,
    sensitivity: memory.sensitivity,
    createdAt: memory.createdAt,
    ...(memory.expiresAt === undefined ? {} : { expiresAt: memory.expiresAt }),
  };
}

function resolveApproval(
  session: SessionState,
  event: Extract<ClientEvent, { type: "approval.resolve" }>,
): void {
  const active = session.activeTurn;
  if (active === undefined) {
    return;
  }
  session.resolveApprovalRecord(
    event.payload.approvalId,
    event.payload.decision,
  );
  void session.conversation
    .resolveApproval(event.payload.approvalId, event.payload.decision)
    .then((result) => {
      session.conversationHasPendingApproval = false;
      if (result === "not_found") {
        session.emit({
          type: "server.error",
          turnId: active.turnId,
          payload: {
            code: "not_found",
            message: "The approval request is no longer pending.",
            retryable: false,
          },
        });
      }
      completeTurn(
        session,
        active.turnId,
        result === "completed" ? "completed" : "cancelled",
      );
      session.activeTurn = undefined;
    })
    .catch((error: unknown) => {
      session.conversationHasPendingApproval = false;
      session.emit({
        type: "server.error",
        turnId: active.turnId,
        payload: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "Tool execution failed.",
          retryable: true,
        },
      });
      completeTurn(session, active.turnId, "failed");
      session.activeTurn = undefined;
    });
}

function emitConversationEvent(
  session: SessionState,
  turnId: string,
  event: ConversationEvent,
): void {
  switch (event.type) {
    case "text.delta":
      session.emit({
        type: "assistant.text.delta",
        turnId,
        payload: { delta: event.delta },
      });
      return;
    case "text.completed":
      session.recordMessage(turnId, {
        role: "assistant",
        text: event.turn.displayText,
      });
      session.emit({
        type: "assistant.text.completed",
        turnId,
        payload: { text: event.turn.displayText },
      });
      session.emit({
        type: "avatar.cue",
        turnId,
        payload: {
          ...event.turn.affect,
          ...(event.turn.gesture === undefined ? {} : { gesture: event.turn.gesture }),
        },
      });
      return;
    case "approval.required":
      session.conversationHasPendingApproval = true;
      session.recordToolCall({
        toolCallId: event.call.toolCallId,
        conversationId: session.conversationId,
        turnId,
        toolName: event.call.toolName,
        argumentsHash: event.call.argumentsHash,
        status: "awaiting_approval",
      });
      session.recordApproval({
        approvalId: event.approvalId,
        toolCallId: event.call.toolCallId,
        conversationId: session.conversationId,
        turnId,
        argumentsHash: event.call.argumentsHash,
        status: "pending",
      });
      session.emit({
        type: "approval.required",
        turnId,
        payload: {
          approvalId: event.approvalId,
          toolCallId: event.call.toolCallId,
          toolName: event.call.toolName,
          riskLevel: 1,
          summary: event.call.summary,
          argumentsHash: event.call.argumentsHash,
        },
      });
      return;
    case "tool.started":
      session.recordToolCall({
        toolCallId: event.call.toolCallId,
        conversationId: session.conversationId,
        turnId,
        toolName: event.call.toolName,
        argumentsHash: event.call.argumentsHash,
        status: "running",
      });
      session.emit({
        type: "agent.state.changed",
        turnId,
        payload: { state: "executing_tool" },
      });
      session.emit({
        type: "tool.started",
        turnId,
        payload: {
          toolCallId: event.call.toolCallId,
          toolName: event.call.toolName,
        },
      });
      return;
    case "tool.completed":
      session.recordToolCall({
        toolCallId: event.call.toolCallId,
        conversationId: session.conversationId,
        turnId,
        toolName: event.call.toolName,
        argumentsHash: event.call.argumentsHash,
        status: "succeeded",
        output: event.output,
      });
      session.emit({
        type: "tool.completed",
        turnId,
        payload: {
          toolCallId: event.call.toolCallId,
          toolName: event.call.toolName,
          output: event.output,
        },
      });
      return;
    case "tool.failed":
      session.recordToolCall({
        toolCallId: event.call.toolCallId,
        conversationId: session.conversationId,
        turnId,
        toolName: event.call.toolName,
        argumentsHash: event.call.argumentsHash,
        status: event.code,
        error: event.message,
      });
      session.emit({
        type: "tool.failed",
        turnId,
        payload: {
          toolCallId: event.call.toolCallId,
          toolName: event.call.toolName,
          code: event.code,
          message: event.message,
        },
      });
  }
}

function completeTurn(
  session: SessionState,
  turnId: string,
  reason: "completed" | "cancelled" | "failed",
): void {
  session.emit({ type: "turn.completed", turnId, payload: { reason } });
  session.emit({
    type: "agent.state.changed",
    turnId,
    payload: {
      state: reason === "completed" ? "idle" : reason === "cancelled" ? "interrupted" : "error",
    },
  });
}
