import { describe, expect, it } from "vitest";
import { buildSeries, niceTicks, pointAt, resolutionMs, scaleLinear, snapTime, stepPath, tableRows, timeExtent, timeTicks, valueExtent } from "../src/lib/series";
import type { PriceRow } from "../src/lib/types";

function row(over: Partial<PriceRow>): PriceRow {
  return {
    country_code: "PL", ts_utc: "2026-08-24T22:00:00Z", resolution: "PT15M", business_date_local: "2026-08-25",
    price_original: "689.72", currency_original: "PLN", price_eur: "160.1951", fx_rate: "4.3055", fx_rate_date: "2026-08-25",
    source: "pse", source_published_at: null, ...over,
  };
}

describe("series", () => {
  it("resolutionMs", () => {
    expect(resolutionMs("PT15M")).toBe(900_000);
    expect(resolutionMs("PT60M")).toBe(3_600_000);
    expect(resolutionMs("PT1H")).toBe(3_600_000);
  });

  it("buildSeries agrupa por país, ordena, y elige EUR u original", () => {
    const rows = [row({ ts_utc: "2026-08-24T22:15:00Z", price_eur: "1" }), row({ ts_utc: "2026-08-24T22:00:00Z", price_eur: "2" }), row({ country_code: "DE", resolution: "PT60M", currency_original: "EUR", price_original: "152.34", price_eur: "152.34" })];
    const eur = buildSeries(rows, "eur");
    expect(eur.map((s) => s.code)).toEqual(["DE", "PL"]);
    expect(eur[1].points.map((p) => p.v)).toEqual([2, 1]);
    expect(eur[1].points[0].end - eur[1].points[0].t).toBe(900_000);
    expect(eur[0].unit).toBe("EUR/MWh");
    const orig = buildSeries(rows, "original");
    expect(orig[1].unit).toBe("PLN/MWh");
    expect(orig[1].points[0].v).toBe(689.72);
    expect(orig[0].unit).toBe("EUR/MWh");
  });

  it("extents", () => {
    const s = buildSeries([row({ price_eur: "10" }), row({ ts_utc: "2026-08-24T22:15:00Z", price_eur: "-5" })], "eur");
    expect(timeExtent(s)).toEqual({ min: Date.parse("2026-08-24T22:00:00Z"), max: Date.parse("2026-08-24T22:30:00Z") });
    expect(valueExtent(s)).toEqual({ min: -5, max: 10 });
    expect(valueExtent(buildSeries([row({ price_eur: "50" })], "eur"))).toEqual({ min: 0, max: 50 });
    expect(timeExtent([])).toBeNull();
  });

  it("niceTicks cubre el rango con pasos 1-2-5", () => {
    expect(niceTicks(0, 173)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(-12, 40)).toEqual([-20, 0, 20, 40]);
    expect(niceTicks(0, 0.7)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
  });

  it("timeTicks alineados a horas redondas", () => {
    const min = Date.parse("2026-08-24T22:00:00Z");
    const ticks = timeTicks(min, min + 24 * 3_600_000, 900);
    expect(ticks.length).toBeGreaterThan(4);
    expect(ticks.every((t) => t % 3_600_000 === 0)).toBe(true);
    expect(timeTicks(min, min + 30 * 86_400_000, 900).every((t) => t % 86_400_000 === 0)).toBe(true);
  });

  it("stepPath dibuja escalones y corta en huecos", () => {
    const x = scaleLinear(0, 4, 0, 400);
    const y = scaleLinear(0, 10, 100, 0);
    const pts = [{ t: 0, end: 1, v: 5 }, { t: 1, end: 2, v: 10 }, { t: 3, end: 4, v: 0 }];
    expect(stepPath(pts, x, y)).toBe("M0.0,50.0H100.0V0.0H200.0M300.0,100.0H400.0");
  });

  it("pointAt y snapTime", () => {
    const pts = [{ t: 0, end: 10, v: 1 }, { t: 10, end: 20, v: 2 }, { t: 30, end: 40, v: 3 }];
    expect(pointAt(pts, 5)?.v).toBe(1);
    expect(pointAt(pts, 10)?.v).toBe(2);
    expect(pointAt(pts, 25)).toBeNull();
    expect(pointAt(pts, 40)).toBeNull();
    const s = [{ code: "A", name: "A", color: "", unit: "", points: pts }];
    expect(snapTime(s, 12)).toBe(10);
    expect(snapTime(s, 27)).toBe(30);
    expect(snapTime([], 1)).toBeNull();
  });

  it("tableRows une instantes y deja null donde no hay valor", () => {
    const s = buildSeries([row({ price_eur: "1" }), row({ country_code: "DE", resolution: "PT60M", price_eur: "2", currency_original: "EUR" }), row({ ts_utc: "2026-08-24T22:15:00Z", price_eur: "3" })], "eur");
    const rows = tableRows(s);
    expect(rows.map((r) => r.values)).toEqual([[2, 1], [2, 3]]);
  });
});
