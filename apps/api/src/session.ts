import { ClientEventSchema, type ClientEvent } from "@live2d-agent/protocol";
import type { RawData, WebSocket } from "ws";

import { streamFakeReply } from "./fake-agent.js";
import type { SessionState, SessionStore } from "./session-store.js";

const HEARTBEAT_CHECK_MS = 15_000;
const STALE_CONNECTION_MS = 45_000;

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

export function attachSession(socket: WebSocket, store: SessionStore): void {
  let session: SessionState | undefined;
  let lastSeenAt = Date.now();

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeenAt > STALE_CONNECTION_MS) {
      socket.close(1001, "Heartbeat timeout");
    }
  }, HEARTBEAT_CHECK_MS);
  heartbeat.unref();

  socket.on("message", (raw: RawData) => {
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
      session = initializeSession(socket, store, event);
      return;
    }

    if (
      event.sessionId !== session.sessionId ||
      event.conversationId !== session.conversationId
    ) {
      socket.close(1008, "Session identity changed");
      return;
    }

    handleEvent(session, event);
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

function initializeSession(
  socket: WebSocket,
  store: SessionStore,
  event: ClientEvent,
): SessionState | undefined {
  if (event.type === "session.start") {
    const session = store.create(event.sessionId, event.conversationId);
    session.sockets.add(socket);
    session.emit({
      type: "session.ready",
      payload: { resumed: false },
    });
    return session;
  }

  if (event.type === "session.resume") {
    const session = store.get(event.sessionId);
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

function handleEvent(session: SessionState, event: ClientEvent): void {
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
      session.lastAcknowledgedSequence = Math.max(
        session.lastAcknowledgedSequence,
        event.payload.acknowledgedSequence,
      );
      return;

    case "task.cancel":
      if (session.activeTurn?.turnId === event.payload.targetTurnId) {
        session.activeTurn.controller.abort();
      }
      return;

    case "user.text":
      startTextTurn(session, event);
  }
}

function startTextTurn(
  session: SessionState,
  event: Extract<ClientEvent, { type: "user.text" }>,
): void {
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
  void runTextTurn(session, turnId, event.payload.commandId, event.payload.text);
}

async function runTextTurn(
  session: SessionState,
  turnId: string,
  commandId: string,
  userText: string,
): Promise<void> {
  const controller = new AbortController();
  session.activeTurn = { turnId, commandId, controller };
  let completedText = "";

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
    for await (const chunk of streamFakeReply(userText, controller.signal)) {
      completedText += chunk.delta;
      session.emit({
        type: "assistant.text.delta",
        turnId,
        payload: chunk,
      });
    }

    const cancelled = controller.signal.aborted;
    if (!cancelled) {
      session.emit({
        type: "assistant.text.completed",
        turnId,
        payload: { text: completedText.trim() },
      });
    }
    session.emit({
      type: "turn.completed",
      turnId,
      payload: { reason: cancelled ? "cancelled" : "completed" },
    });
    session.emit({
      type: "agent.state.changed",
      turnId,
      payload: { state: cancelled ? "interrupted" : "idle" },
    });
  } finally {
    if (session.activeTurn?.turnId === turnId) {
      session.activeTurn = undefined;
    }
  }
}
