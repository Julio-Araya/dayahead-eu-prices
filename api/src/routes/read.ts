import { Router } from "express";
import type { Request, Response } from "express";
import type { PriceReader } from "../readers/types.js";
import { PricesQuery, getPrices } from "../services/prices.js";
import { sendError } from "./middleware.js";

const STALE_AFTER_HOURS = 26; // una corrida diaria a las 16:00 UTC; más de 26 h sin intento = desactualizado

export function readRouter(reader: PriceReader): Router {
  const r = Router();

  r.get("/countries", async (_req: Request, res: Response) => {
    const rows = await reader.getCountries();
    res.json({ count: rows.length, rows });
  });

  r.get("/prices", async (req: Request, res: Response) => {
    const parsed = PricesQuery.safeParse(req.query);
    if (!parsed.success) return sendError(res, { status: 400, code: "bad_query", message: "parámetros inválidos", details: parsed.error.issues });
    res.json(await getPrices(reader, parsed.data));
  });

  r.get("/load-control", async (req: Request, res: Response) => {
    const parsed = PricesQuery.safeParse({ ...req.query, granularity: "native" });
    if (!parsed.success) return sendError(res, { status: 400, code: "bad_query", message: "parámetros inválidos", details: parsed.error.issues });
    const rows = await reader.getLoadControl({ countries: parsed.data.countries, from: parsed.data.from, to: parsed.data.to });
    res.json({ count: rows.length, rows });
  });

  r.get("/status", async (_req: Request, res: Response) => {
    const rows = await reader.getStatus();
    const now = Date.now();
    res.json({
      reader: reader.kind,
      generated_at: new Date(now).toISOString(),
      rows: rows.map((s) => ({
        ...s,
        stale: s.last_attempt_utc ? now - Date.parse(s.last_attempt_utc) > STALE_AFTER_HOURS * 3_600_000 : true,
      })),
    });
  });

  return r;
}
