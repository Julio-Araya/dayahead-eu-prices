import { fmtDateTimeUtc } from "../lib/dates";
import { fmtPrice, tableRows, type Series } from "../lib/series";

export function DataTable({ series }: { series: Series[] }) {
  const rows = tableRows(series);
  return (
    <details className="table">
      <summary>Ver como tabla ({rows.length} filas)</summary>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Inicio del intervalo (UTC)</th>
              {series.map((s) => (
                <th key={s.code} scope="col">{s.name} · {s.unit}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t}>
                <td>{fmtDateTimeUtc(r.t)}</td>
                {r.values.map((v, i) => (
                  <td key={series[i].code}>{v === null ? "—" : fmtPrice(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
