import { describe, expect, it } from "vitest";
import { MAX_RANGE_DAYS, PricesQuery, daysBetween } from "../src/services/prices.js";

describe("validación de /v1/prices", () => {
  it("normaliza países y aplica granularidad por defecto", () => {
    const q = PricesQuery.parse({ countries: "pl, es ,PL", from: "2026-08-20", to: "2026-08-25" });
    expect(q).toEqual({ countries: ["PL", "ES"], from: "2026-08-20", to: "2026-08-25", granularity: "native" });
  });

  it("rechaza rangos invertidos, fechas mal formadas, granularidad desconocida y rangos largos", () => {
    expect(PricesQuery.safeParse({ countries: "PL", from: "2026-08-26", to: "2026-08-25" }).success).toBe(false);
    expect(PricesQuery.safeParse({ countries: "PL", from: "26-08-2026", to: "2026-08-25" }).success).toBe(false);
    expect(PricesQuery.safeParse({ countries: "PL", from: "2026-08-25", to: "2026-08-25", granularity: "daily" }).success).toBe(false);
    expect(PricesQuery.safeParse({ countries: "", from: "2026-08-25", to: "2026-08-25" }).success).toBe(false);
    expect(PricesQuery.safeParse({ countries: "PL", from: "2025-01-01", to: "2026-08-25" }).success).toBe(false);
  });

  it("daysBetween es inclusivo", () => {
    expect(daysBetween("2026-08-25", "2026-08-25")).toBe(1);
    expect(daysBetween("2026-08-23", "2026-08-27")).toBe(5);
    expect(MAX_RANGE_DAYS).toBe(366);
  });
});
