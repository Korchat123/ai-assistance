import { describe, expect, it } from "vitest";

import {
  AvatarCueEventSchema,
  ClientEventSchema,
  PROTOCOL_LIMITS,
  ServerEventSchema,
  UserTextEventSchema,
} from "./index.js";

const base = {
  protocolVersion: "1.0",
  eventId: "evt_1",
  sessionId: "ses_1",
  conversationId: "con_1",
  sequence: 0,
  timestamp: "2026-07-27T12:00:00.000Z",
} as const;

describe("protocol event schemas", () => {
  it("accepts a valid user text event", () => {
    const parsed = ClientEventSchema.parse({
      ...base,
      type: "user.text",
      turnId: "turn_1",
      payload: { text: "Hello" },
    });

    expect(parsed.type).toBe("user.text");
  });

  it("rejects an unsupported protocol version", () => {
    const result = UserTextEventSchema.safeParse({
      ...base,
      protocolVersion: "2.0",
      type: "user.text",
      payload: { text: "Hello" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = UserTextEventSchema.safeParse({
      ...base,
      type: "user.text",
      payload: { text: "Hello", injected: true },
    });

    expect(result.success).toBe(false);
  });

  it("rejects negative and fractional sequence numbers", () => {
    for (const invalidSequence of [-1, 1.5]) {
      const result = UserTextEventSchema.safeParse({
        ...base,
        sequence: invalidSequence,
        type: "user.text",
        payload: { text: "Hello" },
      });

      expect(result.success).toBe(false);
    }
  });

  it("enforces text boundaries", () => {
    const empty = UserTextEventSchema.safeParse({
      ...base,
      type: "user.text",
      payload: { text: "" },
    });
    const oversized = UserTextEventSchema.safeParse({
      ...base,
      type: "user.text",
      payload: { text: "x".repeat(PROTOCOL_LIMITS.textLength + 1) },
    });

    expect(empty.success).toBe(false);
    expect(oversized.success).toBe(false);
  });

  it("accepts avatar intensity boundaries", () => {
    for (const intensity of [0, 1]) {
      expect(
        AvatarCueEventSchema.safeParse({
          ...base,
          type: "avatar.cue",
          payload: { emotion: "happy", intensity },
        }).success,
      ).toBe(true);
    }
  });

  it("rejects avatar intensity outside its range", () => {
    for (const intensity of [-0.01, 1.01]) {
      expect(
        AvatarCueEventSchema.safeParse({
          ...base,
          type: "avatar.cue",
          payload: { emotion: "happy", intensity },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown event types", () => {
    expect(
      ServerEventSchema.safeParse({
        ...base,
        type: "assistant.secret",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("round-trips a valid server event", () => {
    const value = {
      ...base,
      type: "agent.state.changed",
      turnId: "turn_1",
      payload: { state: "thinking" },
    } as const;

    const parsed = ServerEventSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(parsed).toEqual(value);
  });
});
