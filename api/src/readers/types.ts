/**
 * Interfaz de lectura (BRIEF D1, opción 3 como adaptador alternativo). Dos implementaciones:
 * postgres (activa) y fabric-graphql (documentada, sin credenciales). Se elige por DATA_READER.
 */
export type Granularity = "native" | "hourly";

export interface PriceRow {
  country_code: string;
  ts_utc: string; // ISO 8601 UTC, inicio del intervalo
  resolution: string; // PT15M | PT60M
  business_date_local: string; // YYYY-MM-DD
  price_original: string; // decimal como texto, sin pérdida
  currency_original: string;
  price_eur: string;
  fx_rate: string;
  fx_rate_date: string;
  source: string;
  source_published_at: string | null;
}

export interface PriceQuery {
  countries: string[];
  from: string; // business_date_local >= from (YYYY-MM-DD)
  to: string; // business_date_local <= to
}

export interface LoadControlRow {
  country_code: string;
  business_date_local: string;
  expected_slots: number;
  loaded_slots: number;
  status: "complete" | "incomplete" | "pending" | "error";
  source_published_at: string | null;
  last_attempt_utc: string;
  last_success_utc: string | null;
  last_error: string | null;
  run_id: string;
}

export interface CountryRow {
  country_code: string;
  name: string;
  market_tz: string;
  currency: string;
  resolution: string;
  source: string;
  active: boolean;
}

export interface CountryStatus {
  country_code: string;
  last_complete_date: string | null;
  last_attempt_utc: string | null;
  last_run_id: string | null;
  pending_days: number;
  incomplete_days: number;
  error_days: number;
}

export interface PriceReader {
  readonly kind: "postgres" | "fabric-graphql";
  getCountries(): Promise<CountryRow[]>;
  getPrices(q: PriceQuery): Promise<PriceRow[]>;
  getLoadControl(q: PriceQuery): Promise<LoadControlRow[]>;
  getStatus(): Promise<CountryStatus[]>;
  ping(): Promise<{ ok: boolean; detail?: string }>;
}
