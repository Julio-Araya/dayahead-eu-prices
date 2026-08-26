import { z } from "zod";
import type { PriceQuery, PriceReader, PriceRow } from "../readers/types.js";
import { resampleHourly, type HourlyRow } from "./resample.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD");

export const MAX_RANGE_DAYS = 366;

export const PricesQuery = z.object({
  countries: z
    .string()
    .min(2)
    .transform((s) => [...new Set(s.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean))])
    .refine((a) => a.length > 0 && a.length <= 20, "entre 1 y 20 países"),
  from: isoDate,
  to: isoDate,
  granularity: z.enum(["native", "hourly"]).default("native"),
}).refine((q) => q.from <= q.to, { message: "from debe ser <= to", path: ["from"] })
  .refine((q) => daysBetween(q.from, q.to) <= MAX_RANGE_DAYS, { message: `rango máximo ${MAX_RANGE_DAYS} días`, path: ["to"] });

export type PricesQueryT = z.infer<typeof PricesQuery>;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;
}

export interface PricesResponse {
  query: PricesQueryT;
  count: number;
  rows: Array<PriceRow | HourlyRow>;
}

export async function getPrices(reader: PriceReader, q: PricesQueryT): Promise<PricesResponse> {
  const rq: PriceQuery = { countries: q.countries, from: q.from, to: q.to };
  const native = await reader.getPrices(rq);
  const rows = q.granularity === "hourly" ? resampleHourly(native) : native;
  return { query: q, count: rows.length, rows };
}
