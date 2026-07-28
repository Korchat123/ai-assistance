import {
  ClientEventSchema,
  PROTOCOL_VERSION,
  ServerEventSchema,
  type ClientEvent,
  type ServerEvent,
} from "@live2d-agent/protocol";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { RawData } from "ws";

import { buildApp } from "./app.js";
import {
  MemoryPersistence,
  type Persistence,
} from "./persistence.js";

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

const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(async (app) => app.close()));
});

async function createSocket(options: { persistence?: Persistence } = {}) {
  const app = await buildApp(options);
  openApps.push(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { app, socket, port: address.port };
}

function sender(socket: WebSocket, sessionId: string, conversationId: string) {
  let sequence = 0;
  return (input: ClientEventInput) => {
    const event = ClientEventSchema.parse({
      ...input,
      protocolVersion: PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      sessionId,
      conversationId,
      sequence,
      timestamp: new Date().toISOString(),
    });
    sequence += 1;
    socket.send(JSON.stringify(event));
  };
}

function collectUntil(
  socket: WebSocket,
  predicate: (event: ServerEvent) => boolean,
): Promise<ServerEvent[]> {
  return new Promise((resolve, reject) => {
    const events: ServerEvent[] = [];
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for server events."));
    }, 5_000);

    socket.on("message", (raw: RawData) => {
      const event = ServerEventSchema.parse(
        JSON.parse(decodeRawData(raw)) as unknown,
      );
      events.push(event);
      if (predicate(event)) {
        clearTimeout(timeout);
        resolve(events);
      }
    });
  });
}

function decodeRawData(raw: RawData): string {
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString("utf8");
  }
  return raw.toString("utf8");
}

describe("text WebSocket vertical slice", () => {
  it("streams one ordered text turn", async () => {
    const { socket } = await createSocket();
    const send = sender(socket, "ses_stream", "con_stream");
    const eventsPromise = collectUntil(
      socket,
      (event) => event.type === "turn.completed",
    );

    send({ type: "session.start", payload: { clientId: "test" } });
    send({
      type: "user.text",
      turnId: "turn_1",
      payload: {
        commandId: "cmd_1",
        text: "hello phase two",
      },
    });

    const events = await eventsPromise;
    const types = events.map((event) => event.type);
    expect(types).toContain("session.ready");
    expect(types).toContain("turn.started");
    expect(types).toContain("assistant.text.delta");
    expect(types).toContain("assistant.text.completed");
    expect(types).toContain("turn.completed");
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index),
    );
    socket.close();
  });

  it("deduplicates a repeated command ID", async () => {
    const { socket } = await createSocket();
    const send = sender(socket, "ses_dedupe", "con_dedupe");
    const eventsPromise = collectUntil(
      socket,
      (event) => event.type === "turn.completed",
    );
    const command = {
      type: "user.text",
      turnId: "turn_1",
      payload: { commandId: "cmd_same", text: "once" },
    } as const;

    send({ type: "session.start", payload: { clientId: "test" } });
    send(command);
    send(command);

    const events = await eventsPromise;
    expect(
      events.filter((event) => event.type === "turn.started"),
    ).toHaveLength(1);
    socket.close();
  });

  it("replays missed events after reconnect", async () => {
    const { app, socket, port } = await createSocket();
    const send = sender(socket, "ses_resume", "con_resume");
    const firstEventsPromise = collectUntil(
      socket,
      (event) => event.type === "assistant.text.delta",
    );

    send({ type: "session.start", payload: { clientId: "test" } });
    send({
      type: "user.text",
      turnId: "turn_resume",
      payload: { commandId: "cmd_resume", text: "reconnect test" },
    });
    const firstEvents = await firstEventsPromise;
    const lastSeen = firstEvents.at(-1)?.sequence ?? 0;
    socket.close();

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });
    const resumed = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      resumed.once("open", resolve);
      resumed.once("error", reject);
    });
    const resumeSend = sender(resumed, "ses_resume", "con_resume");
    const replayPromise = collectUntil(
      resumed,
      (event) => event.type === "session.ready" && event.payload.resumed,
    );
    resumeSend({
      type: "session.resume",
      payload: { lastAcknowledgedSequence: lastSeen },
    });

    const replay = await replayPromise;
    expect(replay.at(-1)?.type).toBe("session.ready");
    expect(replay.every((event) => event.sequence > lastSeen)).toBe(true);
    resumed.close();
    await app.close();
    openApps.splice(openApps.indexOf(app), 1);
  });

  it("pauses a Level 1 tool until the browser approves it", async () => {
    const { socket } = await createSocket();
    const send = sender(socket, "ses_approval", "con_approval");
    const approvalPromise = collectUntil(
      socket,
      (event) => event.type === "approval.required",
    );

    send({ type: "session.start", payload: { clientId: "test" } });
    send({
      type: "user.text",
      turnId: "turn_approval",
      payload: {
        commandId: "cmd_set",
        text: "/set theme blue",
      },
    });

    const approvalEvents = await approvalPromise;
    const approval = approvalEvents.find(
      (event) => event.type === "approval.required",
    );
    expect(approval?.type).toBe("approval.required");
    expect(
      approvalEvents.some((event) => event.type === "tool.started"),
    ).toBe(false);

    const completionPromise = collectUntil(
      socket,
      (event) => event.type === "turn.completed",
    );
    if (approval?.type !== "approval.required") {
      throw new Error("Approval event was not received.");
    }
    send({
      type: "approval.resolve",
      payload: {
        commandId: "cmd_approve",
        approvalId: approval.payload.approvalId,
        decision: "approved",
      },
    });

    const completionEvents = await completionPromise;
    expect(
      completionEvents.some((event) => event.type === "tool.started"),
    ).toBe(true);
    expect(
      completionEvents.some((event) => event.type === "tool.completed"),
    ).toBe(true);
    socket.close();
  });
});

