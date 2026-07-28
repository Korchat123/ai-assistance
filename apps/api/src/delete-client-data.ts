import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { createPersistence } from "./persistence.js";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const clientIdFlag = process.argv.indexOf("--client-id");
const clientId = clientIdFlag < 0 ? undefined : process.argv[clientIdFlag + 1];
const confirmed = process.argv.includes("--confirm");

if (clientId === undefined || clientId.trim() === "" || !confirmed) {
  throw new Error(
    "Usage: pnpm --filter @live2d-agent/api delete:client-data -- " +
      "--client-id <exact-id> --confirm",
  );
}
if (process.env.DATABASE_URL === undefined) {
  throw new Error("DATABASE_URL is required for durable deletion.");
}

const persistence = createPersistence(process.env.DATABASE_URL);
try {
  await persistence.deleteClientData(clientId);
  console.log(`Deleted durable data for client ${clientId}.`);
} finally {
  await persistence.close();
}
