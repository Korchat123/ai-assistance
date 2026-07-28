import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { createRealtimeClientSecret } from "./realtime.js";
import { attachSession } from "./session.js";
import { SessionStore } from "./session-store.js";

type AppOptions = {
  fetcher?: typeof fetch;
  realtime?: {
    apiKey?: string;
    model?: string;
    voice?: string;
    webOrigin?: string;
  };
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false });
  const sessions = new SessionStore();
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

  await app.register(websocket);

  app.get("/health", () => ({ status: "ok" }));
  app.post("/realtime/client-secret", async (request, reply) => {
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
    attachSession(socket, sessions);
  });
  app.addHook("onClose", () => {
    sessions.clear();
  });

  return app;
}
