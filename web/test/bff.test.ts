import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../bff/env";
import { proxy, resolveTarget } from "../bff/handler";

describe("BFF", () => {
  it("solo expone rutas de lectura y conserva la query", () => {
    expect(resolveTarget("/api/prices?countries=PL&from=a&to=b", "http://x/")).toBe("http://x/v1/prices?countries=PL&from=a&to=b");
    expect(resolveTarget("/api/status", "http://x")).toBe("http://x/v1/status");
    expect(resolveTarget("/api/ingest", "http://x")).toBeNull();
    expect(resolveTarget("/api/../v1/prices", "http://x")).toBeNull();
  });

  it("agrega la key, traduce 401/403 a 403 y no acepta POST", async () => {
    const calls: Array<{ url: string; key: string | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), key: (init?.headers as Record<string, string>)["x-api-key"] });
      return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const cfg = { baseUrl: "http://api", apiKey: "dap_k", fetchImpl };
    const ok = await proxy("GET", "/api/countries", cfg);
    expect(ok.status).toBe(200);
    expect(calls[0]).toEqual({ url: "http://api/v1/countries", key: "dap_k" });
    expect((await proxy("POST", "/api/countries", cfg)).status).toBe(405);
    const denied = { ...cfg, fetchImpl: (async () => new Response("", { status: 401 })) as unknown as typeof fetch };
    expect((await proxy("GET", "/api/countries", denied)).status).toBe(403);
    expect((await proxy("GET", "/api/countries", { baseUrl: undefined, apiKey: undefined })).status).toBe(503);
    const down = { ...cfg, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch };
    expect((await proxy("GET", "/api/countries", down)).status).toBe(502);
  });

  it("parseEnv ignora comentarios y comillas", () => {
    expect(parseEnv('# c\nA=1\nB="dos"\n\nC=x=y\n')).toEqual({ A: "1", B: "dos", C: "x=y" });
  });
});
