import websocket from "@fastify/websocket";
import Fastify from "fastify";

import {
  createPersistence,
  type Persistence,
} from "./persistence.js";
import { createRealtimeClientSecret } from "./realtime.js";
import { attachSession } from "./session.js";
import { SessionStore } from "./session-store.js";

type AppOptions = {
  fetcher?: typeof fetch;
  persistence?: Persistence;
  databaseUrl?: string;
  limits?: Partial<{
    maxWsConnections: number;
    maxWsQueuedMessages: number;
    realtimeRequestsPerMinute: number;
    wsMaxPayloadBytes: number;
  }>;
  realtime?: {
    apiKey?: string;
    model?: string;
    voice?: string;
    webOrigin?: string;
  };
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const persistence =
    options.persistence ?? createPersistence(options.databaseUrl);
  const sessions = new SessionStore(persistence);
  const limits = {
    maxWsConnections: options.limits?.maxWsConnections ?? 100,
    maxWsQueuedMessages: options.limits?.maxWsQueuedMessages ?? 32,
    realtimeRequestsPerMinute:
      options.limits?.realtimeRequestsPerMinute ?? 10,
    wsMaxPayloadBytes: options.limits?.wsMaxPayloadBytes ?? 64 * 1_024,
  };
  let activeWsConnections = 0;
  const realtimeRateLimit = new FixedWindowRateLimit(
    limits.realtimeRequestsPerMinute,
    60_000,
  );
  const realtime = {
    apiKey: options.realtime?.apiKey ?? process.env.OPENAI_API_KEY,
    model:
      options.realtime?.model ??
      process.env.OPENAI_REALTIME_MODEL ??
      "gpt-realtime-2.1",
    voice:
      options.realtime?.voice ?? process.env.OPENAI_REALTIME_VOICE ?? "marin",
    webOrigin:
      options.realtime?.webOrigin ??
      process.env.WEB_ORIGIN ??
      "http://127.0.0.1:5173",
  };

  await app.register(websocket, {
    options: { maxPayload: limits.wsMaxPayloadBytes },
  });

  app.get("/health", () => ({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    activeWsConnections,
  }));
  app.post("/realtime/client-secret", async (request, reply) => {
    const rateKey = request.ip;
    const rate = realtimeRateLimit.consume(rateKey);
    void reply.header("RateLimit-Limit", limits.realtimeRequestsPerMinute);
    void reply.header("RateLimit-Remaining", rate.remaining);
    if (!rate.allowed) {
      void reply.header("Retry-After", rate.retryAfterSeconds);
      return reply.code(429).send({ error: "Rate limit exceeded." });
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== realtime.webOrigin) {
      return reply.code(403).send({ error: "Origin is not allowed." });
    }
    if (origin !== undefined) {
      void reply.header("Access-Control-Allow-Origin", realtime.webOrigin);
      void reply.header("Vary", "Origin");
    }
    if (realtime.apiKey === undefined || realtime.apiKey.trim() === "") {
      return reply
        .code(503)
        .send({ error: "OpenAI Realtime voice is not configured." });
    }

    try {
      const secret = await createRealtimeClientSecret(
        {
          apiKey: realtime.apiKey,
          model: realtime.model,
          voice: realtime.voice,
        },
        options.fetcher,
      );
      return secret;
    } catch {
      return reply
        .code(502)
        .send({ error: "Unable to create an OpenAI Realtime session." });
    }
  });
  app.get("/ws", { websocket: true }, (socket) => {
    if (activeWsConnections >= limits.maxWsConnections) {
      socket.close(1013, "Connection capacity reached");
      return;
    }
    activeWsConnections += 1;
    socket.once("close", () => {
      activeWsConnections -= 1;
    });
    attachSession(socket, sessions, limits.maxWsQueuedMessages);
  });
  app.addHook("onClose", async () => {
    await sessions.clear();
  });

  return app;
}

class FixedWindowRateLimit {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  public consume(key: string): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const now = Date.now();
    const current = this.windows.get(key);
    const window =
      current === undefined || now - current.startedAt >= this.windowMs
        ? { startedAt: now, count: 0 }
        : current;
    window.count += 1;
    this.windows.set(key, window);
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((window.startedAt + this.windowMs - now) / 1_000),
      ),
    };
  }
}
