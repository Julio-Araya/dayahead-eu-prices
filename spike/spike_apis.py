"""
Spike de APIs. Fase 0 del BRIEF.

Golpea las cuatro fuentes y el BCE con datos reales y reporta lo que encuentra.
No escribe en ninguna base. Solo imprime y guarda las respuestas crudas en /spike/raw
para poder mirarlas después.

Uso:
    pip install requests python-dateutil
    export ENTSOE_TOKEN=...            (nunca en el repo)
    python spike/spike_apis.py [YYYY-MM-DD]

Si no se pasa fecha usa ayer en UTC.
"""

from __future__ import annotations

import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

RAW_DIR = Path(__file__).parent / "raw"
RAW_DIR.mkdir(exist_ok=True)

TIMEOUT = 60
HEADERS = {"User-Agent": "dayahead-spike/0.1"}


def save_raw(name: str, content: bytes | str) -> None:
    mode = "wb" if isinstance(content, bytes) else "w"
    with open(RAW_DIR / name, mode) as f:
        f.write(content)


def section(title: str) -> None:
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


# ---------------------------------------------------------------------------
# ENTSO-E (España y Rumania)
# ---------------------------------------------------------------------------

ENTSOE_URL = "https://web-api.tp.entsoe.eu/api"
ENTSOE_DOMAINS = {
    "ES": "10YES-REE------0",
    "RO": "10YRO-TEL------P",
}


