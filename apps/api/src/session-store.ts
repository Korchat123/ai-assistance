import {
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  type ServerEvent,
} from "@live2d-agent/protocol";
import type { WebSocket } from "ws";

import { ConversationManager } from "./conversation-manager.js";
import {
  MemoryPersistence,
  type HydratedSession,
  type PersistedApproval,
  type PersistedToolCall,
  type Persistence,
} from "./persistence.js";
import { createConfiguredProvider } from "./providers.js";
import type { ConversationMessage } from "./agent-types.js";

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
  public conversationHasPendingApproval = false;
  public lastAcknowledgedSequence = -1;
  public readonly conversation: ConversationManager;
  private nextSequence = 0;
  private persistenceQueue: Promise<void> = Promise.resolve();

  public constructor(
    public readonly sessionId: string,
    public readonly conversationId: string,
    public readonly persistence: Persistence = new MemoryPersistence(),
    hydrated?: HydratedSession,
  ) {
    this.conversation = new ConversationManager(
      createConfiguredProvider(),
      undefined,
      hydrated?.messages,
    );
    if (hydrated === undefined) {
      this.enqueuePersistence(() =>
        this.persistence.createSession(sessionId, conversationId),
      );
    } else {
      this.replay.push(...hydrated.events);
      this.lastAcknowledgedSequence = hydrated.lastAcknowledgedSequence;
      this.nextSequence =
        (hydrated.events.at(-1)?.sequence ?? -1) + 1;
    }
  }

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
    this.enqueuePersistence(() => this.persistence.appendEvent(event));
    return event;
  }

  public acknowledge(sequence: number): void {
    this.lastAcknowledgedSequence = Math.max(
      this.lastAcknowledgedSequence,
      sequence,
    );
    this.enqueuePersistence(() =>
      this.persistence.acknowledge(
        this.sessionId,
        this.lastAcknowledgedSequence,
      ),
    );
  }

  public flushPersistence(): Promise<void> {
    return this.persistenceQueue;
  }

  public recordToolCall(call: PersistedToolCall): void {
    this.enqueuePersistence(() => this.persistence.recordToolCall(call));
  }

  public recordMessage(
    turnId: string,
    message: ConversationMessage,
  ): void {
    this.enqueuePersistence(() =>
      this.persistence.recordMessage(this.conversationId, turnId, message),
    );
  }

  public recordApproval(approval: PersistedApproval): void {
    this.enqueuePersistence(() => this.persistence.recordApproval(approval));
  }

  public resolveApprovalRecord(
    approvalId: string,
    status: "approved" | "denied",
  ): void {
    this.enqueuePersistence(() =>
      this.persistence.resolveApproval(approvalId, status),
    );
  }

  public eventsAfter(sequence: number): ServerEvent[] | undefined {
    const oldest = this.replay[0]?.sequence ?? this.nextSequence;
    if (sequence < oldest - 1) {
      return undefined;
    }
    return this.replay.filter((event) => event.sequence > sequence);
  }

  private enqueuePersistence(operation: () => Promise<void>): void {
    this.persistenceQueue = this.persistenceQueue
      .catch(() => undefined)
      .then(operation);
    void this.persistenceQueue.catch((error: unknown) => {
      console.error("Persistence operation failed.", error);
    });
  }
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();

  public constructor(
    public readonly persistence: Persistence = new MemoryPersistence(),
  ) {}

  public get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  public create(sessionId: string, conversationId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }

    const session = new SessionState(
      sessionId,
      conversationId,
      this.persistence,
    );
    this.sessions.set(sessionId, session);
    return session;
  }

  public async load(sessionId: string): Promise<SessionState | undefined> {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const hydrated = await this.persistence.loadSession(sessionId);
    if (hydrated === undefined) {
      return undefined;
    }
    const session = new SessionState(
      hydrated.sessionId,
      hydrated.conversationId,
      this.persistence,
      hydrated,
    );
    this.sessions.set(sessionId, session);
    return session;
  }

  public async clear(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.activeTurn?.controller.abort();
      for (const socket of session.sockets) {
        socket.close(1001, "Server shutting down");
      }
      await session.flushPersistence();
    }
    this.sessions.clear();
    await this.persistence.close();
  }
}
