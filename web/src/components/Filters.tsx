import { PRESETS, type DateRange, type PresetKey } from "../lib/dates";
import { COUNTRY_NAMES, SERIES_COLORS } from "../lib/series";
import type { CountryRow, Currency, Granularity } from "../lib/types";

export interface FiltersState {
  preset: PresetKey;
  range: DateRange;
  countries: string[];
  granularity: Granularity;
  currency: Currency;
}

interface Props {
  state: FiltersState;
  available: CountryRow[];
  onChange: (next: FiltersState) => void;
  presetRange: (key: Exclude<PresetKey, "custom">) => DateRange;
}

export function Filters({ state, available, onChange, presetRange }: Props) {
  const toggleCountry = (code: string) => {
    const has = state.countries.includes(code);
    const next = has ? state.countries.filter((c) => c !== code) : [...state.countries, code];
    onChange({ ...state, countries: next });
  };
  const setPreset = (key: PresetKey) => {
    if (key === "custom") onChange({ ...state, preset: key });
    else onChange({ ...state, preset: key, range: presetRange(key) });
  };
  const setRange = (patch: Partial<DateRange>) => onChange({ ...state, preset: "custom", range: { ...state.range, ...patch } });

  return (
    <div className="filters" role="region" aria-label="Filtros">
      <div className="filter">
        <span className="filter-label">Fechas (día de mercado)</span>
        <div className="chips" role="group" aria-label="Rango de fechas">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className="chip" aria-pressed={state.preset === p.key} onClick={() => setPreset(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter">
        <span className="filter-label">Desde / hasta</span>
        <div className="dates">
          <input type="date" aria-label="Desde" value={state.range.from} max={state.range.to} onChange={(e) => setRange({ from: e.target.value })} />
          <span aria-hidden="true">→</span>
          <input type="date" aria-label="Hasta" value={state.range.to} min={state.range.from} onChange={(e) => setRange({ to: e.target.value })} />
        </div>
      </div>
      <div className="filter">
        <span className="filter-label">Países</span>
        <div className="chips" role="group" aria-label="Países">
          {available.map((c) => (
            <button key={c.country_code} type="button" className="chip" aria-pressed={state.countries.includes(c.country_code)} onClick={() => toggleCountry(c.country_code)}>
              <span className="swatch" style={{ background: SERIES_COLORS[c.country_code] ?? "var(--ink)" }} aria-hidden="true" />
              {c.name || COUNTRY_NAMES[c.country_code] || c.country_code}
            </button>
          ))}
        </div>
      </div>
      <div className="filter">
        <span className="filter-label">Granularidad</span>
        <div className="segmented" role="group" aria-label="Granularidad">
          <button type="button" aria-pressed={state.granularity === "native"} onClick={() => onChange({ ...state, granularity: "native" })}>Nativa</button>
          <button type="button" aria-pressed={state.granularity === "hourly"} onClick={() => onChange({ ...state, granularity: "hourly" })}>Horaria</button>
        </div>
      </div>
      <div className="filter">
        <span className="filter-label">Moneda</span>
        <div className="segmented" role="group" aria-label="Moneda">
          <button type="button" aria-pressed={state.currency === "eur"} onClick={() => onChange({ ...state, currency: "eur" })}>EUR</button>
          <button type="button" aria-pressed={state.currency === "original"} onClick={() => onChange({ ...state, currency: "original" })}>Original (PLN)</button>
        </div>
      </div>
    </div>
  );
}
