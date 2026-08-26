import { useEffect, useMemo, useState } from "react";
import { DataTable } from "../components/DataTable";
import { Filters, type FiltersState } from "../components/Filters";
import { PriceChart } from "../components/PriceChart";
import { Banner, EmptyState } from "../components/StateView";
import { api, toRemoteError } from "../lib/api";
import { hoursSince, isValidRange, isoDate, presetRange, type PresetKey } from "../lib/dates";
import { buildSeries, timeExtent } from "../lib/series";
import type { CountryRow, PriceRow, Remote, StatusRow } from "../lib/types";

const today = isoDate(new Date());
const initial: FiltersState = { preset: "today", range: presetRange("today", today), countries: ["ES", "RO", "DE", "PL"], granularity: "native", currency: "eur" };

export function PricesPage({ countries, status }: { countries: Remote<CountryRow[]>; status: Remote<StatusRow[]> }) {
  const [filters, setFilters] = useState<FiltersState>(initial);
  const [prices, setPrices] = useState<Remote<PriceRow[]>>({ status: "idle" });

  const valid = isValidRange(filters.range) && filters.countries.length > 0;

  useEffect(() => {
    if (!valid) return;
    const ctrl = new AbortController();
    setPrices((p) => ({ ...p, status: "loading" }));
    api
      .prices({ countries: filters.countries, from: filters.range.from, to: filters.range.to, granularity: filters.granularity }, ctrl.signal)
      .then((r) => setPrices({ status: r.rows.length ? "ok" : "empty", data: r.rows }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setPrices((p) => toRemoteError(p, e));
      });
    return () => ctrl.abort();
  }, [filters.countries, filters.range.from, filters.range.to, filters.granularity, valid]);

  // La comparativa siempre en EUR: dos monedas sobre un mismo eje sería un doble eje encubierto.
  const seriesEur = useMemo(() => buildSeries(prices.data ?? [], "eur"), [prices.data]);
  const series = useMemo(() => (filters.currency === "eur" ? seriesEur : buildSeries(prices.data ?? [], "original")), [prices.data, filters.currency, seriesEur]);
  const xDomain = useMemo(() => timeExtent(seriesEur), [seriesEur]);
  const staleCountries = (status.data ?? []).filter((s) => s.stale && filters.countries.includes(s.country_code));
  const lastAttempt = (status.data ?? []).map((s) => s.last_attempt_utc).filter((v): v is string => !!v).sort().pop() ?? null;
  const ageH = hoursSince(lastAttempt, Date.now());
  const refreshing = prices.status === "loading" && !!prices.data;

  return (
    <main className="container">
      <Filters state={filters} available={countries.data ?? []} onChange={setFilters} presetRange={(k: Exclude<PresetKey, "custom">) => presetRange(k, today)} />

      {status.status === "ok" && staleCountries.length > 0 && (
        <Banner kind="warn">
          Datos desactualizados para {staleCountries.map((s) => s.country_code).join(", ")}: la última corrida fue hace {ageH ? Math.round(ageH) : "?"} h. Se muestran igual.
        </Banner>
      )}
      {!valid && <Banner kind="muted">Elige al menos un país y un rango de fechas válido (desde ≤ hasta).</Banner>}
      {prices.status === "forbidden" && <Banner kind="error">Sin permiso para leer la API: la credencial del servicio fue rechazada. Avisa a quien administra las API keys.</Banner>}
      {prices.status === "error" && <Banner kind="error">No se pudieron cargar los precios: {prices.error}. Reintenta cambiando un filtro.</Banner>}
      {prices.status === "loading" && !prices.data && <Banner kind="info">Cargando precios…</Banner>}
      {prices.status === "empty" && (
        <EmptyState title="Sin datos para este rango">
          La API respondió correctamente pero no hay filas para {filters.countries.join(", ")} entre {filters.range.from} y {filters.range.to}. Si es el día D+1, la fuente puede no haber publicado todavía.
        </EmptyState>
      )}

      {seriesEur.length > 0 && (
        <>
          <section className={`card${refreshing ? " is-refreshing" : ""}`} aria-busy={refreshing}>
            <div className="card-head">
              <h2>Comparativa entre países</h2>
              <span className="meta">
                {filters.granularity === "hourly" ? "Horaria (PT15M promediado a PT60M)" : "Resolución nativa (ES, RO, PL cada 15 min · DE cada hora)"} · siempre en EUR
                {filters.currency === "original" ? " (la moneda original se ve en los paneles y la tabla)" : ""}
              </span>
            </div>
            <PriceChart series={seriesEur} unitLabel="EUR/MWh" height={380} />
            <DataTable series={series} />
          </section>

          <section className={`panels${refreshing ? " is-refreshing" : ""}`} aria-label="Precios por país">
            {series.map((s) => (
              <article className="card" key={s.code}>
                <div className="card-head">
                  <h3>{s.name}</h3>
                  <span className="meta">{s.unit} · {s.points.length} valores</span>
                </div>
                <PriceChart series={[s]} unitLabel={s.unit} height={220} showLegend={false} endLabels={false} xDomain={xDomain} />
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
