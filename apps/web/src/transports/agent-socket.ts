import {
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  type ClientEvent,
  type ServerEvent,
} from "@live2d-agent/protocol";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

type ClientEventInput = ClientEvent extends infer TEvent
  ? TEvent extends ClientEvent
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

type PendingTextCommand = {
  commandId: string;
  turnId: string;
  text: string;
};

const HEARTBEAT_MS = 15_000;
const STALE_CONNECTION_MS = 45_000;
const CLIENT_ID_STORAGE_KEY = "live2d-agent.client-id";

function getStableClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing !== null && existing.length > 0) {
      return existing;
    }
    const created = crypto.randomUUID();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export class AgentSocket extends EventTarget {
  private socket: WebSocket | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private staleTimer: number | undefined;
  private nextSequence = 0;
  private lastServerSequence = -1;
  private lastInboundAt = 0;
  private ready = false;
  private intentionallyClosed = false;
  private readonly pendingText = new Map<string, PendingTextCommand>();
  private readonly clientId = getStableClientId();
  private readonly sessionId = crypto.randomUUID();
  private readonly conversationId = crypto.randomUUID();

  public constructor(private readonly url: string) {
    super();
  }

  public connect(): void {
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.intentionallyClosed = false;
    this.ready = false;
    this.setState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.lastInboundAt = Date.now();
      this.startHeartbeat();
      this.sendFrame(
        this.lastServerSequence >= 0
          ? {
              type: "session.resume",
              payload: {
                lastAcknowledgedSequence: this.lastServerSequence,
              },
            }
          : {
              type: "session.start",
              payload: { clientId: this.clientId },
            },
      );
    });

    socket.addEventListener("message", (message) => {
      this.lastInboundAt = Date.now();
      this.consumeMessage(message.data);
    });

    socket.addEventListener("close", (event) => {
      this.stopHeartbeat();
      this.ready = false;
      this.socket = undefined;

      if (this.intentionallyClosed || event.code === 1000) {
        this.setState("disconnected");
        return;
      }
      if (event.code === 1008) {
        this.setState("error");
        this.dispatchProtocolError(event.reason || "Connection rejected.");
        return;
      }

      this.setState("reconnecting");
      this.scheduleReconnect();
    });
  }

  public sendText(text: string): string {
    const command: PendingTextCommand = {
      commandId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      text,
    };
    this.pendingText.set(command.commandId, command);
    this.flushPendingText();
    return command.turnId;
  }

  public cancelTurn(turnId: string): void {
    this.sendWhenReady({
      type: "task.cancel",
      payload: {
        commandId: crypto.randomUUID(),
        targetTurnId: turnId,
      },
    });
  }

  public resolveApproval(
    approvalId: string,
    decision: "approved" | "denied",
  ): void {
    this.sendWhenReady({
      type: "approval.resolve",
      payload: {
        commandId: crypto.randomUUID(),
        approvalId,
        decision,
      },
    });
  }

  public resolveMemory(
    candidateId: string,
    decision: "approved" | "denied",
  ): void {
    this.sendWhenReady({
      type: "memory.resolve",
      payload: {
        commandId: crypto.randomUUID(),
        candidateId,
        decision,
      },
    });
  }

  public disconnect(): void {
    this.intentionallyClosed = true;
    this.ready = false;
    this.stopHeartbeat();
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempt = 0;
    this.socket?.close(1000, "Client closed");
    this.socket = undefined;
    this.setState("disconnected");
  }

  private consumeMessage(data: unknown): void {
    let input: unknown;
    try {
      input = JSON.parse(String(data)) as unknown;
    } catch {
      this.dispatchProtocolError("Server returned malformed JSON.");
      return;
    }

    const result = ServerEventSchema.safeParse(input);
    if (!result.success) {
      this.dispatchProtocolError("Server returned an invalid protocol event.");
      return;
    }

    const event = result.data;
    if (event.sequence <= this.lastServerSequence) {
      this.sendAck();
      return;
    }
    if (
      this.lastServerSequence >= 0 &&
      event.sequence > this.lastServerSequence + 1
    ) {
      this.socket?.close(1012, "Sequence gap");
      return;
    }

    this.lastServerSequence = event.sequence;
    if (event.type === "turn.started") {
      this.pendingText.delete(event.payload.commandId);
    }
    if (event.type === "session.ready") {
      this.ready = true;
      this.reconnectAttempt = 0;
      this.setState("connected");
      this.flushPendingText();
    }
    if (
      event.type === "server.error" &&
      event.payload.code === "replay_unavailable"
    ) {
      this.ready = false;
      this.setState("error");
    }

    this.dispatchEvent(
      new CustomEvent<ServerEvent>("server-event", { detail: event }),
    );
    this.sendAck();
  }

  private flushPendingText(): void {
    if (!this.ready) {
      return;
    }
    for (const command of this.pendingText.values()) {
      this.sendFrame({
        type: "user.text",
        turnId: command.turnId,
        payload: {
          commandId: command.commandId,
          text: command.text,
        },
      });
    }
  }

  private sendAck(): void {
    if (this.lastServerSequence < 0) {
      return;
    }
    this.sendFrame({
      type: "client.ack",
      payload: { acknowledgedSequence: this.lastServerSequence },
    });
  }

  private sendWhenReady(event: ClientEventInput): void {
    if (this.ready) {
      this.sendFrame(event);
    }
  }

  private sendFrame(input: ClientEventInput): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const event = ClientEventSchema.parse({
      ...input,
      protocolVersion: PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      sessionId: this.sessionId,
      conversationId: this.conversationId,
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
    });
    this.nextSequence += 1;
    this.socket.send(JSON.stringify(event));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.sendFrame({
        type: "client.ping",
        payload: { nonce: crypto.randomUUID() },
      });
    }, HEARTBEAT_MS);
    this.staleTimer = window.setInterval(() => {
      if (Date.now() - this.lastInboundAt > STALE_CONNECTION_MS) {
        this.socket?.close(1012, "Server heartbeat timeout");
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.staleTimer !== undefined) {
      window.clearInterval(this.staleTimer);
      this.staleTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    const baseDelay = Math.min(250 * 2 ** this.reconnectAttempt, 10_000);
    const jitter = Math.floor(Math.random() * Math.max(1, baseDelay / 4));
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, baseDelay + jitter);
  }

  private setState(state: ConnectionState): void {
    this.dispatchEvent(
      new CustomEvent<ConnectionState>("state", { detail: state }),
    );
  }

  private dispatchProtocolError(message: string): void {
    this.dispatchEvent(
      new CustomEvent<string>("protocol-error", { detail: message }),
    );
  }
}
