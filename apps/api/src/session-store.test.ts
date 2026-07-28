import { describe, expect, it } from "vitest";

import { MemoryPersistence } from "./persistence.js";
import { SessionState, SessionStore } from "./session-store.js";

describe("SessionState", () => {
  it("assigns increasing sequence numbers and replays after an ack", () => {
    const session = new SessionState("ses_1", "con_1");
    const first = session.emit({
      type: "session.ready",
      payload: { resumed: false },
    });
    const second = session.emit({
      type: "server.pong",
      payload: { nonce: "nonce_1" },
    });

    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(session.eventsAfter(0)).toEqual([second]);
  });

  it("returns the existing session for a duplicate start", () => {
    const store = new SessionStore();
    const created = store.create("ses_1", "con_1");
    const duplicate = store.create("ses_1", "con_1");

    expect(duplicate).toBe(created);
  });

  it("hydrates replay and acknowledgement state after a store restart", async () => {
    const persistence = new MemoryPersistence();
    const firstStore = new SessionStore(persistence);
    const first = firstStore.create("ses_durable", "con_durable");
    first.emit({
      type: "session.ready",
      payload: { resumed: false },
    });
    const pong = first.emit({
      type: "server.pong",
      payload: { nonce: "durable_nonce" },
    });
    first.acknowledge(0);
    first.recordMessage("turn_1", { role: "user", text: "Remember this." });
    first.recordMessage("turn_1", { role: "assistant", text: "Remembered." });
    await first.flushPersistence();

    const secondStore = new SessionStore(persistence);
    const restored = await secondStore.load("ses_durable");

    expect(restored?.lastAcknowledgedSequence).toBe(0);
    expect(restored?.eventsAfter(0)).toEqual([pong]);
    await expect(persistence.loadSession("ses_durable")).resolves.toMatchObject({
      messages: [
        { role: "user", text: "Remember this." },
        { role: "assistant", text: "Remembered." },
      ],
    });
    const next = restored?.emit({
      type: "server.pong",
      payload: { nonce: "next_nonce" },
    });
    expect(next?.sequence).toBe(2);
  });
});
