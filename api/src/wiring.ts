/** Ensambla la app con dependencias reales (Postgres). Compartido por server.ts y api/index.ts. */
import { createApp } from "./app.js";
import type { ApiKeyRecord, ApiKeyStore } from "./auth/apiKey.js";
import { loadConfig } from "./config.js";
import { getPool } from "./db/pool.js";
import { PostgresIngestWriter } from "./ingest/writer.js";
import { createReader } from "./readers/index.js";

export class PostgresApiKeyStore implements ApiKeyStore {
  constructor(private databaseUrl: string) {}
  async findByHash(hash: string): Promise<ApiKeyRecord | null> {
    const r = await getPool(this.databaseUrl).query<{ id: string; name: string; scope: "read"; rate_limit_per_minute: number; active: boolean }>(
      "SELECT id, name, scope, rate_limit_per_minute, active FROM api_keys WHERE key_hash = $1",
      [hash],
    );
    const row = r.rows[0];
    return row ? { id: row.id, name: row.name, scope: row.scope, rateLimitPerMinute: row.rate_limit_per_minute, active: row.active } : null;
  }
  async touch(id: string): Promise<void> {
    await getPool(this.databaseUrl).query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [id]);
  }
}

export function buildApp() {
  const config = loadConfig();
  if (!config.databaseUrl) throw new Error("DATABASE_URL es obligatoria (ingestión y API keys viven en Postgres)");
  return createApp({
    config,
    reader: createReader(config),
    writer: new PostgresIngestWriter(getPool(config.databaseUrl)),
    keys: new PostgresApiKeyStore(config.databaseUrl),
  });
}
