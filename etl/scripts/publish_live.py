"""Ingestión real hacia la API: baja una ventana de las cuatro fuentes y la publica firmada.

Reproduce lo que hace el notebook de Fabric con ``publish_to_api=True`` pero desde tu máquina,
para probar la API de punta a punta (firma HMAC, upsert, load_control) sin Fabric.

Uso, desde la raíz del repo:

    python3 -m pip install requests
    set -a; source .env; set +a      # ENTSOE_TOKEN, INGEST_HMAC_SECRET, INGEST_API_URL
    python3 etl/scripts/publish_live.py [YYYY-MM-DD] [--api http://localhost:3000] [--dry-run]

Sin fecha usa la ventana [D-3, D+1] de hoy. Con --dry-run construye y firma pero no envía.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests  # noqa: E402

from dayahead import publish  # noqa: E402
from dayahead.adapters import entsoe, pse, smard  # noqa: E402
from dayahead.config import DEFAULT_SOURCES  # noqa: E402
from dayahead.control import evaluate_day, load_window  # noqa: E402
from dayahead.fx import ecb  # noqa: E402

HEADERS = {"User-Agent": "dayahead-publish-live/0.1"}
TIMEOUT = 60


def _get(req):
    return requests.get(req.url, params=req.params, headers=HEADERS, timeout=TIMEOUT)


def main() -> int:
    argv = sys.argv[1:]
    api = os.environ.get("INGEST_API_URL") or "http://localhost:3000"
    if "--api" in argv:
        i = argv.index("--api")
        api = argv[i + 1]
        del argv[i:i + 2]
    dry = "--dry-run" in argv
    args = [a for a in argv if not a.startswith("--")]
    token, secret = os.environ.get("ENTSOE_TOKEN"), os.environ.get("INGEST_HMAC_SECRET")
    if not token or not secret:
        print("faltan ENTSOE_TOKEN o INGEST_HMAC_SECRET en el entorno")
        return 2

    run_started = datetime.now(timezone.utc).replace(microsecond=0)
    run_id = run_started.strftime("%Y%m%dT%H%M%SZ")
    run_date = date.fromisoformat(args[0]) if args else run_started.date()
    days = load_window(run_date)
    rates = ecb.parse_csv(_get(ecb.build_request(days[0], days[-1])).text)

    records, control = [], []
    for cfg in DEFAULT_SOURCES:
        if cfg.adapter == "entsoe":
            r = _get(entsoe.build_request(cfg, days[0], days[-1], token))
            try:
                recs = entsoe.parse_document(r.content, cfg, r.status_code)
            except entsoe.EntsoeAcknowledgement as e:
                if not e.is_no_data:
                    raise
                recs = []
        elif cfg.adapter == "smard":
            index = smard.parse_index(_get(smard.index_request(cfg)).json())
            blocks = smard.blocks_for_range(index, cfg, days[0], days[-1])
            recs = smard.parse_blocks([_get(smard.block_request(cfg, b)).json() for b in blocks], cfg, days[0], days[-1])
        else:
            recs = pse.fetch_all(pse.build_request(cfg, days[0], days[-1]), cfg, lambda u, p: requests.get(u, params=p, headers=HEADERS, timeout=TIMEOUT).json())
        recs = ecb.apply_fx(recs, rates if cfg.currency != ecb.EUR else {})
        records.extend(recs)
        for d in days:
            ev = evaluate_day(cfg.country_code, d, cfg.market_tz, cfg.resolution, recs)
            control.append({
                "country_code": cfg.country_code, "business_date_local": d, "expected_slots": ev.expected, "loaded_slots": ev.loaded,
                "status": ev.status.value, "source_published_at": ev.source_published_at, "last_attempt_utc": run_started,
                "last_success_utc": run_started if ev.status.value == "complete" else None, "last_error": None, "run_id": run_id,
            })
        print(f"{cfg.country_code}: {len(recs)} filas")

    payloads = publish.build_payloads(run_id, run_started, records, control)
    print(f"run_id={run_id} ventana {days[0]} -> {days[-1]}: {len(records)} precios, {len(control)} filas de control, {len(payloads)} parte(s)")
    for payload in payloads:
        req = publish.build_ingest_request(api, secret, payload, int(time.time()), str(uuid.uuid4()))
        if dry:
            print(f"  parte {payload['part']}: {len(req.body)} bytes, firma {req.headers['X-Signature'][:23]}…")
            continue
        resp = requests.post(req.url, data=req.body, headers=req.headers, timeout=TIMEOUT)
        print(f"  parte {payload['part']}/{payload['parts']}: HTTP {resp.status_code} {resp.text[:200]}")
        if resp.status_code != 200:
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
