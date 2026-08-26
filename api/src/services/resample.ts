/**
 * Resample PT15M -> PT60M (D5, modo "horario"). Promedio aritmético de los slots de cada hora UTC.
 * Filas ya horarias pasan tal cual. Una hora con menos slots de los esperados se promedia igual y se
 * marca con `slots` < 4 para que la interfaz pueda señalarlo.
 */
import type { PriceRow } from "../readers/types.js";

export interface HourlyRow extends PriceRow {
  slots: number; // slots nativos que entraron en el promedio
}

const SCALE = 4; // decimales de salida
const SCALE_IN = 8; // decimales con que se leen las entradas antes de promediar

function toHourStart(iso: string): string {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

function parseScaled(v: string): bigint {
  const neg = v.startsWith("-");
  const [ip, fp = ""] = v.replace("-", "").split(".");
  const scaled = BigInt(ip) * 10n ** BigInt(SCALE_IN) + BigInt((fp + "0".repeat(SCALE_IN)).slice(0, SCALE_IN));
  return neg ? -scaled : scaled;
}

function avg(values: string[]): string {
  // Enteros escalados para no acumular error binario; redondeo half away from zero a SCALE decimales.
  let sum = 0n;
  for (const v of values) sum += parseScaled(v);
  const den = BigInt(values.length) * 10n ** BigInt(SCALE_IN - SCALE);
  const neg = sum < 0n;
  const abs = neg ? -sum : sum;
  const rounded = (2n * abs + den) / (2n * den);
  const factor = 10n ** BigInt(SCALE);
  const int = rounded / factor;
  const frac = (rounded % factor).toString().padStart(SCALE, "0");
  return `${neg && rounded > 0n ? "-" : ""}${int}.${frac}`;
}

export function resampleHourly(rows: PriceRow[]): HourlyRow[] {
  const groups = new Map<string, PriceRow[]>();
  for (const r of rows) {
    const key = `${r.country_code}|${toHourStart(r.ts_utc)}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: HourlyRow[] = [];
  for (const [key, g] of groups) {
    const hour = key.split("|")[1];
    const first = g[0];
    if (g.length === 1 && first.resolution === "PT60M") {
      out.push({ ...first, ts_utc: hour, slots: 1 });
      continue;
    }
    out.push({
      ...first,
      ts_utc: hour,
      resolution: "PT60M",
      price_original: avg(g.map((r) => r.price_original)),
      price_eur: avg(g.map((r) => r.price_eur)),
      slots: g.length,
    });
  }
  out.sort((a, b) => (a.country_code < b.country_code ? -1 : a.country_code > b.country_code ? 1 : a.ts_utc < b.ts_utc ? -1 : a.ts_utc > b.ts_utc ? 1 : 0));
  return out;
}
