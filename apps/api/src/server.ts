import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { attachSession } from "./session.js";

const app = Fastify({ logger: true });

await app.register(websocket);

app.get("/health", () => ({ status: "ok" }));

app.get("/ws", { websocket: true }, (socket) => {
  attachSession(socket);
});

const port = Number(process.env.PORT ?? 8000);
await app.listen({ host: "127.0.0.1", port });
