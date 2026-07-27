import {
  ClientEventSchema,
  type ServerEvent,
} from "@live2d-agent/protocol";
import type { RawData, WebSocket } from "ws";

import { ServerEventFactory } from "./event-factory.js";
import { streamFakeReply } from "./fake-agent.js";

function send(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event));
}

function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }

  return raw.toString("utf8");
}

export function attachSession(socket: WebSocket): void {
  const sessionId = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const events = new ServerEventFactory(sessionId, conversationId);
  const activeTurns = new Map<string, AbortController>();

  socket.on("message", (raw: RawData) => {
    let input: unknown;
    try {
      input = JSON.parse(decodeRawData(raw)) as unknown;
    } catch {
      send(
        socket,
        events.create({
          type: "server.error",
          payload: {
            code: "invalid_event",
            message: "The client event was not valid JSON.",
            retryable: false,
          },
        }),
      );
      return;
    }

    const parsed = ClientEventSchema.safeParse(input);

    if (!parsed.success) {
      send(
        socket,
        events.create({
          type: "server.error",
          payload: {
            code: "invalid_event",
            message: "The client event did not match protocol version 1.0.",
            retryable: false,
          },
        }),
      );
      return;
    }

    const event = parsed.data;

    switch (event.type) {
      case "session.start":
      case "session.resume":
        send(
          socket,
          events.create({
            type: "session.ready",
            payload: { resumed: event.type === "session.resume" },
          }),
        );
        return;

      case "client.ping":
        send(
          socket,
          events.create({
            type: "server.pong",
            payload: { nonce: event.payload.nonce },
          }),
        );
        return;

      case "client.ack":
        return;

      case "task.cancel": {
        activeTurns.get(event.payload.targetTurnId)?.abort();
        return;
      }

      case "user.text":
        void runTextTurn(
          socket,
          events,
          activeTurns,
          event.turnId ?? crypto.randomUUID(),
          event.payload.text,
        );
    }
  });

  socket.on("close", () => {
    for (const controller of activeTurns.values()) {
      controller.abort();
    }
    activeTurns.clear();
  });
}

async function runTextTurn(
  socket: WebSocket,
  events: ServerEventFactory,
  activeTurns: Map<string, AbortController>,
  turnId: string,
  userText: string,
): Promise<void> {
  const controller = new AbortController();
  activeTurns.set(turnId, controller);
  let completedText = "";

  send(socket, events.create({ type: "turn.started", turnId, payload: {} }));
  send(
    socket,
    events.create({
      type: "agent.state.changed",
      turnId,
      payload: { state: "thinking" },
    }),
  );

  try {
    for await (const chunk of streamFakeReply(userText, controller.signal)) {
      completedText += chunk.delta;
      send(
        socket,
        events.create({
          type: "assistant.text.delta",
          turnId,
          payload: chunk,
        }),
      );
    }

    const cancelled = controller.signal.aborted;
    if (!cancelled) {
      send(
        socket,
        events.create({
          type: "assistant.text.completed",
          turnId,
          payload: { text: completedText.trim() },
        }),
      );
    }

    send(
      socket,
      events.create({
        type: "turn.completed",
        turnId,
        payload: { reason: cancelled ? "cancelled" : "completed" },
      }),
    );
  } finally {
    activeTurns.delete(turnId);
  }
}
