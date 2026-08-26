"""SMARD (Bundesnetzagentur), filtro 4169, dos pasos: índice de bloques y bloque semanal.

Hechos verificados en el spike:
- El índice es {"timestamps": [ms, ...]}; cada uno es lunes 00:00 hora de Berlín.
- Bloque = {"meta_data": {"version", "created"}, "series": [[ts_ms, valor | null], ...]},
  168 puntos por semana en el índice horario. Futuro en null.
- Para un día se elige el bloque con mayor timestamp <= inicio del día (en Berlín).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Sequence

from . import Request
from ..config import SourceConfig
from ..models import PriceRecord, SourceError
from ..timeutil import day_window_utc, from_epoch_ms, local_date, to_epoch_ms

BASE_URL = "https://www.smard.de/app/chart_data"
SOURCE = "smard"


def index_request(config: SourceConfig) -> Request:
    p = config.params
    return Request(url=f"{BASE_URL}/{p['filter']}/{p['region']}/{p.get('index', 'index_hour')}.json")


def block_request(config: SourceConfig, block_ts_ms: int) -> Request:
    p = config.params
    return Request(url=f"{BASE_URL}/{p['filter']}/{p['region']}/{p['filter']}_{p['region']}_{p.get('block', 'hour')}_{block_ts_ms}.json")


def select_block(index_timestamps: Sequence[int], day_start_ms: int) -> int:
    """Mayor timestamp del índice menor o igual al inicio del día."""
    candidates = [t for t in index_timestamps if t <= day_start_ms]
    if not candidates:
        raise SourceError(f"ningún bloque de SMARD cubre {from_epoch_ms(day_start_ms).isoformat()}")
    return max(candidates)


def blocks_for_range(index_timestamps: Sequence[int], config: SourceConfig, start_date: date, end_date: date) -> List[int]:
    """Bloques distintos necesarios para cubrir [start_date, end_date], en orden."""
    if end_date < start_date:
        raise ValueError("end_date anterior a start_date")
    out: List[int] = []
    d = start_date
    while d <= end_date:
        start_utc, _ = day_window_utc(d, config.market_tz)
        b = select_block(index_timestamps, to_epoch_ms(start_utc))
        if b not in out:
            out.append(b)
        d = date.fromordinal(d.toordinal() + 1)
    return out


def parse_index(payload: Dict[str, Any]) -> List[int]:
    ts = payload.get("timestamps")
    if not isinstance(ts, list) or not ts:
        raise SourceError("índice de SMARD sin 'timestamps'")
    return [int(t) for t in ts]


def parse_block(payload: Dict[str, Any], config: SourceConfig, start_date: date, end_date: date) -> List[PriceRecord]:
    """Filas del bloque dentro de los días [start_date, end_date] en market_tz. Los null se omiten."""
    series = payload.get("series")
    if not isinstance(series, list):
        raise SourceError("bloque de SMARD sin 'series'")
    meta = payload.get("meta_data") or {}
    published_at = from_epoch_ms(int(meta["created"])) if "created" in meta else None
    lo, _ = day_window_utc(start_date, config.market_tz)
    _, hi = day_window_utc(end_date, config.market_tz)
    lo_ms, hi_ms = to_epoch_ms(lo), to_epoch_ms(hi)

    out: List[PriceRecord] = []
    for item in series:
        ts_ms, value = int(item[0]), item[1]
        if value is None or not (lo_ms <= ts_ms < hi_ms):
            continue
        ts_utc = from_epoch_ms(ts_ms)
        out.append(
            PriceRecord(
                country_code=config.country_code,
                ts_utc=ts_utc,
                resolution=config.resolution,
                business_date_local=local_date(ts_utc, config.market_tz),
                price_original=Decimal(str(value)),
                currency_original=config.currency,
                source=SOURCE,
                source_published_at=published_at,
            )
        )
    return out


def parse_blocks(payloads: Iterable[Dict[str, Any]], config: SourceConfig, start_date: date, end_date: date) -> List[PriceRecord]:
    by_ts = {}
    for payload in payloads:
        for r in parse_block(payload, config, start_date, end_date):
            by_ts[r.ts_utc] = r
    return [by_ts[k] for k in sorted(by_ts)]
