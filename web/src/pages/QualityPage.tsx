import { useEffect, useMemo, useState } from "react";
import { Banner, EmptyState } from "../components/StateView";
import { api, toRemoteError } from "../lib/api";
import { addDays, fmtDateTimeUtc, hoursSince, isoDate } from "../lib/dates";
import { COUNTRY_NAMES } from "../lib/series";
import { STATUS_LABEL, buildCoverage, fmtPct, gaps, summarize, type DayStatus } from "../lib/quality";
import type { CountryRow, LoadControlRow, Remote, StatusRow } from "../lib/types";

const DAYS_BACK = 30;
const ICON: Record<DayStatus, string> = { complete: "✓", incomplete: "△", pending: "…", error: "✕", missing: "·" };

export function QualityPage({ countries, status }: { countries: Remote<CountryRow[]>; status: Remote<StatusRow[]> }) {
  const today = isoDate(new Date());
  const from = addDays(today, -DAYS_BACK);
  const to = addDays(today, 1);
  const codes = useMemo(() => (countries.data ?? []).map((c) => c.country_code), [countries.data]);
  const [control, setControl] = useState<Remote<LoadControlRow[]>>({ status: "idle" });

  useEffect(() => {
    if (!codes.length) return;
    const ctrl = new AbortController();
    setControl((p) => ({ ...p, status: "loading" }));
    api
      .loadControl({ countries: codes, from, to }, ctrl.signal)
      .then((r) => setControl({ status: r.rows.length ? "ok" : "empty", data: r.rows }))
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        setControl((p) => toRemoteError(p, e));
      });
    return () => ctrl.abort();
  }, [codes, from, to]);

  const coverage = useMemo(() => buildCoverage(control.data ?? [], codes, from, to), [control.data, codes, from, to]);
  const summary = useMemo(() => summarize(status.data ?? [], coverage), [status.data, coverage]);
  const gapRows = useMemo(() => gaps(coverage), [coverage]);
  const days = coverage[0]?.cells.map((c) => c.day) ?? [];
  const now = Date.now();
  const refreshing = control.status === "loading" && !!control.data;
  const name = (cc: string) => (countries.data ?? []).find((c) => c.country_code === cc)?.name || COUNTRY_NAMES[cc] || cc;

  return (
    <main className="container">
      <div className="page-intro">
        <h2>Calidad de datos</h2>
        <p className="meta">Estado de carga por país y día de mercado según <code>load_control</code>: un día es completo solo cuando los slots cargados igualan los esperados para su calendario (96/92/100 o 24/23/25). Rango: {from} → {to} (D+1 incluido).</p>
      </div>

      {status.status === "forbidden" || control.status === "forbidden" ? <Banner kind="error">Sin permiso para leer la API: la credencial del servicio fue rechazada.</Banner> : null}
      {status.status === "error" && <Banner kind="error">No se pudo leer el estado por país: {status.error}</Banner>}
      {control.status === "error" && <Banner kind="error">No se pudo leer load_control: {control.error}</Banner>}
      {(status.status === "loading" || (control.status === "loading" && !control.data)) && <Banner kind="info">Cargando estado de carga…</Banner>}
      {control.status === "empty" && <EmptyState title="Sin registros de carga">La API respondió correctamente pero <code>load_control</code> no tiene filas en el rango. Todavía no corrió ninguna ingesta.</EmptyState>}

      {summary.length > 0 && control.data && (
        <>
          <section className={`tiles${refreshing ? " is-refreshing" : ""}`} aria-label="Resumen por país">
            {summary.map((s) => {
              const age = hoursSince(s.lastAttempt, now);
              return (
                <article className="tile" key={s.country_code}>
                  <div className="tile-head">
                    <h3>{name(s.country_code)}</h3>
                    <span className={`pill ${s.stale ? "pill-warn" : "pill-ok"}`}>
                      <span className="dot" aria-hidden="true" /> {s.stale ? "Desactualizado" : "Al día"}
                    </span>
                  </div>
                  <div className="tile-value">{fmtPct(s.coveragePct)}<span className="tile-sub"> de {s.daysInRange} días completos</span></div>
                  <dl className="tile-facts">
                    <div><dt>Último día completo</dt><dd>{s.lastCompleteDate ?? "—"}</dd></div>
                    <div><dt>Última corrida</dt><dd>{s.lastAttempt ? `${fmtDateTimeUtc(Date.parse(s.lastAttempt))}${age !== null ? ` (hace ${Math.round(age)} h)` : ""}` : "—"}</dd></div>
                    <div><dt>Días con atención</dt><dd>{s.attention}</dd></div>
                    <div><dt>run_id</dt><dd className="mono">{s.lastRunId ?? "—"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </section>

          <section className={`card${refreshing ? " is-refreshing" : ""}`} aria-busy={refreshing}>
            <div className="card-head">
              <h2>Cobertura por día</h2>
              <span className="meta">Cada celda: slots cargados / esperados. Pasa el cursor para el detalle.</span>
            </div>
            <div className="legend status-legend" aria-label="Leyenda de estados">
              {(["complete", "incomplete", "pending", "error", "missing"] as DayStatus[]).map((s) => (
                <span key={s} className={`cell-key st-${s}`}>{ICON[s]} {STATUS_LABEL[s]}</span>
              ))}
            </div>
            <div className="coverage-wrap">
              <table className="coverage">
                <thead>
                  <tr>
                    <th scope="col">País</th>
                    {days.map((d) => (
                      <th key={d} scope="col"><span className="day-label">{d.slice(8)}<small>{d.slice(5, 7)}</small></span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c) => (
                    <tr key={c.country_code}>
                      <th scope="row">{name(c.country_code)}</th>
                      {c.cells.map((cell) => {
                        const r = cell.row;
                        const title = r
                          ? `${cell.day} · ${STATUS_LABEL[cell.status]} · ${r.loaded_slots}/${r.expected_slots} slots · corrida ${r.run_id}${r.last_error ? ` · ${r.last_error}` : ""}`
                          : `${cell.day} · sin registro en load_control`;
                        return (
                          <td key={cell.day} className={`st-${cell.status}`} title={title}>
                            <span className="cell-icon" aria-hidden="true">{ICON[cell.status]}</span>
                            <span className="cell-num">{r ? `${r.loaded_slots}/${r.expected_slots}` : "—"}</span>
                            <span className="sr-only">{title}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`card${refreshing ? " is-refreshing" : ""}`}>
            <div className="card-head">
              <h2>Huecos y días pendientes</h2>
              <span className="meta">{gapRows.length === 0 ? "Ningún día del rango necesita atención." : `${gapRows.length} día(s) no completos, más recientes primero.`}</span>
            </div>
            {gapRows.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Día</th><th scope="col">País</th><th scope="col">Estado</th><th scope="col">Cargados</th><th scope="col">Esperados</th><th scope="col">Faltan</th><th scope="col">Fuente publicó</th><th scope="col">Último intento</th><th scope="col">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gapRows.map((g) => (
                      <tr key={`${g.country_code}-${g.day}`}>
                        <td>{g.day}</td>
                        <td>{name(g.country_code)}</td>
                        <td><span className={`cell-key st-${g.status}`}>{ICON[g.status]} {STATUS_LABEL[g.status]}</span></td>
                        <td>{g.loaded ?? "—"}</td>
                        <td>{g.expected ?? "—"}</td>
                        <td>{g.missingSlots ?? "—"}</td>
                        <td>{g.publishedAt ? fmtDateTimeUtc(Date.parse(g.publishedAt)) : "—"}</td>
                        <td>{g.lastAttempt ? fmtDateTimeUtc(Date.parse(g.lastAttempt)) : "—"}</td>
                        <td className="error-cell">{g.lastError ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
