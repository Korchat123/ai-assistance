import {
  PROTOCOL_VERSION,
  type ServerEvent,
} from "@live2d-agent/protocol";

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

export class ServerEventFactory {
  private sequence = 0;

  public constructor(
    private readonly sessionId: string,
    private readonly conversationId: string,
  ) {}

  public create(input: ServerEventInput): ServerEvent {
    const event = {
      ...input,
      protocolVersion: PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      sessionId: this.sessionId,
      conversationId: this.conversationId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
    } as ServerEvent;

    this.sequence += 1;
    return event;
  }
}
