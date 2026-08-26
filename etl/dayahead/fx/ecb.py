"""Tipo de cambio de referencia del BCE, serie EXR/D.PLN.EUR.SP00.A (PLN por 1 EUR).

Hechos verificados en el spike:
- CSV con columnas TIME_PERIOD (YYYY-MM-DD), OBS_VALUE, OBS_STATUS. Sin token.
- No hay filas en fines de semana ni festivos TARGET. La tasa del día sale ~16:15 CET.
- Carry forward: última fecha con tasa <= business_date (D15).
"""

from __future__ import annotations

import csv
import io
from dataclasses import replace
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Iterable, List, Mapping, Tuple

from ..adapters import Request
from ..models import PriceRecord, SourceError

SERIES_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A"
LOOKBACK_DAYS = 10  # cubre el racimo más largo de días sin tasa (Pascua: 4 días)
EUR = "EUR"
FX_SOURCE = "ecb"


class FxRateUnavailable(SourceError):
    pass


def build_request(start_date: date, end_date: date, currency: str = "PLN", lookback_days: int = LOOKBACK_DAYS) -> Request:
    return Request(
        url=SERIES_URL.format(currency=currency),
        params={
            "format": "csvdata",
            "startPeriod": (start_date - timedelta(days=lookback_days)).isoformat(),
            "endPeriod": end_date.isoformat(),
        },
    )


def parse_csv(text: str) -> Dict[date, Decimal]:
    """{fecha: tasa}. Solo observaciones con valor; ignora filas con OBS_VALUE vacío."""
    if not text.strip():
        return {}
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "TIME_PERIOD" not in reader.fieldnames or "OBS_VALUE" not in reader.fieldnames:
        raise SourceError("CSV del BCE sin columnas TIME_PERIOD/OBS_VALUE")
    out: Dict[date, Decimal] = {}
    for row in reader:
        value = (row.get("OBS_VALUE") or "").strip()
        if not value:
            continue
        out[date.fromisoformat(row["TIME_PERIOD"])] = Decimal(value)
    return out


def rate_on_or_before(rates: Mapping[date, Decimal], business_date: date) -> Tuple[Decimal, date]:
    """Tasa vigente para un día de negocio: la última publicada en o antes de ese día."""
    candidates = [d for d in rates if d <= business_date]
    if not candidates:
        raise FxRateUnavailable(f"sin tasa del BCE en o antes de {business_date}")
    d = max(candidates)
    return rates[d], d


def apply_fx(records: Iterable[PriceRecord], rates: Mapping[date, Decimal], quantize: str = "0.0001") -> List[PriceRecord]:
    """Completa price_eur, fx_rate y fx_rate_date. Filas en EUR: tasa 1, fecha = business_date."""
    q = Decimal(quantize)
    out: List[PriceRecord] = []
    for r in records:
        if r.currency_original == EUR:
            out.append(replace(r, price_eur=r.price_original, fx_rate=Decimal(1), fx_rate_date=r.business_date_local))
            continue
        rate, rate_date = rate_on_or_before(rates, r.business_date_local)
        price_eur = (r.price_original / rate).quantize(q, rounding=ROUND_HALF_UP)
        out.append(replace(r, price_eur=price_eur, fx_rate=rate, fx_rate_date=rate_date))
    return out
