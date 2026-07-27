import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const app = await buildApp();
const port = Number(process.env.PORT ?? 8000);
await app.listen({ host: "127.0.0.1", port });
