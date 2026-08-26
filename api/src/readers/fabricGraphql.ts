/**
 * Adaptador alternativo: lee directamente del Lakehouse a través de la API for GraphQL de Fabric
 * (BRIEF D1, opción 3). Correcto en un entorno real, imposible con el acceso de la prueba: exige un
 * service principal registrado en Entra ID. Está implementado hasta donde se puede sin credenciales:
 *
 * - Autenticación: client credentials contra `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
 *   con scope `https://api.fabric.microsoft.com/.default` (hipótesis documentada por Microsoft para
 *   llamadas a la API de Fabric con SPN; no verificada en vivo).
 * - Consultas: la API for GraphQL de Fabric expone cada tabla del Lakehouse como `<tabla>s` con
 *   argumentos `filter`, `first` y `orderBy`, y devuelve `{ items: [...] }`. Los nombres de campos
 *   coinciden con las columnas. Las consultas de abajo siguen esa convención (hipótesis: los nombres
 *   exactos se confirman en el editor de la API una vez creada).
 * - Diferencias frente a Postgres: el Lakehouse tiene una tabla por país (prices_es, prices_ro, ...),
 *   así que una consulta multipaís son N consultas; el catálogo sale de sources_config.
 *
 * Con DATA_READER=fabric-graphql y las cuatro variables FABRIC_* definidas, el lector queda activo;
 * sin ellas, `ping()` devuelve ok=false con el motivo y la API responde 503 en las lecturas.
 */
import type { CountryRow, CountryStatus, LoadControlRow, PriceQuery, PriceReader, PriceRow } from "./types.js";

export interface FabricGraphqlOptions {
  endpoint: string | null;
  tenantId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface Token {
  value: string;
  expiresAt: number;
}

export class FabricGraphqlPriceReader implements PriceReader {
  readonly kind = "fabric-graphql" as const;
  private token: Token | null = null;
  private fetchImpl: typeof fetch;
  private now: () => number;

  constructor(private opts: FabricGraphqlOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => Date.now());
  }

  private missing(): string[] {
    const m: string[] = [];
    if (!this.opts.endpoint) m.push("FABRIC_GRAPHQL_ENDPOINT");
    if (!this.opts.tenantId) m.push("FABRIC_TENANT_ID");
    if (!this.opts.clientId) m.push("FABRIC_CLIENT_ID");
    if (!this.opts.clientSecret) m.push("FABRIC_CLIENT_SECRET");
    return m;
  }

  async ping(): Promise<{ ok: boolean; detail?: string }> {
    const m = this.missing();
    if (m.length) return { ok: false, detail: `fabric-graphql sin credenciales: faltan ${m.join(", ")}` };
    try {
      await this.query("{ __typename }");
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  private async accessToken(): Promise<string> {
    const m = this.missing();
    if (m.length) throw new Error(`fabric-graphql sin credenciales: faltan ${m.join(", ")}`);
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const url = `https://login.microsoftonline.com/${this.opts.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.opts.clientId!,
      client_secret: this.opts.clientSecret!,
      scope: "https://api.fabric.microsoft.com/.default",
    });
    const res = await this.fetchImpl(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    if (!res.ok) throw new Error(`token Entra ID: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return this.token.value;
  }

  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(this.opts.endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Fabric GraphQL: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`Fabric GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
    return json.data as T;
  }

  async getCountries(): Promise<CountryRow[]> {
    const data = await this.query<{ sources_configs: { items: Array<{ country_code: string; adapter: string; market_tz: string; currency: string; resolution: string; active: boolean }> } }>(
      `query { sources_configs(first: 100) { items { country_code adapter market_tz currency resolution active } } }`,
    );
    return data.sources_configs.items.map((s) => ({
      country_code: s.country_code,
      name: s.country_code,
      market_tz: s.market_tz,
      currency: s.currency,
      resolution: s.resolution,
      source: s.adapter,
      active: s.active,
    }));
  }

  static priceTable(countryCode: string): string {
    return `prices_${countryCode.toLowerCase()}s`; // la API for GraphQL pluraliza el nombre de la tabla
  }

  async getPrices(q: PriceQuery): Promise<PriceRow[]> {
    const out: PriceRow[] = [];
    for (const cc of q.countries) {
      const table = FabricGraphqlPriceReader.priceTable(cc);
      const data = await this.query<Record<string, { items: PriceRow[] }>>(
        `query ($from: Date!, $to: Date!) {
           ${table}(first: 100000, orderBy: { ts_utc: ASC }, filter: { business_date_local: { gte: $from, lte: $to } }) {
             items { country_code ts_utc resolution business_date_local price_original currency_original price_eur fx_rate fx_rate_date source source_published_at }
           }
         }`,
        { from: q.from, to: q.to },
      );
      out.push(...(data[table]?.items ?? []).map(normalizePrice));
    }
    return out;
  }

  async getLoadControl(q: PriceQuery): Promise<LoadControlRow[]> {
    const data = await this.query<{ load_controls: { items: LoadControlRow[] } }>(
      `query ($from: Date!, $to: Date!, $countries: [String!]!) {
         load_controls(first: 100000, orderBy: { business_date_local: ASC },
                       filter: { business_date_local: { gte: $from, lte: $to }, country_code: { in: $countries } }) {
           items { country_code business_date_local expected_slots loaded_slots status source_published_at last_attempt_utc last_success_utc last_error run_id }
         }
       }`,
      { from: q.from, to: q.to, countries: q.countries },
    );
    return data.load_controls.items;
  }

  async getStatus(): Promise<CountryStatus[]> {
    const countries = await this.getCountries();
    const out: CountryStatus[] = [];
    for (const c of countries.filter((c) => c.active)) {
      const rows = await this.getLoadControl({ countries: [c.country_code], from: "1900-01-01", to: "2999-12-31" });
      const complete = rows.filter((r) => r.status === "complete").map((r) => r.business_date_local).sort();
      const latest = [...rows].sort((a, b) => (a.last_attempt_utc < b.last_attempt_utc ? 1 : -1))[0];
      out.push({
        country_code: c.country_code,
        last_complete_date: complete.length ? complete[complete.length - 1] : null,
        last_attempt_utc: latest?.last_attempt_utc ?? null,
        last_run_id: latest?.run_id ?? null,
        pending_days: rows.filter((r) => r.status === "pending").length,
        incomplete_days: rows.filter((r) => r.status === "incomplete").length,
        error_days: rows.filter((r) => r.status === "error").length,
      });
    }
    return out;
  }
}

function normalizePrice(p: PriceRow): PriceRow {
  // GraphQL entrega decimales como número o texto según el esquema; se homogeneiza a texto.
  return {
    ...p,
    price_original: String(p.price_original),
    price_eur: String(p.price_eur),
    fx_rate: String(p.fx_rate),
  };
}
