import { describe, expect, it } from "vitest";

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
});
