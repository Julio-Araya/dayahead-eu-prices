"""Smoke en vivo del módulo dayahead contra las cuatro APIs y el BCE.

No forma parte del paquete puro: usa ``requests`` y hace llamadas HTTP reales. Sirve para
validar los request builders y el flujo completo (parseo, forward fill, conversión a EUR,
evaluación de completitud) con la ventana real de una corrida, sin escribir en ninguna base.

Uso, desde la raíz del repo:

    python3 -m pip install requests
    set -a; source .env; set +a          # exporta ENTSOE_TOKEN (nunca en el repo)
    python3 etl/scripts/smoke_live.py              # ventana [D-3, D+1] con D = hoy en UTC
    python3 etl/scripts/smoke_live.py 2026-08-20   # ventana alrededor de otra fecha

Salida: una línea por país con filas obtenidas, estado por día (complete / incomplete /
pending), sello source_published_at y una fila de ejemplo convertida a EUR.
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests  # noqa: E402

from dayahead.adapters import entsoe, pse, smard  # noqa: E402
from dayahead.config import DEFAULT_SOURCES  # noqa: E402
from dayahead.control import evaluate_day, load_window  # noqa: E402
from dayahead.fx import ecb  # noqa: E402

HEADERS = {"User-Agent": "dayahead-smoke/0.1"}
TIMEOUT = 60


def _get(req):
    return requests.get(req.url, params=req.params, headers=HEADERS, timeout=TIMEOUT)


def main() -> int:
    token = os.environ.get("ENTSOE_TOKEN")
    if not token:
        print("ENTSOE_TOKEN no está en el entorno. Exportalo desde .env antes de correr.")
        return 2
    run_date = date.fromisoformat(sys.argv[1]) if len(sys.argv) > 1 else datetime.now(timezone.utc).date()
    days = load_window(run_date)
    print(f"corrida {run_date} ({datetime.now(timezone.utc):%H:%MZ}) ventana {days[0]} -> {days[-1]}")

    fx_rates = ecb.parse_csv(_get(ecb.build_request(days[0], days[-1])).text)
    print("BCE tasas:", {d.isoformat(): str(v) for d, v in sorted(fx_rates.items())})

    failures = 0
    for cfg in DEFAULT_SOURCES:
        if not cfg.active:
            continue
        try:
            if cfg.adapter == "entsoe":
                r = _get(entsoe.build_request(cfg, days[0], days[-1], token))
                records = entsoe.parse_document(r.content, cfg, r.status_code)
            elif cfg.adapter == "smard":
                index = smard.parse_index(_get(smard.index_request(cfg)).json())
                blocks = smard.blocks_for_range(index, cfg, days[0], days[-1])
                payloads = [_get(smard.block_request(cfg, b)).json() for b in blocks]
                records = smard.parse_blocks(payloads, cfg, days[0], days[-1])
            elif cfg.adapter == "pse":
                fetch = lambda url, params: requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT).json()  # noqa: E731
                records = pse.fetch_all(pse.build_request(cfg, days[0], days[-1]), cfg, fetch)
            else:
                raise RuntimeError(f"adaptador sin rama en el smoke: {cfg.adapter}")
            records = ecb.apply_fx(records, fx_rates)
            per_day = []
            for d in days:
                ev = evaluate_day(cfg.country_code, d, cfg.market_tz, cfg.resolution, records)
                per_day.append(f"{d:%m-%d}:{ev.status.value} {ev.loaded}/{ev.expected}")
            published = max((r.source_published_at for r in records if r.source_published_at), default=None)
            first = records[0]
            print(
                f"{cfg.country_code} {cfg.adapter:6s} filas={len(records):4d} | " + " | ".join(per_day)
                + f" | published_at={published.isoformat() if published else None}"
                + f" | ej: {first.ts_utc.isoformat()} {first.price_original} {first.currency_original}"
                + f" -> {first.price_eur} EUR (tasa {first.fx_rate} del {first.fx_rate_date})"
            )
        except entsoe.EntsoeAcknowledgement as e:
            print(f"{cfg.country_code} {'pendiente' if e.is_no_data else 'ERROR'}: {e}")
            failures += 0 if e.is_no_data else 1
        except Exception as e:  # noqa: BLE001
            print(f"{cfg.country_code} ERROR {type(e).__name__}: {str(e)[:200]}")
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
