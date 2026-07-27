import {
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  type ServerEvent,
} from "@live2d-agent/protocol";
import type { WebSocket } from "ws";

type ServerEventInput = ServerEvent extends infer TEvent
  ? TEvent extends ServerEvent
    ? Omit<
        TEvent,
        | "protocolVersion"
        | "eventId"
        | "sessionId"
        | "conversationId"
        | "sequence"
        | "timestamp"
      >
    : never
  : never;

export type CommandRecord = {
  fingerprint: string;
  turnId: string;
};

export class SessionState {
  public readonly sockets = new Set<WebSocket>();
  public readonly replay: ServerEvent[] = [];
  public readonly commands = new Map<string, CommandRecord>();
  public activeTurn:
    | { turnId: string; commandId: string; controller: AbortController }
    | undefined;
  public lastAcknowledgedSequence = -1;
  private nextSequence = 0;

  public constructor(
    public readonly sessionId: string,
    public readonly conversationId: string,
  ) {}

  public emit(input: ServerEventInput): ServerEvent {
    const event = {
      ...input,
      protocolVersion: PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      sessionId: this.sessionId,
      conversationId: this.conversationId,
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
    } as ServerEvent;

    this.nextSequence += 1;
    this.replay.push(event);
    if (this.replay.length > PROTOCOL_LIMITS.replayEvents) {
      this.replay.shift();
    }

    const encoded = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === socket.OPEN) {
        socket.send(encoded);
      }
    }
    return event;
  }

  public eventsAfter(sequence: number): ServerEvent[] | undefined {
    const oldest = this.replay[0]?.sequence ?? this.nextSequence;
    if (sequence < oldest - 1) {
      return undefined;
    }
    return this.replay.filter((event) => event.sequence > sequence);
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  public get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  public create(sessionId: string, conversationId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const session = new SessionState(sessionId, conversationId);
    this.sessions.set(sessionId, session);
    return session;
  }

  public clear(): void {
    for (const session of this.sessions.values()) {
      session.activeTurn?.controller.abort();
      for (const socket of session.sockets) {
        socket.close(1001, "Server shutting down");
      }
    }
    this.sessions.clear();
  }
}
