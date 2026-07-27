import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { attachSession } from "./session.js";
import { SessionStore } from "./session-store.js";

export async function buildApp() {
  const app = Fastify({ logger: false });
  const sessions = new SessionStore();

  await app.register(websocket);

  app.get("/health", () => ({ status: "ok" }));
  app.get("/ws", { websocket: true }, (socket) => {
    attachSession(socket, sessions);
  });
  app.addHook("onClose", () => {
    sessions.clear();
  });

  return app;
}
