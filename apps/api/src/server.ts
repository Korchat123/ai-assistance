import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 8000);
await app.listen({ host: "127.0.0.1", port });
