import {
  PROTOCOL_VERSION,
  ServerEventSchema,
  type ServerEvent,
} from "@live2d-agent/protocol";

export const WEB_PROTOCOL_VERSION = PROTOCOL_VERSION;

export function parseServerEvent(input: unknown): ServerEvent {
  return ServerEventSchema.parse(input);
}

export * from "./transports/agent-socket.js";
