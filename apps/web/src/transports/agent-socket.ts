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
  | "reconnecting";

export class AgentSocket extends EventTarget {
  private socket: WebSocket | undefined;
  private reconnectAttempt = 0;
  private reconnectTimer?: number;
  private nextSequence = 0;
  private lastServerSequence = -1;
  private readonly clientId = crypto.randomUUID();
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

    this.setState(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.setState("connected");
      this.send(
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
      let input: unknown;
      try {
        input = JSON.parse(String(message.data)) as unknown;
      } catch {
        this.dispatchEvent(
          new CustomEvent("protocol-error", {
            detail: "Server returned malformed JSON.",
          }),
        );
        return;
      }

      const result = ServerEventSchema.safeParse(input);
      if (!result.success) {
        this.dispatchEvent(
          new CustomEvent("protocol-error", {
            detail: "Server returned an invalid protocol event.",
          }),
        );
        return;
      }

      this.lastServerSequence = Math.max(
        this.lastServerSequence,
        result.data.sequence,
      );
      this.dispatchEvent(
        new CustomEvent<ServerEvent>("server-event", { detail: result.data }),
      );
      this.send({
        type: "client.ack",
        payload: { acknowledgedSequence: this.lastServerSequence },
      });
    });

    socket.addEventListener("close", () => {
      this.setState("reconnecting");
      this.scheduleReconnect();
    });
  }

  public sendText(text: string): string {
    const turnId = crypto.randomUUID();
    this.send({ type: "user.text", turnId, payload: { text } });
    return turnId;
  }

  public disconnect(): void {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.reconnectAttempt = 0;
    this.socket?.close();
    this.socket = undefined;
    this.setState("disconnected");
  }

  private send(
    input: Omit<
      ClientEvent,
      | "protocolVersion"
      | "eventId"
      | "sessionId"
      | "conversationId"
      | "sequence"
      | "timestamp"
    >,
  ): void {
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

  private scheduleReconnect(): void {
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt, 15_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private setState(state: ConnectionState): void {
    this.dispatchEvent(new CustomEvent<ConnectionState>("state", { detail: state }));
  }
}
