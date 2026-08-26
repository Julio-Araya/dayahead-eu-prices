import type { ApiKeyRecord, ApiKeyStore } from "../src/auth/apiKey.js";
import { hashApiKey } from "../src/auth/apiKey.js";
import type { Config } from "../src/config.js";
import type { IngestPayloadT, IngestResult, IngestWriter } from "../src/ingest/writer.js";
import type { CountryRow, CountryStatus, LoadControlRow, PriceQuery, PriceReader, PriceRow } from "../src/readers/types.js";

export const TEST_SECRET = "test-secret";
export const TEST_KEY = "dap_testkey_0123456789";

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: "",
    ingestHmacSecret: TEST_SECRET,
    ingestMaxSkewSeconds: 300,
    dataReader: "postgres",
    defaultRateLimitPerMinute: 120,
    corsOrigin: null,
    fabric: { endpoint: null, tenantId: null, clientId: null, clientSecret: null },
    ...over,
  };
}

export function price(over: Partial<PriceRow> = {}): PriceRow {
  return {
    country_code: "PL",
    ts_utc: "2026-08-24T22:00:00Z",
    resolution: "PT15M",
    business_date_local: "2026-08-25",
    price_original: "689.72",
    currency_original: "PLN",
    price_eur: "160.1951",
    fx_rate: "4.3055",
    fx_rate_date: "2026-08-25",
    source: "pse",
    source_published_at: "2026-08-24T11:46:21.852Z",
    ...over,
  };
}

export class FakeReader implements PriceReader {
  readonly kind = "postgres" as const;
  prices: PriceRow[] = [];
  control: LoadControlRow[] = [];
  status: CountryStatus[] = [];
  countries: CountryRow[] = [{ country_code: "PL", name: "Polonia", market_tz: "Europe/Warsaw", currency: "PLN", resolution: "PT15M", source: "pse", active: true }];
  pingOk = true;
  async getCountries() { return this.countries; }
  async getPrices(q: PriceQuery) { return this.prices.filter((p) => q.countries.includes(p.country_code) && p.business_date_local >= q.from && p.business_date_local <= q.to); }
  async getLoadControl(q: PriceQuery) { return this.control.filter((c) => q.countries.includes(c.country_code)); }
  async getStatus() { return this.status; }
  async ping() { return { ok: this.pingOk, detail: this.pingOk ? undefined : "db caída" }; }
}

export class FakeWriter implements IngestWriter {
  nonces = new Set<string>();
  received: IngestPayloadT[] = [];
  async write(payload: IngestPayloadT, nonce: string): Promise<IngestResult | "replay"> {
    if (this.nonces.has(nonce)) return "replay";
    this.nonces.add(nonce);
    this.received.push(payload);
    const countries = [...new Set([...payload.prices, ...payload.load_control].map((r) => r.country_code))].sort();
    return { prices_upserted: payload.prices.length, load_control_upserted: payload.load_control.length, countries };
  }
}

export class FakeKeys implements ApiKeyStore {
  records = new Map<string, ApiKeyRecord>([[hashApiKey(TEST_KEY), { id: "k1", name: "test", scope: "read", rateLimitPerMinute: 3, active: true }]]);
  touched: string[] = [];
  async findByHash(hash: string) { return this.records.get(hash) ?? null; }
  async touch(id: string) { this.touched.push(id); }
}
