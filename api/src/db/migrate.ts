/**
 * Aplica db/migrations/*.sql en orden, una sola vez cada uno (tabla schema_migrations).
 *   cd api && npm run migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { getPool, closePool } from "./pool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../../../db/migrations");

export async function listMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return files;
}

export async function migrate(databaseUrl: string, dir = MIGRATIONS_DIR, log: (s: string) => void = console.log): Promise<string[]> {
  const pool = getPool(databaseUrl);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of await listMigrations(dir)) {
      if (done.has(file)) {
        log(`= ${file} (ya aplicada)`);
        continue;
      }
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migración ${file} falló: ${(e as Error).message}`);
      }
      applied.push(file);
      log(`+ ${file}`);
    }
  } finally {
    client.release();
  }
  return applied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) {
    console.error("DATABASE_URL no está definida (.env en la raíz del repo)");
    process.exit(2);
  }
  migrate(cfg.databaseUrl)
    .then((a) => console.log(a.length ? `${a.length} migración(es) aplicada(s)` : "sin cambios"))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(closePool);
}
