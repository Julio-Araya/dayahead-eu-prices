"""Utilidades de tiempo. Todo lo que toca zonas horarias pasa por acá."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Tuple
from zoneinfo import ZoneInfo

UTC = timezone.utc

_RES_RE = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?$")


def parse_resolution(resolution: str) -> timedelta:
    """'PT15M' -> 15 min, 'PT60M' -> 60 min, 'PT1H' -> 60 min."""
    m = _RES_RE.match(resolution or "")
    if not m or not (m.group(1) or m.group(2)):
        raise ValueError(f"resolución no soportada: {resolution!r}")
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    return timedelta(hours=hours, minutes=minutes)


def day_window_utc(business_date: date, tz: str) -> Tuple[datetime, datetime]:
    """Inicio y fin (exclusivo) en UTC del día local ``business_date`` en la zona ``tz``.

    En días de cambio de hora la ventana dura 23 o 25 horas. Eso es lo que hace que los
    slots esperados salgan solos sin tabla de excepciones.
    """
    zone = ZoneInfo(tz)
    start_local = datetime(business_date.year, business_date.month, business_date.day, tzinfo=zone)
    next_day = business_date + timedelta(days=1)
    end_local = datetime(next_day.year, next_day.month, next_day.day, tzinfo=zone)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def local_date(ts_utc: datetime, tz: str) -> date:
    """Fecha local en ``tz`` de un instante UTC."""
    return ts_utc.astimezone(ZoneInfo(tz)).date()


def ensure_utc(dt: datetime) -> datetime:
    """Normaliza a tz-aware UTC. Un datetime naive se interpreta como UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def from_epoch_ms(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def to_epoch_ms(dt: datetime) -> int:
    return int(ensure_utc(dt).timestamp() * 1000)
