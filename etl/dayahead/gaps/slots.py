"""Slots esperados por día y detección de huecos.

Un hueco es un instante esperado para el que no hay fila. No confundir con las posiciones
que ENTSO-E omite por curveType A03: esas se rellenan en el parser antes de llegar acá.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Iterable, List

from ..timeutil import day_window_utc, ensure_utc, parse_resolution


def expected_slots(business_date: date, tz: str, resolution: str) -> int:
    """96 para PT15M y 24 para PT60M en un día normal; 92/100 y 23/25 en cambio de hora."""
    start, end = day_window_utc(business_date, tz)
    step = parse_resolution(resolution)
    total = (end - start) / step
    if total != int(total):
        raise ValueError(f"el día {business_date} en {tz} no es múltiplo de {resolution}")
    return int(total)


def expected_timestamps(business_date: date, tz: str, resolution: str) -> List[datetime]:
    """Todos los ``ts_utc`` que debería tener el día, en orden."""
    start, end = day_window_utc(business_date, tz)
    step = parse_resolution(resolution)
    out: List[datetime] = []
    t = start
    while t < end:
        out.append(t)
        t += step
    return out


def find_gaps(present: Iterable[datetime], business_date: date, tz: str, resolution: str) -> List[datetime]:
    """Instantes esperados que no están en ``present``. Lista vacía = día completo."""
    have = {ensure_utc(t) for t in present}
    return [t for t in expected_timestamps(business_date, tz, resolution) if t not in have]
