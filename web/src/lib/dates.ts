/** Fechas de negocio (YYYY-MM-DD) calculadas en UTC, que es como la API y Fabric definen el día de corrida. */

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export type PresetKey = "today" | "tomorrow" | "7d" | "30d" | "custom";

export interface DateRange {
  from: string;
  to: string;
}

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Hoy" },
  { key: "tomorrow", label: "Mañana" },
  { key: "7d", label: "Últimos 7 días" },
  { key: "30d", label: "Últimos 30 días" },
  { key: "custom", label: "Personalizado" },
];

export function presetRange(key: Exclude<PresetKey, "custom">, today: string): DateRange {
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
  }
}

export function isValidRange(r: DateRange): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.to) && r.from <= r.to;
}

const dtf = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayf = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "2-digit", month: "short" });
const timef = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });

export function fmtDateTimeUtc(ms: number): string {
  return `${dtf.format(new Date(ms))} UTC`;
}
export function fmtDayUtc(ms: number): string {
  return dayf.format(new Date(ms));
}
export function fmtTimeUtc(ms: number): string {
  return timef.format(new Date(ms));
}

export function hoursSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  return (nowMs - Date.parse(iso)) / 3_600_000;
}