def entsoe_fetch(country: str, day: date, token: str) -> None:
    section(f"ENTSO-E {country} {day}")
    domain = ENTSOE_DOMAINS[country]
    # Ventana en UTC. Pedimos un poco más de un día para ver si vienen varios Period.
    start = datetime(day.year, day.month, day.day, 0, 0, tzinfo=timezone.utc) - timedelta(hours=2)
    end = start + timedelta(hours=28)
    params = {
        "documentType": "A44",
        "in_Domain": domain,
        "out_Domain": domain,
        "periodStart": start.strftime("%Y%m%d%H%M"),
        "periodEnd": end.strftime("%Y%m%d%H%M"),
        "securityToken": token,
    }
    r = requests.get(ENTSOE_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
    print("status:", r.status_code, "bytes:", len(r.content))
    save_raw(f"entsoe_{country}_{day}.xml", r.content)
    if r.status_code != 200:
        print(r.text[:500])
        return

    root = ET.fromstring(r.content)
    ns = {"ns": root.tag.split("}")[0].strip("{")}
    print("root tag:", root.tag)

    # Acknowledgement significa error de negocio (sin datos, token malo, etc.)
    if "Acknowledgement" in root.tag:
        reason = root.find(".//ns:Reason/ns:text", ns)
        print("ACK:", reason.text if reason is not None else "sin texto")
        return

    ts_list = root.findall("ns:TimeSeries", ns)
    print("TimeSeries encontrados:", len(ts_list))
    for i, ts in enumerate(ts_list):
        curve = ts.findtext("ns:curveType", default="?", namespaces=ns)
        unit = ts.findtext("ns:currency_Unit.name", default="?", namespaces=ns)
        measure = ts.findtext("ns:price_Measure_Unit.name", default="?", namespaces=ns)
        periods = ts.findall("ns:Period", ns)
        print(f"  TS[{i}] curveType={curve} moneda={unit} unidad={measure} periods={len(periods)}")
        for j, p in enumerate(periods):
            res = p.findtext("ns:resolution", namespaces=ns)
            t0 = p.findtext("ns:timeInterval/ns:start", namespaces=ns)
            t1 = p.findtext("ns:timeInterval/ns:end", namespaces=ns)
            points = p.findall("ns:Point", ns)
            positions = [int(pt.findtext("ns:position", namespaces=ns)) for pt in points]
            expected = _expected_points(t0, t1, res)
            missing = sorted(set(range(1, expected + 1)) - set(positions))
            print(f"    Period[{j}] res={res} {t0} -> {t1} puntos={len(points)} esperados={expected}")
            if missing:
                print(f"      posiciones ausentes ({len(missing)}): {missing[:20]}{' ...' if len(missing) > 20 else ''}")
                print("      => confirmar si es curveType A03 (forward fill) o hueco real")
            first = points[0]
            print(f"      primer punto: pos={first.findtext('ns:position', namespaces=ns)} price={first.findtext('ns:price.amount', namespaces=ns)}")


def _expected_points(t0: str, t1: str, res: str) -> int:
    fmt = "%Y-%m-%dT%H:%MZ"
    a = datetime.strptime(t0, fmt)
    b = datetime.strptime(t1, fmt)
    minutes = {"PT15M": 15, "PT30M": 30, "PT60M": 60}[res]
    return int((b - a).total_seconds() // 60 // minutes)


# ---------------------------------------------------------------------------
# SMARD (Alemania)
# ---------------------------------------------------------------------------

SMARD_INDEX = "https://www.smard.de/app/chart_data/4169/DE/index_hour.json"
SMARD_BLOCK = "https://www.smard.de/app/chart_data/4169/DE/4169_DE_hour_{ts}.json"


def smard_fetch(day: date) -> None:
    section(f"SMARD DE {day}")
    r = requests.get(SMARD_INDEX, headers=HEADERS, timeout=TIMEOUT)
    print("index status:", r.status_code)
    save_raw("smard_index.json", r.content)
    idx = r.json()
    print("claves del índice:", list(idx.keys()))
    timestamps = idx["timestamps"]
    print("bloques:", len(timestamps), "primero:", _ms(timestamps[0]), "último:", _ms(timestamps[-1]))

    day_start_ms = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)
    candidates = [t for t in timestamps if t <= day_start_ms]
    if not candidates:
        print("no hay bloque que cubra la fecha")
        return
    block_ts = max(candidates)
    print("bloque elegido:", block_ts, _ms(block_ts))

    r = requests.get(SMARD_BLOCK.format(ts=block_ts), headers=HEADERS, timeout=TIMEOUT)
    print("block status:", r.status_code, "bytes:", len(r.content))
    save_raw(f"smard_block_{block_ts}.json", r.content)
    block = r.json()
    print("claves del bloque:", list(block.keys()))
    series = block["series"]
    print("puntos en el bloque:", len(series))
    day_end_ms = day_start_ms + 24 * 3600 * 1000
    day_points = [s for s in series if day_start_ms <= s[0] < day_end_ms]
    nulls = [s for s in day_points if s[1] is None]
    print(f"puntos del día: {len(day_points)} (nulls: {len(nulls)})")
    if day_points:
        print("primero:", _ms(day_points[0][0]), day_points[0][1])
        print("último:", _ms(day_points[-1][0]), day_points[-1][1])
    # Ojo: los timestamps de SMARD son UTC en ms, pero el "día" alemán empieza
    # a las 22:00 o 23:00 UTC del día anterior. Decidir si business_date se
    # calcula en Europe/Berlin. Probablemente sí.


def _ms(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# PSE (Polonia)
# ---------------------------------------------------------------------------

PSE_URL = "https://api.raporty.pse.pl/api/rce-pln"


def pse_fetch(day: date) -> None:
    section(f"PSE PL {day}")
    params = {"$filter": f"business_date eq '{day.isoformat()}'"}
    r = requests.get(PSE_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
    print("status:", r.status_code, "bytes:", len(r.content))
    save_raw(f"pse_{day}.json", r.content)
    if r.status_code != 200:
        print(r.text[:500])
        return
    data = r.json()
    print("claves de respuesta:", list(data.keys()))
    rows = data.get("value", [])
    print("filas:", len(rows))
    if "nextLink" in data or "@odata.nextLink" in data:
        print("PAGINA. Hay nextLink, hay que iterar.")
    if rows:
        print("campos de una fila:", list(rows[0].keys()))
        print("primera fila:", json.dumps(rows[0], ensure_ascii=False))
        print("última fila:", json.dumps(rows[-1], ensure_ascii=False))
        # Confirmar qué campo es el timestamp UTC y qué formato tiene.
        for k in ("dtime_utc", "udtczas", "dtime", "period_utc", "period"):
            if k in rows[0]:
                print(f"  campo {k} presente:", rows[0][k])


# ---------------------------------------------------------------------------
# BCE tipo de cambio PLN por EUR
# ---------------------------------------------------------------------------

ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.PLN.EUR.SP00.A"


def ecb_fetch(day: date) -> None:
    section(f"BCE EUR/PLN alrededor de {day}")
    params = {
        "format": "csvdata",
        "startPeriod": (day - timedelta(days=10)).isoformat(),
        "endPeriod": day.isoformat(),
    }
    r = requests.get(ECB_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
    print("status:", r.status_code, "bytes:", len(r.content))
    save_raw("ecb_pln_eur.csv", r.content)
    if r.status_code != 200:
        print(r.text[:500])
        return
    lines = r.text.strip().splitlines()
    header = lines[0].split(",")
    print("columnas:", header)
    i_t = header.index("TIME_PERIOD")
    i_v = header.index("OBS_VALUE")
    rates = {}
    for line in lines[1:]:
        cols = line.split(",")
        rates[cols[i_t]] = float(cols[i_v])
    print("tasas (PLN por 1 EUR):")
    for d, v in sorted(rates.items()):
        print(f"  {d}: {v}")
    if day.isoformat() not in rates:
        prev = max(d for d in rates if d < day.isoformat())
        print(f"{day} no tiene tasa publicada. Carry forward desde {prev}: {rates[prev]}")
    # Conversión: price_eur = price_pln / rate


# ---------------------------------------------------------------------------


def main() -> None:
    if len(sys.argv) > 1:
        day = date.fromisoformat(sys.argv[1])
    else:
        day = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    print("fecha objetivo (UTC):", day)

    token = os.environ.get("ENTSOE_TOKEN")
    if not token:
        print("\nENTSOE_TOKEN no está en el entorno. Se salta ENTSO-E.")
    else:
        for c in ("ES", "RO"):
            try:
                entsoe_fetch(c, day, token)
            except Exception as e:  # noqa: BLE001
                print("ERROR ENTSO-E", c, repr(e))

    for fn in (smard_fetch, pse_fetch, ecb_fetch):
        try:
            fn(day)
        except Exception as e:  # noqa: BLE001
            print("ERROR", fn.__name__, repr(e))

    print("\nRespuestas crudas guardadas en", RAW_DIR)


if __name__ == "__main__":
    main()
