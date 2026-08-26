/** Lógica pura de la gráfica: series por país, escalas, ticks, path escalonado y búsqueda del punto bajo el cursor. */
import type { Currency, PriceRow } from "./types";

export interface Point {
  t: number; // inicio del intervalo, ms UTC
  end: number; // fin del intervalo, ms UTC
  v: number;
  slots?: number;
}

export interface Series {
  code: string;
  name: string;
  color: string;
  unit: string; // EUR/MWh | PLN/MWh
  points: Point[];
}

export const SERIES_COLORS: Record<string, string> = {
  ES: "var(--series-es)",
  RO: "var(--series-ro)",
  DE: "var(--series-de)",
  PL: "var(--series-pl)",
};

export const COUNTRY_NAMES: Record<string, string> = { ES: "España", RO: "Rumania", DE: "Alemania", PL: "Polonia" };

export function resolutionMs(res: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(res);
  if (!m) return 3_600_000;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) || 60) * 60_000;
}

export function buildSeries(rows: PriceRow[], currency: Currency, names: Record<string, string> = COUNTRY_NAMES): Series[] {
  const by = new Map<string, Series>();
  for (const r of rows) {
    const useOriginal = currency === "original";
    const unit = useOriginal ? `${r.currency_original}/MWh` : "EUR/MWh";
    let s = by.get(r.country_code);
    if (!s) {
      s = { code: r.country_code, name: names[r.country_code] ?? r.country_code, color: SERIES_COLORS[r.country_code] ?? "var(--ink)", unit, points: [] };
      by.set(r.country_code, s);
    }
    const t = Date.parse(r.ts_utc);
    s.points.push({ t, end: t + resolutionMs(r.resolution), v: Number(useOriginal ? r.price_original : r.price_eur), slots: r.slots });
  }
  const out = [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const s of out) s.points.sort((a, b) => a.t - b.t);
  return out;
}

export interface Extent {
  min: number;
  max: number;
}

export function timeExtent(series: Series[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) for (const p of s.points) {
    if (p.t < min) min = p.t;
    if (p.end > max) max = p.end;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

export function valueExtent(series: Series[]): Extent | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) for (const p of s.points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  if (!Number.isFinite(min)) return null;
  if (min > 0) min = 0; // los precios se leen desde cero; los negativos extienden el eje hacia abajo
  if (min === max) max = min + 1;
  return { min, max };
}

/** Ticks "bonitos" (1-2-5 × 10^n) que cubren [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min || 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Ticks temporales: cada N horas según el rango, alineados a horas UTC redondas. */
export function timeTicks(min: number, max: number, width: number): number[] {
  const hours = (max - min) / 3_600_000;
  const perTick = Math.max(1, hours / Math.max(2, Math.floor(width / 90)));
  const stepH = [1, 2, 3, 6, 12, 24, 48, 168].find((s) => s >= perTick) ?? 168;
  const step = stepH * 3_600_000;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) out.push(t);
  return out;
}

export function scaleLinear(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): (v: number) => number {
  const d = domainMax - domainMin || 1;
  return (v) => rangeMin + ((v - domainMin) / d) * (rangeMax - rangeMin);
}

/** Path escalonado: cada precio es constante durante su intervalo. Corta la línea donde hay huecos. */
export function stepPath(points: Point[], x: (t: number) => number, y: (v: number) => number): string {
  let d = "";
  let prevEnd: number | null = null;
  for (const p of points) {
    const x0 = x(p.t).toFixed(1);
    const x1 = x(p.end).toFixed(1);
    const yy = y(p.v).toFixed(1);
    if (prevEnd === null || p.t > prevEnd) d += `M${x0},${yy}H${x1}`;
    else d += `V${yy}H${x1}`;
    prevEnd = p.end;
  }
  return d;
}

/** Punto cuyo intervalo contiene t (búsqueda binaria); null si cae en un hueco. */
export function pointAt(points: Point[], t: number): Point | null {
  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = points[mid];
    if (t < p.t) hi = mid - 1;
    else if (t >= p.end) lo = mid + 1;
    else return p;
  }
  return null;
}

/** Instante "ancla" del cursor: el inicio de intervalo más cercano entre todas las series (el crosshair se imanta). */
export function snapTime(series: Series[], t: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const s of series) {
    const p = pointAt(s.points, t) ?? nearestPoint(s.points, t);
    if (!p) continue;
    const d = Math.abs(p.t - t);
    if (d < bestD) {
      bestD = d;
      best = p.t;
    }
  }
  return best;
}

function nearestPoint(points: Point[], t: number): Point | null {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[lo - 1];
  if (!b) return a;
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b;
}

const nf2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });

export function fmtPrice(v: number): string {
  return nf2.format(v);
}
export function fmtTick(v: number): string {
  return Math.abs(v) >= 100 || Number.isInteger(v) ? nf0.format(v) : nf2.format(v);
}

/** Filas para la tabla: una por instante, una columna por serie. */
export function tableRows(series: Series[]): Array<{ t: number; values: Array<number | null> }> {
  const times = new Set<number>();
  for (const s of series) for (const p of s.points) times.add(p.t);
  return [...times].sort((a, b) => a - b).map((t) => ({ t, values: series.map((s) => pointAt(s.points, t)?.v ?? null) }));
}
