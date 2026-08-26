import { describe, expect, it } from "vitest";
import type { PriceRow } from "../src/client.js";
import { addDays, compareHourly, describeLoad, markdownTable, statsByCountry } from "../src/summary.js";

function row(over: Partial<PriceRow>): PriceRow {
  return { country_code: "PL", ts_utc: "2026-08-24T22:00:00Z", resolution: "PT60M", business_date_local: "2026-08-25", price_original: "10", currency_original: "PLN", price_eur: "10", fx_rate: "4.3", fx_rate_date: "2026-08-25", source: "pse", source_published_at: null, ...over };
}

describe("resúmenes", () => {
  it("statsByCountry: media, extremos con instante, negativos, orden por país", () => {
    const rows = [row({ price_eur: "10" }), row({ ts_utc: "2026-08-24T23:00:00Z", price_eur: "-2" }), row({ ts_utc: "2026-08-25T00:00:00Z", price_eur: "31" }), row({ country_code: "DE", price_eur: "5", currency_original: "EUR" })];
    const s = statsByCountry(rows);
    expect(s.map((x) => x.country_code)).toEqual(["DE", "PL"]);
    expect(s[1]).toMatchObject({ count: 3, avg_eur: 13, min_eur: -2, min_at: "2026-08-24T23:00:00Z", max_eur: 31, max_at: "2026-08-25T00:00:00Z", negative_slots: 1, currency: "PLN" });
  });

  it("compareHourly: más barato, dispersión y horas ganadas", () => {
    const rows = [
      row({ country_code: "ES", ts_utc: "2026-08-24T22:00:00Z", price_eur: "100" }), row({ country_code: "PL", ts_utc: "2026-08-24T22:00:00Z", price_eur: "80" }),
      row({ country_code: "ES", ts_utc: "2026-08-24T23:00:00Z", price_eur: "50" }), row({ country_code: "PL", ts_utc: "2026-08-24T23:00:00Z", price_eur: "90" }),
      row({ country_code: "ES", ts_utc: "2026-08-25T00:00:00Z", price_eur: "70" }),
    ];
    const c = compareHourly(rows);
    expect(c.countries).toEqual(["ES", "PL"]);
    expect(c.hours.map((h) => [h.cheapest, h.spread])).toEqual([["PL", 20], ["ES", 40], [null, null]]);
    expect(c.cheapest_count).toEqual({ ES: 1, PL: 1 });
    expect(c.avg_spread).toBe(30);
    expect(c.avg_by_country).toEqual({ ES: 73.33, PL: 85 });
  });

  it("markdownTable y describeLoad", () => {
    expect(markdownTable(["a", "b"], [[1, null], ["x", 2.5]])).toBe("| a | b |\n| --- | --- |\n| 1 | — |\n| x | 2.5 |");
    const d = describeLoad(
      [{ country_code: "ES", last_complete_date: "2026-08-26", last_attempt_utc: "x", last_run_id: "r", pending_days: 1, incomplete_days: 0, error_days: 0, stale: false }],
      [
        { country_code: "ES", business_date_local: "2026-08-26", expected_slots: 96, loaded_slots: 96, status: "complete", source_published_at: null, last_attempt_utc: "x", last_success_utc: null, last_error: null, run_id: "r" },
        { country_code: "ES", business_date_local: "2026-08-27", expected_slots: 96, loaded_slots: 0, status: "pending", source_published_at: null, last_attempt_utc: "x", last_success_utc: null, last_error: null, run_id: "r" },
      ],
    );
    expect(d.per_country[0]).toMatchObject({ days_in_range: 2, complete_days: 1 });
    expect(d.attention.map((a) => a.business_date_local)).toEqual(["2026-08-27"]);
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });
});
