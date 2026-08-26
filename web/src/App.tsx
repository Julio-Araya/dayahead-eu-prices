import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { api, toRemoteError } from "./lib/api";
import type { CountryRow, Remote, StatusRow } from "./lib/types";
import { PricesPage } from "./pages/PricesPage";
import { QualityPage } from "./pages/QualityPage";

export default function App() {
  const [page, setPage] = useState<"prices" | "quality">("prices");
  const [countries, setCountries] = useState<Remote<CountryRow[]>>({ status: "loading" });
  const [status, setStatus] = useState<Remote<StatusRow[]>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    api.countries(ctrl.signal).then((r) => setCountries({ status: r.rows.length ? "ok" : "empty", data: r.rows })).catch((e) => setCountries((p) => toRemoteError(p, e)));
    api.status(ctrl.signal).then((r) => setStatus({ status: "ok", data: r.rows })).catch((e) => setStatus((p) => toRemoteError(p, e)));
    return () => ctrl.abort();
  }, []);

  return (
    <>
      <Header page={page} onNavigate={setPage} />
      {page === "prices" ? <PricesPage countries={countries} status={status} /> : <QualityPage countries={countries} status={status} />}
      <footer className="container footer">Fuente: ENTSO-E (ES, RO), SMARD (DE), PSE (PL); tipo de cambio BCE. Ingesta diaria a las 18:00 UTC desde Microsoft Fabric.</footer>
    </>
  );
}
