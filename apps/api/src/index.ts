import { ClientEventSchema, PROTOCOL_VERSION } from "@live2d-agent/protocol";

export const API_PROTOCOL_VERSION = PROTOCOL_VERSION;

export function parseClientEvent(input: unknown) {
  return ClientEventSchema.parse(input);
}
