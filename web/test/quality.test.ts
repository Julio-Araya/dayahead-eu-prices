import { describe, expect, it } from "vitest";
import { buildCoverage, dayRange, gaps, summarize } from "../src/lib/quality";
import type { LoadControlRow, StatusRow } from "../src/lib/types";

function lc(over: Partial<LoadControlRow>): LoadControlRow {
  return { country_code: "ES", business_date_local: "2026-08-25", expected_slots: 96, loaded_slots: 96, status: "complete", source_published_at: null, last_attempt_utc: "2026-08-26T18:00:00Z", last_success_utc: null, last_error: null, run_id: "r1", ...over };
}

describe("calidad de datos", () => {
  it("dayRange inclusivo", () => {
    expect(dayRange("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });

  it("buildCoverage marca missing donde no hay fila y cuenta estados", () => {
    const rows = [lc({}), lc({ business_date_local: "2026-08-26", status: "pending", loaded_slots: 0 }), lc({ country_code: "DE", expected_slots: 24, loaded_slots: 23, status: "incomplete" })];
    const cov = buildCoverage(rows, ["ES", "DE"], "2026-08-25", "2026-08-27");
    expect(cov[0].cells.map((c) => c.status)).toEqual(["complete", "pending", "missing"]);
    expect(cov[0]).toMatchObject({ complete: 1, pending: 1, missing: 1, incomplete: 0, error: 0 });
    expect(cov[1].cells.map((c) => c.status)).toEqual(["incomplete", "missing", "missing"]);
  });

  it("gaps lista lo no completo, más reciente primero, con el hueco cuantificado", () => {
    const rows = [lc({}), lc({ business_date_local: "2026-08-26", status: "error", loaded_slots: 40, last_error: "HTTP 500" }), lc({ country_code: "DE", expected_slots: 24, loaded_slots: 23, status: "incomplete" })];
    const g = gaps(buildCoverage(rows, ["ES", "DE"], "2026-08-25", "2026-08-26"));
    expect(g.map((r) => [r.country_code, r.day, r.status, r.missingSlots])).toEqual([["ES", "2026-08-26", "error", 56], ["DE", "2026-08-25", "incomplete", 1]]);
    expect(g[0].lastError).toBe("HTTP 500");
    expect(gaps(buildCoverage(rows, ["ES", "DE"], "2026-08-25", "2026-08-26"), true)).toHaveLength(3);
  });

  it("summarize cruza status con cobertura", () => {
    const status: StatusRow[] = [{ country_code: "ES", last_complete_date: "2026-08-26", last_attempt_utc: "2026-08-26T18:00:00Z", last_run_id: "r1", pending_days: 0, incomplete_days: 0, error_days: 0, stale: false }];
    const cov = buildCoverage([lc({}), lc({ business_date_local: "2026-08-26", status: "pending", loaded_slots: 0 })], ["ES", "DE"], "2026-08-25", "2026-08-26");
    const s = summarize(status, cov);
    expect(s[0]).toMatchObject({ country_code: "ES", coveragePct: 50, daysInRange: 2, attention: 1, stale: false, lastCompleteDate: "2026-08-26" });
    expect(s[1]).toMatchObject({ country_code: "DE", coveragePct: 0, attention: 0, stale: true, lastCompleteDate: null });
  });
});