describe("Realtime HTTP boundary", () => {
  it("does not mint a client secret when Realtime is unconfigured", async () => {
    const app = await buildApp({ realtime: { apiKey: "" } });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/realtime/client-secret",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "OpenAI Realtime voice is not configured.",
    });
  });

  it("returns only the ephemeral value and expiry to an allowed browser", async () => {
    const fetcher = () =>
      Promise.resolve(new Response(
        JSON.stringify({
          value: "ek_browser",
          expires_at: 1_800_000_000,
          session: { id: "session_internal" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    const app = await buildApp({
      fetcher,
      realtime: {
        apiKey: "server-key",
        webOrigin: "http://web.test",
      },
    });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/realtime/client-secret",
      headers: { origin: "http://web.test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://web.test",
    );
    expect(response.json()).toEqual({
      value: "ek_browser",
      expiresAt: 1_800_000_000,
    });
    expect(response.body).not.toContain("server-key");
    expect(response.body).not.toContain("session_internal");
  });

  it("rejects an unexpected browser origin", async () => {
    const app = await buildApp({
      realtime: {
        apiKey: "server-key",
        webOrigin: "http://web.test",
      },
    });
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/realtime/client-secret",
      headers: { origin: "http://attacker.test" },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("durable audit projection", () => {
  it("persists tool and approval lifecycle records", async () => {
    const persistence = new MemoryPersistence();
    const { socket } = await createSocket({ persistence });
    const send = sender(socket, "ses_persist", "con_persist");
    const approvalPromise = collectUntil(
      socket,
      (event) => event.type === "approval.required",
    );
    send({ type: "session.start", payload: { clientId: "test" } });
    send({
      type: "user.text",
      turnId: "turn_persist",
      payload: {
        commandId: "cmd_persist",
        text: "/set theme violet",
      },
    });
    const events = await approvalPromise;
    const approval = events.find(
      (event) => event.type === "approval.required",
    );
    if (approval?.type !== "approval.required") {
      throw new Error("Expected an approval request.");
    }

    const completionPromise = collectUntil(
      socket,
      (event) => event.type === "turn.completed",
    );
    send({
      type: "approval.resolve",
      payload: {
        commandId: "cmd_resolution",
        approvalId: approval.payload.approvalId,
        decision: "approved",
      },
    });
    await completionPromise;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(
      persistence.toolCalls.get(approval.payload.toolCallId)?.status,
    ).toBe("succeeded");
    expect(
      persistence.approvals.get(approval.payload.approvalId)?.status,
    ).toBe("approved");
    socket.close();
  });
});
