import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { sign } from "../src/auth/hmac.js";
import { FixedWindowRateLimiter } from "../src/auth/rateLimit.js";
import { FakeKeys, FakeReader, FakeWriter, TEST_KEY, TEST_SECRET, price, testConfig } from "./helpers.js";

const NOW = 1756224000;

function build() {
  const reader = new FakeReader();
  const writer = new FakeWriter();
  const keys = new FakeKeys();
  const app = createApp({ config: testConfig(), reader, writer, keys, limiter: new FixedWindowRateLimiter(60, () => NOW), now: () => NOW });
  return { app, reader, writer, keys };
}

function signed(body: object, opts: { ts?: number; nonce?: string; secret?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body), "utf8");
  const ts = opts.ts ?? NOW;
  const nonce = opts.nonce ?? "n-1";
  return { raw: raw.toString("utf8"), headers: { "content-type": "application/json", "x-timestamp": String(ts), "x-nonce": nonce, "x-signature": "sha256=" + sign(opts.secret ?? TEST_SECRET, ts, nonce, raw) } };
}

const PAYLOAD = {
  run_id: "20260826T160000Z",
  ingested_at_utc: "2026-08-26T16:00:00Z",
  prices: [price()],
  load_control: [{ country_code: "PL", business_date_local: "2026-08-25", expected_slots: 96, loaded_slots: 96, status: "complete", last_attempt_utc: "2026-08-26T16:00:00Z", run_id: "20260826T160000Z" }],
};

describe("POST /v1/ingest", () => {
  it("acepta un cuerpo bien firmado y escribe", async () => {
    const { app, writer } = build();
    const { raw, headers } = signed(PAYLOAD);
    const res = await request(app).post("/v1/ingest").set(headers).send(raw);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, run_id: PAYLOAD.run_id, prices_upserted: 1, load_control_upserted: 1, countries: ["PL"] });
    expect(writer.received).toHaveLength(1);
  });

  it("rechaza replay del mismo nonce con 409", async () => {
    const { app } = build();
    const { raw, headers } = signed(PAYLOAD);
    expect((await request(app).post("/v1/ingest").set(headers).send(raw)).status).toBe(200);
    const again = await request(app).post("/v1/ingest").set(headers).send(raw);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("replay");
  });

  it("rechaza firma con otro secreto, timestamp fuera de ventana y cuerpo alterado", async () => {
    const { app, writer } = build();
    const bad = signed(PAYLOAD, { secret: "otro" });
    expect((await request(app).post("/v1/ingest").set(bad.headers).send(bad.raw)).status).toBe(401);
    const old = signed(PAYLOAD, { ts: NOW - 600 });
    expect((await request(app).post("/v1/ingest").set(old.headers).send(old.raw)).body.error.code).toBe("hmac_skew");
    const { raw, headers } = signed(PAYLOAD);
    const tampered = raw.replace("689.72", "1.00");
    expect((await request(app).post("/v1/ingest").set(headers).send(tampered)).body.error.code).toBe("hmac_bad_signature");
    expect(writer.received).toHaveLength(0);
  });

  it("rechaza sin cabeceras y con payload inválido", async () => {
    const { app } = build();
    expect((await request(app).post("/v1/ingest").send({})).status).toBe(401);
    const { raw, headers } = signed({ run_id: "x", ingested_at_utc: "2026-08-26T16:00:00Z", prices: [{ country_code: "PL" }], load_control: [] });
    const res = await request(app).post("/v1/ingest").set(headers).send(raw);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_payload");
  });

  it("no exige API key para ingestión pero sí HMAC configurado", async () => {
    const reader = new FakeReader();
    const app = createApp({ config: testConfig({ ingestHmacSecret: "" }), reader, writer: new FakeWriter(), keys: new FakeKeys() });
    const { raw, headers } = signed(PAYLOAD);
    expect((await request(app).post("/v1/ingest").set(headers).send(raw)).status).toBe(503);
  });
});

describe("lecturas con API key", () => {
  it("401 sin clave, 403 con clave desconocida", async () => {
    const { app } = build();
    expect((await request(app).get("/v1/prices?countries=PL&from=2026-08-25&to=2026-08-25")).status).toBe(401);
    expect((await request(app).get("/v1/prices?countries=PL&from=2026-08-25&to=2026-08-25").set("X-API-Key", "dap_nope")).status).toBe(403);
  });

  it("devuelve precios nativos y horarios", async () => {
    const { app, reader } = build();
    reader.prices = [0, 15, 30, 45].map((m) => price({ ts_utc: `2026-08-24T22:${String(m).padStart(2, "0")}:00Z`, price_eur: String(100 + m) }));
    const native = await request(app).get("/v1/prices?countries=pl&from=2026-08-25&to=2026-08-25").set("Authorization", `Bearer ${TEST_KEY}`);
    expect(native.status).toBe(200);
    expect(native.body.count).toBe(4);
    expect(native.body.rows[0]).toMatchObject({ price_eur: "100", price_original: "689.72", currency_original: "PLN" });
    const hourly = await request(app).get("/v1/prices?countries=PL&from=2026-08-25&to=2026-08-25&granularity=hourly").set("Authorization", `Bearer ${TEST_KEY}`);
    expect(hourly.body.count).toBe(1);
    expect(hourly.body.rows[0]).toMatchObject({ ts_utc: "2026-08-24T22:00:00Z", price_eur: "122.5000", slots: 4, resolution: "PT60M" });
  });

  it("400 con parámetros inválidos", async () => {
    const { app } = build();
    const res = await request(app).get("/v1/prices?countries=PL&from=2026-08-26&to=2026-08-25").set("Authorization", `Bearer ${TEST_KEY}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_query");
  });

  it("aplica el límite por clave con cabeceras y 429", async () => {
    const { app } = build(); // la clave de prueba tiene 3 req/min
    for (let i = 0; i < 3; i++) {
      const r = await request(app).get("/v1/countries").set("X-API-Key", TEST_KEY);
      expect(r.status).toBe(200);
      expect(r.headers["x-ratelimit-remaining"]).toBe(String(2 - i));
    }
    const blocked = await request(app).get("/v1/countries").set("X-API-Key", TEST_KEY);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("status marca desactualizado y health refleja el lector", async () => {
    const { app, reader } = build();
    reader.status = [{ country_code: "PL", last_complete_date: "2026-08-25", last_attempt_utc: "2020-01-01T00:00:00Z", last_run_id: "r", pending_days: 0, incomplete_days: 0, error_days: 0 }];
    const st = await request(app).get("/v1/status").set("X-API-Key", TEST_KEY);
    expect(st.body.rows[0].stale).toBe(true);
    expect((await request(app).get("/v1/health")).status).toBe(200);
    reader.pingOk = false;
    expect((await request(app).get("/v1/health")).status).toBe(503);
  });

  it("404 en rutas desconocidas y JSON de error uniforme", async () => {
    const { app } = build();
    const res = await request(app).get("/v1/nada").set("X-API-Key", TEST_KEY);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "not_found" });
  });
});
