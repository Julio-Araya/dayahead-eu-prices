"""Tipos de datos compartidos por adaptadores, transformaciones y control."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Tuple


@dataclass
class PriceRecord:
    """Una fila de la tabla de precios. Clave única: (country_code, ts_utc)."""

    country_code: str
    ts_utc: datetime  # inicio del intervalo, tz-aware en UTC
    resolution: str  # "PT15M" | "PT60M", tal como lo dijo la fuente
    business_date_local: date  # día de mercado según market_tz de la fuente (D7)
    price_original: Decimal
    currency_original: str  # "EUR" | "PLN"
    source: str  # "entsoe" | "smard" | "pse"
    source_published_at: Optional[datetime]  # sello de publicación de la fuente (D12)
    price_eur: Optional[Decimal] = None
    fx_rate: Optional[Decimal] = None
    fx_rate_date: Optional[date] = None

    @property
    def key(self) -> Tuple[str, datetime]:
        return (self.country_code, self.ts_utc)

    def to_row(self) -> dict:
        """Diccionario con tipos nativos, listo para un DataFrame o JSON (tras serializar)."""
        return asdict(self)


class SourceError(Exception):
    """Error atribuible a la fuente: formato inesperado, documento inconsistente."""


class SourceNoData(SourceError):
    """La fuente respondió correctamente pero no tiene datos para la ventana pedida.

    No es un error de pipeline: el día queda pendiente y se reintenta (D10).
    """
