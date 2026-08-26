import { describe, expect, it, vi } from "vitest";
import { FabricGraphqlPriceReader } from "../src/readers/fabricGraphql.js";

describe("lector fabric-graphql", () => {
  it("sin credenciales: ping falla con el motivo y las lecturas lanzan", async () => {
    const r = new FabricGraphqlPriceReader({ endpoint: null, tenantId: null, clientId: null, clientSecret: null });
    const p = await r.ping();
    expect(p.ok).toBe(false);
    expect(p.detail).toContain("FABRIC_GRAPHQL_ENDPOINT");
    await expect(r.getCountries()).rejects.toThrow(/sin credenciales/);
  });

  it("con credenciales: pide token por client credentials, lo reutiliza y consulta por país", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const body = typeof init?.body === "string" ? init.body : String(init?.body);
      calls.push({ url: u, body });
      if (u.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      const q = JSON.parse(body).query as string;
      if (q.includes("sources_configs")) return new Response(JSON.stringify({ data: { sources_configs: { items: [{ country_code: "PL", adapter: "pse", market_tz: "Europe/Warsaw", currency: "PLN", resolution: "PT15M", active: true }] } } }));
      if (q.includes("prices_pls")) return new Response(JSON.stringify({ data: { prices_pls: { items: [{ country_code: "PL", ts_utc: "2026-08-24T22:00:00Z", price_original: 689.72, price_eur: 160.1951, fx_rate: 4.3055 }] } } }));
      return new Response(JSON.stringify({ data: { __typename: "Query" } }));
    }) as unknown as typeof fetch;
    let now = 0;
    const r = new FabricGraphqlPriceReader({ endpoint: "https://gql.example/graphql", tenantId: "t", clientId: "c", clientSecret: "s", fetchImpl, now: () => now });
    expect((await r.ping()).ok).toBe(true);
    const countries = await r.getCountries();
    expect(countries[0]).toMatchObject({ country_code: "PL", source: "pse" });
    const prices = await r.getPrices({ countries: ["PL"], from: "2026-08-25", to: "2026-08-25" });
    expect(prices[0]).toMatchObject({ price_original: "689.72", price_eur: "160.1951", fx_rate: "4.3055" });
    expect(calls.filter((c) => c.url.includes("login.microsoftonline.com"))).toHaveLength(1);
    expect(calls[0].body).toContain("grant_type=client_credentials");
    expect(calls[0].body).toContain(encodeURIComponent("https://api.fabric.microsoft.com/.default"));
    expect(FabricGraphqlPriceReader.priceTable("ES")).toBe("prices_ess");
  });

  it("propaga errores GraphQL", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("login") ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })) : new Response(JSON.stringify({ errors: [{ message: "campo desconocido" }] })),
    ) as unknown as typeof fetch;
    const r = new FabricGraphqlPriceReader({ endpoint: "https://gql.example/graphql", tenantId: "t", clientId: "c", clientSecret: "s", fetchImpl });
    await expect(r.getCountries()).rejects.toThrow(/campo desconocido/);
  });
});
