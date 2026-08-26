import { describe, expect, it } from "vitest";
import { addDays, hoursSince, isValidRange, presetRange } from "../src/lib/dates";

describe("dates", () => {
  it("presets desde una fecha UTC", () => {
    expect(presetRange("today", "2026-08-26")).toEqual({ from: "2026-08-26", to: "2026-08-26" });
    expect(presetRange("tomorrow", "2026-08-26")).toEqual({ from: "2026-08-27", to: "2026-08-27" });
    expect(presetRange("7d", "2026-08-26")).toEqual({ from: "2026-08-20", to: "2026-08-26" });
    expect(presetRange("30d", "2026-03-02")).toEqual({ from: "2026-02-01", to: "2026-03-02" });
  });
  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("isValidRange", () => {
    expect(isValidRange({ from: "2026-08-01", to: "2026-08-02" })).toBe(true);
    expect(isValidRange({ from: "2026-08-03", to: "2026-08-02" })).toBe(false);
    expect(isValidRange({ from: "x", to: "2026-08-02" })).toBe(false);
  });
  it("hoursSince", () => {
    expect(hoursSince("2026-08-26T10:00:00Z", Date.parse("2026-08-26T12:00:00Z"))).toBe(2);
    expect(hoursSince(null, 0)).toBeNull();
  });
});
