/** Lógica pura de la página de calidad de datos: cobertura por país y día, resumen y huecos. */
import { addDays } from "./dates";
import type { LoadControlRow, StatusRow } from "./types";

export type DayStatus = LoadControlRow["status"] | "missing";

export const STATUS_LABEL: Record<DayStatus, string> = {
  complete: "Completo",
  incomplete: "Incompleto",
  pending: "Pendiente",
  error: "Error",
  missing: "Sin registro",
};

export interface CoverageCell {
  day: string;
  status: DayStatus;
  row: LoadControlRow | null;
}

export interface CoverageRow {
  country_code: string;
  cells: CoverageCell[];
  complete: number;
  incomplete: number;
  pending: number;
  error: number;
  missing: number;
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Matriz países × días. Un día sin fila en load_control es "missing": nunca se evaluó. */
export function buildCoverage(rows: LoadControlRow[], countries: string[], from: string, to: string): CoverageRow[] {
  const days = dayRange(from, to);
  const index = new Map<string, LoadControlRow>();
  for (const r of rows) index.set(`${r.country_code}|${r.business_date_local}`, r);
  return countries.map((cc) => {
    const cells = days.map((day) => {
      const row = index.get(`${cc}|${day}`) ?? null;
      return { day, status: row ? row.status : "missing", row } as CoverageCell;
    });
    const count = (s: DayStatus) => cells.filter((c) => c.status === s).length;
    return { country_code: cc, cells, complete: count("complete"), incomplete: count("incomplete"), pending: count("pending"), error: count("error"), missing: count("missing") };
  });
}

/** Días que necesitan atención: todo lo que no esté completo, con el hueco cuantificado. */
export interface GapRow {
  country_code: string;
  day: string;
  status: DayStatus;
  expected: number | null;
  loaded: number | null;
  missingSlots: number | null;
  lastError: string | null;
  lastAttempt: string | null;
  publishedAt: string | null;
  runId: string | null;
}

export function gaps(coverage: CoverageRow[], includeMissing = false): GapRow[] {
  const out: GapRow[] = [];
  for (const c of coverage) {
    for (const cell of c.cells) {
      if (cell.status === "complete") continue;
      if (cell.status === "missing" && !includeMissing) continue;
      const r = cell.row;
      out.push({
        country_code: c.country_code,
        day: cell.day,
        status: cell.status,
        expected: r?.expected_slots ?? null,
        loaded: r?.loaded_slots ?? null,
        missingSlots: r ? r.expected_slots - r.loaded_slots : null,
        lastError: r?.last_error ?? null,
        lastAttempt: r?.last_attempt_utc ?? null,
        publishedAt: r?.source_published_at ?? null,
        runId: r?.run_id ?? null,
      });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.country_code.localeCompare(b.country_code)));
}

export interface CountrySummary {
  country_code: string;
  lastCompleteDate: string | null;
  lastAttempt: string | null;
  lastRunId: string | null;
  stale: boolean;
  coveragePct: number; // % de días completos en el rango
  daysInRange: number;
  attention: number; // días no completos en el rango (sin contar "missing")
}

export function summarize(status: StatusRow[], coverage: CoverageRow[]): CountrySummary[] {
  const byCountry = new Map(status.map((s) => [s.country_code, s]));
  return coverage.map((c) => {
    const s = byCountry.get(c.country_code);
    const days = c.cells.length;
    return {
      country_code: c.country_code,
      lastCompleteDate: s?.last_complete_date ?? null,
      lastAttempt: s?.last_attempt_utc ?? null,
      lastRunId: s?.last_run_id ?? null,
      stale: s?.stale ?? true,
      coveragePct: days ? Math.round((c.complete / days) * 100) : 0,
      daysInRange: days,
      attention: c.incomplete + c.pending + c.error,
    };
  });
}

export function fmtPct(v: number): string {
  return `${v} %`;
}
