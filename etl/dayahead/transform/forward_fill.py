"""Forward fill por posición para curveType A03 de ENTSO-E.

A03 ("variable sized block") omite un Point cuando su precio es igual al de la posición
anterior. La posición 1 siempre viene. Rellenar es copiar hacia adelante el último precio
conocido hasta completar las posiciones esperadas del Period.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Mapping


class ForwardFillError(ValueError):
    pass


def forward_fill_positions(points: Mapping[int, Decimal], expected: int) -> List[Decimal]:
    """Devuelve ``expected`` precios, índice 0 = posición 1.

    Errores: falta la posición 1 (no hay valor de arranque, no se inventa) o hay posiciones
    fuera de 1..expected (el Period no cuadra con sus puntos).
    """
    if expected <= 0:
        raise ForwardFillError(f"expected debe ser positivo, llegó {expected}")
    if 1 not in points:
        raise ForwardFillError("falta la posición 1; no se puede rellenar sin valor inicial")
    bad = [p for p in points if p < 1 or p > expected]
    if bad:
        raise ForwardFillError(f"posiciones fuera de 1..{expected}: {sorted(bad)[:10]}")
    out: List[Decimal] = []
    last = points[1]
    for pos in range(1, expected + 1):
        if pos in points:
            last = points[pos]
        out.append(last)
    return out
