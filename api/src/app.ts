import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { ApiKeyStore } from "./auth/apiKey.js";
import { FixedWindowRateLimiter } from "./auth/rateLimit.js";
import type { Config } from "./config.js";
import type { IngestWriter } from "./ingest/writer.js";
import type { PriceReader } from "./readers/types.js";
import { ingestRouter } from "./routes/ingest.js";
import { requireApiKey, sendError } from "./routes/middleware.js";
import { readRouter } from "./routes/read.js";

export interface AppDeps {
  config: Config;
  reader: PriceReader;
  writer: IngestWriter;
  keys: ApiKeyStore;
  limiter?: FixedWindowRateLimiter;
  now?: () => number;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  const limiter = deps.limiter ?? new FixedWindowRateLimiter();

  if (deps.config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", deps.config.corsOrigin!);
      res.setHeader("Access-Control-Allow-Headers", "authorization, x-api-key, content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  }

  app.get("/", (_req, res) => res.json({ name: "dayahead-api", version: "0.1.0", docs: "/v1/health, /v1/countries, /v1/prices, /v1/load-control, /v1/status, POST /v1/ingest" }));

  app.get("/v1/health", async (_req, res) => {
    const ping = await deps.reader.ping();
    res.status(ping.ok ? 200 : 503).json({ ok: ping.ok, reader: deps.reader.kind, detail: ping.detail, time: new Date().toISOString() });
  });

  // Ingestión: HMAC, sin API key (D3). Va antes del middleware de claves.
  app.use(ingestRouter({ secret: deps.config.ingestHmacSecret, writer: deps.writer, maxSkewSeconds: deps.config.ingestMaxSkewSeconds, now: deps.now }));

  // Lectura: API key + rate limit por clave.
  app.use("/v1", requireApiKey(deps.keys, limiter, deps.config.defaultRateLimitPerMinute), readRouter(deps.reader));

  app.use((_req, res) => sendError(res, { status: 404, code: "not_found", message: "ruta no encontrada" }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string }).type === "entity.parse.failed") return sendError(res, { status: 400, code: "bad_json", message: "JSON inválido" });
    if ((err as { type?: string }).type === "entity.too.large") return sendError(res, { status: 413, code: "too_large", message: "cuerpo demasiado grande" });
    console.error(err);
    sendError(res, { status: 500, code: "internal", message: "error interno" });
  });

  return app;
}
