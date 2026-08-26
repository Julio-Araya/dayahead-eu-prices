import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { ApiClient } from "../src/client.js";
import { createServer } from "../src/server.js";

function fakeFetch(routes: Record<string, unknown | ((url: URL) => unknown)>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = (init?.headers as Record<string, string>)["x-api-key"];
    if (key !== "dap_test") return new Response(JSON.stringify({ error: { code: "forbidden", message: "key inválida" } }), { status: 403 });
    const path = url.pathname.replace("/v1/", "");
    const r = routes[path];
    if (r === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: "?" } }), { status: 404 });
    return new Response(JSON.stringify(typeof r === "function" ? (r as (u: URL) => unknown)(url) : r), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const price = (cc: string, ts: string, eur: string) => ({ country_code: cc, ts_utc: ts, resolution: "PT60M", business_date_local: "2026-08-25", price_original: eur, currency_original: "EUR", price_eur: eur, fx_rate: "1", fx_rate_date: "2026-08-25", source: "entsoe", source_published_at: null });

async function connect(fetchImpl: typeof fetch, apiKey = "dap_test") {
  const server = createServer(new ApiClient({ baseUrl: "https://api.test", apiKey, fetchImpl }), () => "2026-08-26");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(b);
  return client;
}

describe("servidor MCP", () => {
  it("expone cuatro herramientas de solo lectura", async () => {
    const client = await connect(fakeFetch({}));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["compare_prices", "get_load_status", "get_prices", "list_countries"]);
    expect(tools.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("get_prices resume y opcionalmente incluye filas; valida argumentos", async () => {
    const client = await connect(fakeFetch({
      prices: (u: URL) => ({ count: 2, rows: [price("ES", "2026-08-24T22:00:00Z", "10"), price("ES", "2026-08-24T23:00:00Z", "30")], q: u.search }),
    }));
    const r = await client.callTool({ name: "get_prices", arguments: { countries: ["ES"], from: "2026-08-25", to: "2026-08-25" } });
    const txt = (r.content as Array<{ type: string; text: string }>)[0].text;
    expect(txt).toContain("| ES | EUR | PT60M | 2 | 20 | 10 | 2026-08-24T22:00:00Z | 30 |");
    expect(txt).not.toContain("Filas (");
    const withRows = await client.callTool({ name: "get_prices", arguments: { countries: ["ES"], from: "2026-08-25", to: "2026-08-25", include_rows: true } });
    expect((withRows.content as Array<{ text: string }>)[0].text).toContain("Filas (2)");
    const bad = await client.callTool({ name: "get_prices", arguments: { countries: ["ES"], from: "25-08-2026", to: "2026-08-25" } });
    expect(bad.isError).toBe(true);
  });

  it("compare_prices alinea por hora y nombra al más barato", async () => {
    const client = await connect(fakeFetch({
      prices: { count: 4, rows: [price("ES", "2026-08-24T22:00:00Z", "100"), price("PL", "2026-08-24T22:00:00Z", "80"), price("ES", "2026-08-24T23:00:00Z", "50"), price("PL", "2026-08-24T23:00:00Z", "90")] },
    }));
    const r = await client.callTool({ name: "compare_prices", arguments: { countries: ["ES", "PL"], date: "2026-08-25" } });
    const txt = (r.content as Array<{ text: string }>)[0].text;
    expect(txt).toContain("Horas más barato: ES 1 h, PL 1 h");
    expect(txt).toContain("| 22:00 | 100 | 80 | PL | 20 |");
  });

  it("get_load_status usa 7 días + D+1 por defecto y lista días no completos", async () => {
    let lcQuery = "";
    const client = await connect(fakeFetch({
      status: { reader: "postgres", generated_at: "2026-08-26T18:00:00Z", rows: [{ country_code: "ES", last_complete_date: "2026-08-26", last_attempt_utc: "2026-08-26T18:00:00Z", last_run_id: "r", pending_days: 1, incomplete_days: 0, error_days: 0, stale: false }] },
      "load-control": (u: URL) => { lcQuery = u.search; return { count: 1, rows: [{ country_code: "ES", business_date_local: "2026-08-27", expected_slots: 96, loaded_slots: 0, status: "pending", source_published_at: null, last_attempt_utc: "2026-08-26T18:00:00Z", last_success_utc: null, last_error: null, run_id: "r" }] }; },
    }));
    const r = await client.callTool({ name: "get_load_status", arguments: {} });
    const txt = (r.content as Array<{ text: string }>)[0].text;
    expect(lcQuery).toContain("from=2026-08-19&to=2026-08-27");
    expect(txt).toContain("| ES | 2026-08-26 | 2026-08-26T18:00:00Z | no | 0/1 | 1 | 0 | 0 |");
    expect(txt).toContain("| 2026-08-27 | ES | pending | 0/96 |");
  });

  it("errores de la API se devuelven como isError con código", async () => {
    const client = await connect(fakeFetch({}), "dap_wrong");
    const r = await client.callTool({ name: "list_countries", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as Array<{ text: string }>)[0].text).toContain("API 403 forbidden");
  });
});
