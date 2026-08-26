"""Ventana de corrida y evaluación de completitud por día (D10)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Iterable, List, Optional

from .gaps.slots import expected_slots, find_gaps
from .models import PriceRecord


class DayStatus(str, Enum):
    COMPLETE = "complete"  # cargados == esperados
    INCOMPLETE = "incomplete"  # hay filas pero faltan slots
    PENDING = "pending"  # la fuente aún no publicó nada para el día


@dataclass(frozen=True)
class DayEvaluation:
    country_code: str
    business_date: date
    expected: int
    loaded: int
    missing: List[datetime]
    status: DayStatus
    source_published_at: Optional[datetime]


def load_window(run_date: date, days_back: int = 3, days_ahead: int = 1) -> List[date]:
    """[D-3, D+1] por defecto. ``run_date`` es la fecha UTC de la corrida."""
    return [run_date + timedelta(days=i) for i in range(-days_back, days_ahead + 1)]


def evaluate_day(
    country_code: str,
    business_date: date,
    tz: str,
    resolution: str,
    records: Iterable[PriceRecord],
) -> DayEvaluation:
    """Compara las filas de un país y día contra los slots esperados de su calendario DST."""
    rows = [r for r in records if r.country_code == country_code and r.business_date_local == business_date]
    expected = expected_slots(business_date, tz, resolution)
    missing = find_gaps((r.ts_utc for r in rows), business_date, tz, resolution)
    loaded = expected - len(missing)
    if loaded == 0:
        status = DayStatus.PENDING
    elif missing:
        status = DayStatus.INCOMPLETE
    else:
        status = DayStatus.COMPLETE
    published = [r.source_published_at for r in rows if r.source_published_at is not None]
    return DayEvaluation(
        country_code=country_code,
        business_date=business_date,
        expected=expected,
        loaded=loaded,
        missing=missing,
        status=status,
        source_published_at=max(published) if published else None,
    )
