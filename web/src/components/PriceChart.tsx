import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDateTimeUtc, fmtDayUtc, fmtTimeUtc } from "../lib/dates";
import { fmtPrice, fmtTick, niceTicks, pointAt, scaleLinear, snapTime, stepPath, timeExtent, timeTicks, valueExtent, type Series } from "../lib/series";

interface Props {
  series: Series[];
  height?: number;
  unitLabel: string; // etiqueta del eje Y
  showLegend?: boolean; // false para un solo país (el título ya lo nombra)
  endLabels?: boolean;
  xDomain?: { min: number; max: number } | null; // para compartir eje X entre paneles
}

const M = { top: 26, right: 44, bottom: 30, left: 52 };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.max(280, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function PriceChart({ series, height = 360, unitLabel, showLegend = true, endLabels = true, xDomain }: Props) {
  const [wrapRef, width] = useWidth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ t: number; px: number; py: number } | null>(null);

  const visible = useMemo(() => series.filter((s) => !hidden.has(s.code)), [series, hidden]);
  const tx = xDomain ?? timeExtent(visible);
  const vy = valueExtent(visible);
  const plotW = width - M.left - M.right;
  const plotH = height - M.top - M.bottom;

  if (!tx || !vy || plotW < 50) {
    return <div className="chart" ref={wrapRef} style={{ minHeight: height }} />;
  }
  const yTicks = niceTicks(vy.min, vy.max);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const x = scaleLinear(tx.min, tx.max, M.left, M.left + plotW);
  const y = scaleLinear(yMin, yMax, M.top + plotH, M.top);
  const xTicks = timeTicks(tx.min, tx.max, plotW);
  const dayChanges = xTicks.filter((t, i) => i === 0 || fmtDayUtc(t) !== fmtDayUtc(xTicks[i - 1]));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const t = tx.min + ((px - M.left) / plotW) * (tx.max - tx.min);
    const snapped = snapTime(visible, t);
    if (snapped === null) return setHover(null);
    setHover({ t: snapped, px: x(snapped), py: ((e.clientY - rect.top) / rect.height) * height });
  };

  // Etiquetas al final de cada línea; si chocan, se omiten (leyenda + tooltip las cubren).
  const ends = endLabels
    ? visible
        .map((s) => {
          const last = s.points[s.points.length - 1];
          return last ? { code: s.code, yv: y(last.v), xv: x(last.end) } : null;
        })
        .filter((v): v is { code: string; yv: number; xv: number } => v !== null)
        .sort((a, b) => a.yv - b.yv)
        .filter((v, i, arr) => i === 0 || v.yv - arr[i - 1].yv >= 12)
    : [];

  const tooltipLeft = hover ? Math.min(Math.max(hover.px + 14, 0), width - 190) : 0;

  return (
    <div className="chart" ref={wrapRef}>
      {showLegend && (
        <div className="legend" role="group" aria-label="Series">
          {series.map((s) => (
            <button key={s.code} type="button" aria-pressed={!hidden.has(s.code)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.code)) n.delete(s.code); else n.add(s.code); return n; })}>
              <span className="key" style={{ background: s.color }} aria-hidden="true" />
              {s.name} <span style={{ color: "var(--muted)" }}>· {s.unit}</span>
            </button>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Precios day-ahead, ${unitLabel}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <g className="grid">
          {yTicks.map((v) => <line key={v} x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />)}
        </g>
        <line className="baseline" x1={M.left} x2={M.left + plotW} y1={y(Math.max(yMin, Math.min(0, yMax)))} y2={y(Math.max(yMin, Math.min(0, yMax)))} />
        <g className="axis">
          {yTicks.map((v) => <text key={v} x={M.left - 8} y={y(v) + 4} textAnchor="end">{fmtTick(v)}</text>)}
          <text x={M.left} y={M.top - 12} textAnchor="start" style={{ fontWeight: 600 }}>{unitLabel}</text>
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={M.top + plotH + 16} textAnchor="middle">{fmtTimeUtc(t)}</text>
          ))}
          {dayChanges.map((t) => (
            <text key={`d${t}`} x={x(t)} y={M.top + plotH + 28} textAnchor="middle" style={{ fontWeight: 600, fill: "var(--text-2)" }}>{fmtDayUtc(t)}</text>
          ))}
        </g>
        <g className="series">
          {visible.map((s) => <path key={s.code} d={stepPath(s.points, x, y)} style={{ stroke: s.color }} />)}
        </g>
        {ends.map((e) => (
          <text key={e.code} className="end-label" x={e.xv + 6} y={e.yv + 4}>{e.code}</text>
        ))}
        {hover && (
          <g>
            <line className="crosshair" x1={hover.px} x2={hover.px} y1={M.top} y2={M.top + plotH} />
            {visible.map((s) => {
              const p = pointAt(s.points, hover.t);
              return p ? <circle key={s.code} className="marker" cx={hover.px} cy={y(p.v)} r={4.5} style={{ fill: s.color }} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: tooltipLeft, top: Math.max(0, hover.py - 10) }}>
          <div className="when">{fmtDateTimeUtc(hover.t)}</div>
          {visible.map((s) => {
            const p = pointAt(s.points, hover.t);
            return (
              <div className="row" key={s.code}>
                <span className="key" style={{ background: s.color }} aria-hidden="true" />
                <span>{s.name}</span>
                <b>{p ? `${fmtPrice(p.v)} ${s.unit.replace("/MWh", "")}` : "—"}</b>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
