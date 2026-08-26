# etl — módulo `dayahead`

Parseo y transformación de precios day-ahead. Puro: sin I/O, sin Spark, solo biblioteca estándar (Python ≥ 3.9). El notebook de Fabric hace las llamadas HTTP y las escrituras; este módulo convierte respuestas crudas en filas.

```
dayahead/
  models.py        PriceRecord, SourceError, SourceNoData
  config.py        SourceConfig y DEFAULT_SOURCES (semilla de sources_config)
  timeutil.py      resoluciones ISO-8601, ventana UTC de un día local, fechas locales
  control.py       load_window [D-3, D+1], evaluate_day -> complete | incomplete | pending
  adapters/
    entsoe.py      build_request, parse_document (filtra A01, forward fill A03, resolución del Period)
    smard.py       index_request, block_request, select_block, blocks_for_range, parse_block(s)
    pse.py         build_request, parse_page (ts_utc = dtime_utc - 15 min), fetch_all (nextLink)
  fx/ecb.py        build_request, parse_csv, rate_on_or_before, apply_fx
  gaps/slots.py    expected_slots, expected_timestamps, find_gaps
  transform/forward_fill.py
tests/
  fixtures/        respuestas reales bajadas en el spike (2026-08-26), incluidos días de cambio de hora
```

## Tests

```
cd etl
python3 -m pip install pytest
python3 -m pytest
```

Las fixtures son respuestas reales de las APIs (ver `spike/findings-2026-08-26.md`). No contienen secretos: el token de ENTSO-E viaja en la URL, nunca en el cuerpo.

## Flujo por país (lo que orquesta el notebook)

```python
from dayahead.config import SourceConfig
from dayahead.control import load_window, evaluate_day
from dayahead.adapters import entsoe, smard, pse
from dayahead.fx import ecb

days = load_window(run_date)                      # [D-3, D+1]
req = entsoe.build_request(cfg, days[0], days[-1], token)
records = entsoe.parse_document(http_get(req), cfg, http_status)   # o smard.parse_blocks / pse.fetch_all
records = ecb.apply_fx(records, ecb.parse_csv(http_get(ecb.build_request(days[0], days[-1]))))
for d in days:
    ev = evaluate_day(cfg.country_code, d, cfg.market_tz, cfg.resolution, records)
    # upsert de records + fila en load_control con ev.status, ev.loaded, ev.expected, ev.source_published_at
```
