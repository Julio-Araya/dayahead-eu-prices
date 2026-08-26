/**
 * Escritura de una ingestión en Postgres. Upsert idempotente por clave; el mismo cuerpo dos veces
 * deja la base igual. Se ejecuta en una transacción junto con el registro del nonce.
 */
import type pg from "pg";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD");
const isoTs = z.string().datetime({ offset: true });
const decimal = z.union([z.string().regex(/^-?\d+(\.\d+)?$/), z.number()]).transform(String);

export const PricePayload = z.object({
  country_code: z.string().min(2).max(3),
  ts_utc: isoTs,
  resolution: z.string().regex(/^PT\d+[MH]$/),
  business_date_local: isoDate,
  price_original: decimal,
  currency_original: z.string().length(3),
  price_eur: decimal,
  fx_rate: decimal,
  fx_rate_date: isoDate,
  source: z.string().min(1),
  source_published_at: isoTs.nullable().optional(),
});

export const LoadControlPayload = z.object({
  country_code: z.string().min(2).max(3),
  business_date_local: isoDate,
  expected_slots: z.number().int().nonnegative(),
  loaded_slots: z.number().int().nonnegative(),
  status: z.enum(["complete", "incomplete", "pending", "error"]),
  source_published_at: isoTs.nullable().optional(),
  last_attempt_utc: isoTs,
  last_success_utc: isoTs.nullable().optional(),
  last_error: z.string().nullable().optional(),
  run_id: z.string().min(1),
});

export const IngestPayload = z.object({
  run_id: z.string().min(1).max(64),
  ingested_at_utc: isoTs,
  part: z.number().int().positive().optional(),
  parts: z.number().int().positive().optional(),
  prices: z.array(PricePayload).max(5000),
  load_control: z.array(LoadControlPayload).max(1000),
});

export type IngestPayloadT = z.infer<typeof IngestPayload>;

export interface IngestResult {
  prices_upserted: number;
  load_control_upserted: number;
  countries: string[];
}

export interface IngestWriter {
  write(payload: IngestPayloadT, nonce: string): Promise<IngestResult | "replay">;
}

const PRICE_COLS = [
  "country_code", "ts_utc", "resolution", "business_date_local", "price_original", "currency_original",
  "price_eur", "fx_rate", "fx_rate_date", "source", "source_published_at", "ingested_at_utc",
] as const;

const CONTROL_COLS = [
  "country_code", "business_date_local", "expected_slots", "loaded_slots", "status", "source_published_at",
  "last_attempt_utc", "last_success_utc", "last_error", "run_id",
] as const;

function multiRowInsert(table: string, cols: readonly string[], rows: unknown[][], conflictKeys: string[], extraSet = ""): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const placeholders = row.map((v) => {
      values.push(v);
      return `$${values.length}`;
    });
    return `(${placeholders.join(",")})`;
  });
  const updates = cols.filter((c) => !conflictKeys.includes(c)).map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const text = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}
    ON CONFLICT (${conflictKeys.join(",")}) DO UPDATE SET ${updates}${extraSet}`;
  return { text, values };
}

export class PostgresIngestWriter implements IngestWriter {
  constructor(private pool: pg.Pool, private chunkSize = 500) {}

  async write(payload: IngestPayloadT, nonce: string): Promise<IngestResult | "replay"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const seen = await client.query("INSERT INTO ingest_nonces (nonce) VALUES ($1) ON CONFLICT DO NOTHING RETURNING nonce", [nonce]);
      if (seen.rowCount === 0) {
        await client.query("ROLLBACK");
        return "replay";
      }
      await client.query("DELETE FROM ingest_nonces WHERE seen_at < now() - interval '1 hour'");

      let pricesUpserted = 0;
      for (let i = 0; i < payload.prices.length; i += this.chunkSize) {
        const chunk = payload.prices.slice(i, i + this.chunkSize).map((p) => [
          p.country_code, p.ts_utc, p.resolution, p.business_date_local, p.price_original, p.currency_original,
          p.price_eur, p.fx_rate, p.fx_rate_date, p.source, p.source_published_at ?? null, payload.ingested_at_utc,
        ]);
        const q = multiRowInsert("prices", PRICE_COLS, chunk, ["country_code", "ts_utc"], ", received_at = now()");
        pricesUpserted += (await client.query(q)).rowCount ?? 0;
      }

      let controlUpserted = 0;
      for (let i = 0; i < payload.load_control.length; i += this.chunkSize) {
        const chunk = payload.load_control.slice(i, i + this.chunkSize).map((c) => [
          c.country_code, c.business_date_local, c.expected_slots, c.loaded_slots, c.status, c.source_published_at ?? null,
          c.last_attempt_utc, c.last_success_utc ?? null, c.last_error ?? null, c.run_id,
        ]);
        const q = multiRowInsert("load_control", CONTROL_COLS, chunk, ["country_code", "business_date_local"], ", received_at = now()");
        controlUpserted += (await client.query(q)).rowCount ?? 0;
      }

      const countries = [...new Set([...payload.prices, ...payload.load_control].map((r) => r.country_code))].sort();
      await client.query(
        "INSERT INTO ingest_runs (run_id, prices_rows, control_rows, countries) VALUES ($1, $2, $3, $4)",
        [payload.run_id, pricesUpserted, controlUpserted, countries],
      );
      await client.query("COMMIT");
      return { prices_upserted: pricesUpserted, load_control_upserted: controlUpserted, countries };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
