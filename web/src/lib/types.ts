export type Granularity = "native" | "hourly";
export type Currency = "eur" | "original";

export interface PriceRow {
  country_code: string;
  ts_utc: string;
  resolution: string;
  business_date_local: string;
  price_original: string;
  currency_original: string;
  price_eur: string;
  fx_rate: string;
  fx_rate_date: string;
  source: string;
  source_published_at: string | null;
  slots?: number;
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

export interface StatusRow {
  country_code: string;
  last_complete_date: string | null;
  last_attempt_utc: string | null;
  last_run_id: string | null;
  pending_days: number;
  incomplete_days: number;
  error_days: number;
  stale: boolean;
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

/** Los cinco estados de una lectura remota (CLAUDE.md). "empty" solo tras una respuesta exitosa. */
export type RemoteStatus = "idle" | "loading" | "ok" | "empty" | "error" | "forbidden";

export interface Remote<T> {
  status: RemoteStatus;
  data?: T; // se conserva durante un refetch para no vaciar la pantalla
  error?: string;
}
