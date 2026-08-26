import { describe, expect, it } from "vitest";
import { resampleHourly } from "../src/services/resample.js";
import { price } from "./helpers.js";

describe("resample PT15M -> PT60M", () => {
  it("promedia los cuatro cuartos de cada hora con redondeo half-up a 4 decimales", () => {
    const rows = ["1.00", "2.00", "3.00", "4.00005"].map((p, i) => price({ ts_utc: `2026-08-24T22:${String(15 * i).padStart(2, "0")}:00Z`, price_eur: p, price_original: p }));
    const out = resampleHourly(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ts_utc: "2026-08-24T22:00:00Z", resolution: "PT60M", slots: 4, price_eur: "2.5000", price_original: "2.5000" });
  });

  it("mantiene las filas horarias tal cual y separa por país", () => {
    const rows = [
      price({ country_code: "DE", resolution: "PT60M", ts_utc: "2026-08-24T22:00:00Z", price_eur: "152.34" }),
      price({ country_code: "PL", ts_utc: "2026-08-24T22:00:00Z", price_eur: "10" }),
      price({ country_code: "PL", ts_utc: "2026-08-24T22:15:00Z", price_eur: "20" }),
    ];
    const out = resampleHourly(rows);
    expect(out.map((r) => [r.country_code, r.price_eur, r.slots])).toEqual([["DE", "152.34", 1], ["PL", "15.0000", 2]]);
  });

  it("maneja negativos y redondeo", () => {
    const rows = ["-1.5", "-2.5", "0", "0.0001"].map((p, i) => price({ ts_utc: `2026-08-24T22:${String(15 * i).padStart(2, "0")}:00Z`, price_eur: p, price_original: p }));
    expect(resampleHourly(rows)[0].price_eur).toBe("-1.0000");
    const two = ["0.00005", "0.00005"].map((p, i) => price({ ts_utc: `2026-08-24T22:${String(15 * i).padStart(2, "0")}:00Z`, price_eur: p, price_original: p }));
    expect(resampleHourly(two)[0].price_eur).toBe("0.0001");
  });

  it("ordena por país y hora", () => {
    const rows = [price({ country_code: "PL", ts_utc: "2026-08-24T23:00:00Z" }), price({ country_code: "ES", ts_utc: "2026-08-24T22:00:00Z" }), price({ country_code: "PL", ts_utc: "2026-08-24T22:00:00Z" })];
    expect(resampleHourly(rows).map((r) => `${r.country_code} ${r.ts_utc}`)).toEqual(["ES 2026-08-24T22:00:00Z", "PL 2026-08-24T22:00:00Z", "PL 2026-08-24T23:00:00Z"]);
  });
});
