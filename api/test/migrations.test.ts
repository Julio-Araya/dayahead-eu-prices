import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, listMigrations } from "../src/db/migrate.js";

describe("migraciones", () => {
  it("se listan en orden y son idempotentes por construcción", async () => {
    const files = await listMigrations();
    expect(files[0]).toBe("001_init.sql");
    expect(files).toEqual([...files].sort());
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      const creates = sql.match(/CREATE (TABLE|INDEX)(?! IF NOT EXISTS)/g) ?? [];
      expect(creates, `${f}: CREATE sin IF NOT EXISTS`).toHaveLength(0);
      const inserts = sql.match(/INSERT INTO/g) ?? [];
      if (inserts.length) expect(sql, `${f}: INSERT sin ON CONFLICT`).toMatch(/ON CONFLICT/);
    }
  });

  it("001 define las tablas que usa la API", async () => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, "001_init.sql"), "utf8");
    for (const t of ["prices", "load_control", "countries", "api_keys", "ingest_nonces", "ingest_runs", "schema_migrations"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\(`));
    }
    expect(sql).toMatch(/PRIMARY KEY \(country_code, ts_utc\)/);
  });
});
