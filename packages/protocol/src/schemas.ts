import { z } from "zod";

import {
  agentStates,
  emotions,
  gestures,
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  turnCompletionReasons,
} from "./constants.js";

const id = z.string().trim().min(1).max(PROTOCOL_LIMITS.idLength);
const sequence = z.number().int().nonnegative();
const timestamp = z.string().datetime({ offset: true });
const boundedText = z.string().min(1).max(PROTOCOL_LIMITS.textLength);

const envelope = {
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: id,
  sessionId: id,
  conversationId: id,
  turnId: id.optional(),
  runId: id.optional(),
  sequence,
  timestamp,
};

const event = <TType extends string, TPayload extends z.ZodType>(
  type: TType,
  payload: TPayload,
) =>
  z
    .object({
      ...envelope,
      type: z.literal(type),
      payload,
    })
    .strict();

export const SessionStartEventSchema = event(
  "session.start",
  z
    .object({
      clientId: id,
    })
    .strict(),
);

export const SessionResumeEventSchema = event(
  "session.resume",
  z
    .object({
      lastAcknowledgedSequence: sequence,
    })
    .strict(),
);

export const UserTextEventSchema = event(
  "user.text",
  z
    .object({
      text: boundedText,
    })
    .strict(),
);

export const TaskCancelEventSchema = event(
  "task.cancel",
  z
    .object({
      targetTurnId: id,
      reason: z.string().max(500).optional(),
    })
    .strict(),
);

export const ClientAckEventSchema = event(
  "client.ack",
  z
    .object({
      acknowledgedSequence: sequence,
    })
    .strict(),
);

export const ClientPingEventSchema = event(
  "client.ping",
  z
    .object({
      nonce: id,
    })
    .strict(),
);

export const SessionReadyEventSchema = event(
  "session.ready",
  z
    .object({
      resumed: z.boolean(),
    })
    .strict(),
);

export const TurnStartedEventSchema = event(
  "turn.started",
  z.object({}).strict(),
);

export const AssistantTextDeltaEventSchema = event(
  "assistant.text.delta",
  z
    .object({
      delta: boundedText,
    })
    .strict(),
);

export const AssistantTextCompletedEventSchema = event(
  "assistant.text.completed",
  z
    .object({
      text: boundedText,
    })
    .strict(),
);

export const AgentStateChangedEventSchema = event(
  "agent.state.changed",
  z
    .object({
      state: z.enum(agentStates),
    })
    .strict(),
);

export const AvatarCueEventSchema = event(
  "avatar.cue",
  z
    .object({
      emotion: z.enum(emotions),
      intensity: z.number().min(0).max(1),
      gesture: z.enum(gestures).optional(),
      durationMs: z
        .number()
        .int()
        .positive()
        .max(PROTOCOL_LIMITS.durationMs)
        .optional(),
    })
    .strict(),
);

export const TurnCompletedEventSchema = event(
  "turn.completed",
  z
    .object({
      reason: z.enum(turnCompletionReasons),
    })
    .strict(),
);

export const ServerErrorEventSchema = event(
  "server.error",
  z
    .object({
      code: z.enum([
        "invalid_event",
        "unauthorized",
        "not_found",
        "rate_limited",
        "replay_unavailable",
        "internal_error",
      ]),
      message: z.string().min(1).max(PROTOCOL_LIMITS.errorMessageLength),
      retryable: z.boolean(),
    })
    .strict(),
);

export const ServerPongEventSchema = event(
  "server.pong",
  z
    .object({
      nonce: id,
    })
    .strict(),
);

export const ClientEventSchema = z.discriminatedUnion("type", [
  SessionStartEventSchema,
  SessionResumeEventSchema,
  UserTextEventSchema,
  TaskCancelEventSchema,
  ClientAckEventSchema,
  ClientPingEventSchema,
]);

export const ServerEventSchema = z.discriminatedUnion("type", [
  SessionReadyEventSchema,
  TurnStartedEventSchema,
  AssistantTextDeltaEventSchema,
  AssistantTextCompletedEventSchema,
  AgentStateChangedEventSchema,
  AvatarCueEventSchema,
  TurnCompletedEventSchema,
  ServerErrorEventSchema,
  ServerPongEventSchema,
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type AvatarCueEvent = z.infer<typeof AvatarCueEventSchema>;
export type AgentState = (typeof agentStates)[number];
