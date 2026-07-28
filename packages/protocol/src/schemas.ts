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
      commandId: id,
      text: boundedText,
    })
    .strict(),
);

export const TaskCancelEventSchema = event(
  "task.cancel",
  z
    .object({
      commandId: id,
      targetTurnId: id,
      reason: z.string().max(500).optional(),
    })
    .strict(),
);

export const ApprovalResolveEventSchema = event(
  "approval.resolve",
  z
    .object({
      commandId: id,
      approvalId: id,
      decision: z.enum(["approved", "denied"]),
    })
    .strict(),
);

export const MemoryResolveEventSchema = event(
  "memory.resolve",
  z
    .object({
      commandId: id,
      candidateId: id,
      decision: z.enum(["approved", "denied"]),
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
      replayedThroughSequence: sequence.optional(),
    })
    .strict(),
);

export const TurnStartedEventSchema = event(
  "turn.started",
  z
    .object({
      commandId: id,
    })
    .strict(),
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

const toolEventPayload = {
  toolCallId: id,
  toolName: id,
};

export const ToolStartedEventSchema = event(
  "tool.started",
  z.object(toolEventPayload).strict(),
);

export const ToolCompletedEventSchema = event(
  "tool.completed",
  z
    .object({
      ...toolEventPayload,
      output: z.string().max(PROTOCOL_LIMITS.toolOutputLength),
    })
    .strict(),
);

export const ToolFailedEventSchema = event(
  "tool.failed",
  z
    .object({
      ...toolEventPayload,
      code: z.enum(["cancelled", "timed_out", "invalid_input", "execution_error"]),
      message: z.string().min(1).max(PROTOCOL_LIMITS.errorMessageLength),
    })
    .strict(),
);

export const ApprovalRequiredEventSchema = event(
  "approval.required",
  z
    .object({
      approvalId: id,
      toolCallId: id,
      toolName: id,
      riskLevel: z.literal(1),
      summary: z.string().min(1).max(PROTOCOL_LIMITS.errorMessageLength),
      argumentsHash: id,
    })
    .strict(),
);

const memoryItem = z
  .object({
    memoryId: id,
    content: z.string().min(1).max(PROTOCOL_LIMITS.textLength),
    confidence: z.number().min(0).max(1),
    sensitivity: z.enum(["low", "personal", "sensitive"]),
    createdAt: timestamp,
    expiresAt: timestamp.optional(),
  })
  .strict();

export const MemoryCandidateEventSchema = event(
  "memory.candidate",
  z
    .object({
      candidateId: id,
      content: z.string().min(1).max(PROTOCOL_LIMITS.textLength),
      confidence: z.number().min(0).max(1),
      sensitivity: z.enum(["low", "personal", "sensitive"]),
      expiresAt: timestamp.optional(),
      provenance: z
        .object({
          conversationId: id,
          turnId: id,
        })
        .strict(),
    })
    .strict(),
);

export const MemoryListEventSchema = event(
  "memory.list",
  z.object({ items: z.array(memoryItem).max(100) }).strict(),
);

export const MemoryChangedEventSchema = event(
  "memory.changed",
  z
    .object({
      action: z.enum(["created", "deleted", "denied"]),
      memoryId: id.optional(),
      candidateId: id.optional(),
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
        "command_conflict",
        "turn_in_progress",
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
  ApprovalResolveEventSchema,
  MemoryResolveEventSchema,
  ClientAckEventSchema,
  ClientPingEventSchema,
]);

export const ServerEventSchema = z.discriminatedUnion("type", [
  SessionReadyEventSchema,
  TurnStartedEventSchema,
  AssistantTextDeltaEventSchema,
  AssistantTextCompletedEventSchema,
  AgentStateChangedEventSchema,
  ToolStartedEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  ApprovalRequiredEventSchema,
  MemoryCandidateEventSchema,
  MemoryListEventSchema,
  MemoryChangedEventSchema,
  AvatarCueEventSchema,
  TurnCompletedEventSchema,
  ServerErrorEventSchema,
  ServerPongEventSchema,
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type AvatarCueEvent = z.infer<typeof AvatarCueEventSchema>;
export type AgentState = (typeof agentStates)[number];
