export function Header({ page, onNavigate }: { page: "prices" | "quality"; onNavigate: (p: "prices" | "quality") => void }) {
  return (
    <header className="header">
      <div className="container">
        <div>
          <p className="eyebrow">Mercados eléctricos europeos · Day-ahead</p>
          <h1 className="title">Day-Ahead Prices</h1>
          <p className="subtitle">Precios diarios de España, Rumania, Alemania y Polonia, en EUR/MWh y en su moneda original. Horas en UTC.</p>
        </div>
        <nav className="nav" aria-label="Secciones">
          <button type="button" aria-current={page === "prices" ? "page" : undefined} onClick={() => onNavigate("prices")}>Precios</button>
          <button type="button" aria-current={page === "quality" ? "page" : undefined} onClick={() => onNavigate("quality")}>Calidad de datos</button>
        </nav>
      </div>
    </header>
  );
}
