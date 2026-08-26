/** Lógica pura: resúmenes, comparación por hora y tablas en texto. Sin I/O, testeable. */
import type { LoadControlRow, PriceRow, StatusRow } from "./client.js";

export interface CountryStats {
  country_code: string;
  currency: string;
  resolution: string;
  count: number;
  avg_eur: number;
  min_eur: number;
  min_at: string;
  max_eur: number;
  max_at: string;
  negative_slots: number;
  first_ts: string;
  last_ts: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function statsByCountry(rows: PriceRow[]): CountryStats[] {
  const by = new Map<string, PriceRow[]>();
  for (const r of rows) (by.get(r.country_code) ?? by.set(r.country_code, []).get(r.country_code)!).push(r);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cc, list]) => {
      const sorted = [...list].sort((a, b) => a.ts_utc.localeCompare(b.ts_utc));
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      let minAt = "";
      let maxAt = "";
      let neg = 0;
      for (const r of sorted) {
        const v = Number(r.price_eur);
        sum += v;
        if (v < min) {
          min = v;
          minAt = r.ts_utc;
        }
        if (v > max) {
          max = v;
          maxAt = r.ts_utc;
        }
        if (v < 0) neg++;
      }
      return {
        country_code: cc,
        currency: sorted[0].currency_original,
        resolution: sorted[0].resolution,
        count: sorted.length,
        avg_eur: r2(sum / sorted.length),
        min_eur: r2(min),
        min_at: minAt,
        max_eur: r2(max),
        max_at: maxAt,
        negative_slots: neg,
        first_ts: sorted[0].ts_utc,
        last_ts: sorted[sorted.length - 1].ts_utc,
      };
    });
}

export interface HourlyComparison {
  hours: Array<{ ts_utc: string; prices: Record<string, number | null>; cheapest: string | null; spread: number | null }>;
  countries: string[];
  cheapest_count: Record<string, number>;
  avg_spread: number | null;
  avg_by_country: Record<string, number>;
}

/** Alinea filas horarias por instante y calcula el más barato y la dispersión (máx − mín) por hora. */
export function compareHourly(rows: PriceRow[]): HourlyComparison {
  const countries = [...new Set(rows.map((r) => r.country_code))].sort();
  const byTs = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = byTs.get(r.ts_utc) ?? {};
    m[r.country_code] = Number(r.price_eur);
    byTs.set(r.ts_utc, m);
  }
  const cheapest_count: Record<string, number> = Object.fromEntries(countries.map((c) => [c, 0]));
  const sums: Record<string, { s: number; n: number }> = Object.fromEntries(countries.map((c) => [c, { s: 0, n: 0 }]));
  let spreadSum = 0;
  let spreadN = 0;
  const hours = [...byTs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ts, m]) => {
      const prices: Record<string, number | null> = {};
      let minC: string | null = null;
      let minV = Infinity;
      let maxV = -Infinity;
      let present = 0;
      for (const c of countries) {
        const v = m[c];
        prices[c] = v === undefined ? null : r2(v);
        if (v === undefined) continue;
        present++;
        sums[c].s += v;
        sums[c].n++;
        if (v < minV) {
          minV = v;
          minC = c;
        }
        if (v > maxV) maxV = v;
      }
      const spread = present >= 2 ? r2(maxV - minV) : null;
      if (spread !== null) {
        spreadSum += spread;
        spreadN++;
      }
      if (minC && present >= 2) cheapest_count[minC]++;
      return { ts_utc: ts, prices, cheapest: present >= 2 ? minC : null, spread };
    });
  return {
    hours,
    countries,
    cheapest_count,
    avg_spread: spreadN ? r2(spreadSum / spreadN) : null,
    avg_by_country: Object.fromEntries(countries.map((c) => [c, sums[c].n ? r2(sums[c].s / sums[c].n) : NaN])),
  };
}

export function markdownTable(headers: string[], rows: Array<Array<string | number | null>>): string {
  const fmt = (v: string | number | null) => (v === null || v === undefined ? "—" : typeof v === "number" ? String(v) : v);
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(fmt).join(" | ")} |`)].join("\n");
}

export function describeLoad(status: StatusRow[], control: LoadControlRow[]): { per_country: Array<StatusRow & { days_in_range: number; complete_days: number }>; attention: LoadControlRow[] } {
  const per_country = status.map((s) => {
    const mine = control.filter((c) => c.country_code === s.country_code);
    return { ...s, days_in_range: mine.length, complete_days: mine.filter((c) => c.status === "complete").length };
  });
  const attention = control.filter((c) => c.status !== "complete").sort((a, b) => b.business_date_local.localeCompare(a.business_date_local) || a.country_code.localeCompare(b.country_code));
  return { per_country, attention };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
