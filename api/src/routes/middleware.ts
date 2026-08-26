import type { NextFunction, Request, Response } from "express";
import { extractApiKey, hashApiKey, type ApiKeyRecord, type ApiKeyStore } from "../auth/apiKey.js";
import type { FixedWindowRateLimiter } from "../auth/rateLimit.js";

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export function sendError(res: Response, e: ApiError): void {
  res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details } });
}

declare module "express-serve-static-core" {
  interface Request {
    apiKey?: ApiKeyRecord;
    rawBody?: Buffer;
  }
}

export function requireApiKey(store: ApiKeyStore, limiter: FixedWindowRateLimiter, defaultLimit: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = extractApiKey({ authorization: req.header("authorization"), "x-api-key": req.header("x-api-key") });
    if (!key) return sendError(res, { status: 401, code: "unauthorized", message: "falta la API key (Authorization: Bearer <key> o X-API-Key)" });
    const record = await store.findByHash(hashApiKey(key));
    if (!record || !record.active) return sendError(res, { status: 403, code: "forbidden", message: "API key inválida o desactivada" });
    const rl = limiter.check(record.id, record.rateLimitPerMinute || defaultLimit);
    res.setHeader("X-RateLimit-Limit", String(rl.limit));
    res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
    res.setHeader("X-RateLimit-Reset", String(rl.resetAt));
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))));
      return sendError(res, { status: 429, code: "rate_limited", message: "límite por minuto excedido para esta API key" });
    }
    req.apiKey = record;
    void store.touch(record.id).catch(() => undefined);
    next();
  };
}
