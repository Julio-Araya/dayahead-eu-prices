import type pg from "pg";
import type { CountryRow, CountryStatus, LoadControlRow, PriceQuery, PriceReader, PriceRow } from "./types.js";

export class PostgresPriceReader implements PriceReader {
  readonly kind = "postgres" as const;

  constructor(private pool: pg.Pool) {}

  async getCountries(): Promise<CountryRow[]> {
    const r = await this.pool.query<CountryRow>(
      "SELECT country_code, name, market_tz, currency, resolution, source, active FROM countries ORDER BY country_code",
    );
    return r.rows;
  }

  async getPrices(q: PriceQuery): Promise<PriceRow[]> {
    const r = await this.pool.query<PriceRow>(
      `SELECT country_code, ts_utc, resolution, business_date_local, price_original, currency_original,
              price_eur, fx_rate, fx_rate_date, source, source_published_at
         FROM prices
        WHERE country_code = ANY($1::text[]) AND business_date_local BETWEEN $2::date AND $3::date
        ORDER BY country_code, ts_utc`,
      [q.countries, q.from, q.to],
    );
    return r.rows;
  }

  async getLoadControl(q: PriceQuery): Promise<LoadControlRow[]> {
    const r = await this.pool.query<LoadControlRow>(
      `SELECT country_code, business_date_local, expected_slots, loaded_slots, status, source_published_at,
              last_attempt_utc, last_success_utc, last_error, run_id
         FROM load_control
        WHERE country_code = ANY($1::text[]) AND business_date_local BETWEEN $2::date AND $3::date
        ORDER BY country_code, business_date_local`,
      [q.countries, q.from, q.to],
    );
    return r.rows;
  }

  async getStatus(): Promise<CountryStatus[]> {
    const r = await this.pool.query<CountryStatus & { pending_days: string; incomplete_days: string; error_days: string }>(
      `SELECT c.country_code,
              (SELECT MAX(business_date_local) FROM load_control l WHERE l.country_code = c.country_code AND l.status = 'complete') AS last_complete_date,
              (SELECT MAX(last_attempt_utc) FROM load_control l WHERE l.country_code = c.country_code) AS last_attempt_utc,
              (SELECT run_id FROM load_control l WHERE l.country_code = c.country_code ORDER BY last_attempt_utc DESC LIMIT 1) AS last_run_id,
              (SELECT COUNT(*) FROM load_control l WHERE l.country_code = c.country_code AND l.status = 'pending') AS pending_days,
              (SELECT COUNT(*) FROM load_control l WHERE l.country_code = c.country_code AND l.status = 'incomplete') AS incomplete_days,
              (SELECT COUNT(*) FROM load_control l WHERE l.country_code = c.country_code AND l.status = 'error') AS error_days
         FROM countries c WHERE c.active ORDER BY c.country_code`,
    );
    return r.rows.map((row) => ({
      ...row,
      pending_days: Number(row.pending_days),
      incomplete_days: Number(row.incomplete_days),
      error_days: Number(row.error_days),
    }));
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.pool.query("SELECT 1");
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
