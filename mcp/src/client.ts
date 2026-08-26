/** Cliente mínimo de la API de precios. Solo lecturas; la key va en la cabecera X-API-Key. */

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

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private base: string;
  private key: string;
  private f: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.key = opts.apiKey;
    this.f = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.base}/v1/${path}${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await this.f(url, { headers: { "x-api-key": this.key, accept: "application/json" } });
    } catch (e) {
      throw new ApiError(0, "network", `no se pudo contactar la API en ${this.base}: ${(e as Error).message}`);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `HTTP ${res.status}`);
    }
    return body as T;
  }

  countries() {
    return this.get<{ count: number; rows: CountryRow[] }>("countries");
  }
  prices(q: { countries: string[]; from: string; to: string; granularity: "native" | "hourly" }) {
    return this.get<{ count: number; rows: PriceRow[] }>("prices", { countries: q.countries.join(","), from: q.from, to: q.to, granularity: q.granularity });
  }
  status() {
    return this.get<{ reader: string; generated_at: string; rows: StatusRow[] }>("status");
  }
  loadControl(q: { countries: string[]; from: string; to: string }) {
    return this.get<{ count: number; rows: LoadControlRow[] }>("load-control", { countries: q.countries.join(","), from: q.from, to: q.to });
  }
}
