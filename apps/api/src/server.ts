import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const app = await buildApp({
  limits: {
    maxWsConnections: Number(process.env.MAX_WS_CONNECTIONS ?? 100),
    maxWsQueuedMessages: Number(process.env.MAX_WS_QUEUED_MESSAGES ?? 32),
    realtimeRequestsPerMinute: Number(
      process.env.REALTIME_REQUESTS_PER_MINUTE ?? 10,
    ),
    wsMaxPayloadBytes: Number(process.env.WS_MAX_PAYLOAD_BYTES ?? 65_536),
  },
});
const port = Number(process.env.PORT ?? 8000);
await app.listen({ host: "127.0.0.1", port });
