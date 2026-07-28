import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

dotenv.config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required to run PostgreSQL migrations.");
}

const migrationUrls = [
  new URL("../migrations/001_phase6.sql", import.meta.url),
  new URL("../migrations/002_phase7_memory.sql", import.meta.url),
];
const migrations = await Promise.all(
  migrationUrls.map((url) => readFile(fileURLToPath(url), "utf8")),
);
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  for (const migration of migrations) {
    await pool.query(migration);
  }
} finally {
  await pool.end();
}
