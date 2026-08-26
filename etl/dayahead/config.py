"""Configuración de fuentes. Una fila por país; nada hardcodeado por país en el código.

``DEFAULT_SOURCES`` es la semilla de la tabla ``sources_config`` de Fabric. El notebook
lee esa tabla y construye ``SourceConfig`` con ``SourceConfig.from_row``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping

ADAPTERS = ("entsoe", "smard", "pse")


@dataclass(frozen=True)
class SourceConfig:
    country_code: str
    adapter: str
    market_tz: str  # zona del día de mercado que publica la fuente (D7)
    currency: str
    resolution: str  # resolución esperada, usada para slots esperados (D13)
    params: Dict[str, Any] = field(default_factory=dict)
    active: bool = True

    def __post_init__(self) -> None:
        if self.adapter not in ADAPTERS:
            raise ValueError(f"adaptador desconocido: {self.adapter!r} (válidos: {ADAPTERS})")

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "SourceConfig":
        """Construye desde una fila de tabla. ``params`` puede venir como JSON en texto."""
        params = row.get("params") or {}
        if isinstance(params, str):
            params = json.loads(params)
        return cls(
            country_code=row["country_code"],
            adapter=row["adapter"],
            market_tz=row["market_tz"],
            currency=row["currency"],
            resolution=row["resolution"],
            params=dict(params),
            active=bool(row.get("active", True)),
        )

    def to_row(self) -> Dict[str, Any]:
        return {
            "country_code": self.country_code,
            "adapter": self.adapter,
            "market_tz": self.market_tz,
            "currency": self.currency,
            "resolution": self.resolution,
            "params": json.dumps(self.params, sort_keys=True),
            "active": self.active,
        }


DEFAULT_SOURCES: List[SourceConfig] = [
    SourceConfig(
        country_code="ES",
        adapter="entsoe",
        market_tz="Europe/Madrid",
        currency="EUR",
        resolution="PT15M",
        params={"domain": "10YES-REE------0", "contract_type": "A01"},
    ),
    SourceConfig(
        country_code="RO",
        adapter="entsoe",
        # ENTSO-E publica el day-ahead rumano alineado al día CET, no al día EET (D7).
        market_tz="CET",
        currency="EUR",
        resolution="PT15M",
        params={"domain": "10YRO-TEL------P", "contract_type": "A01"},
    ),
    SourceConfig(
        country_code="DE",
        adapter="smard",
        market_tz="Europe/Berlin",
        currency="EUR",
        resolution="PT60M",
        params={"filter": "4169", "region": "DE", "index": "index_hour", "block": "hour"},
    ),
    SourceConfig(
        country_code="PL",
        adapter="pse",
        market_tz="Europe/Warsaw",
        currency="PLN",
        resolution="PT15M",
        params={"endpoint": "rce-pln", "price_field": "rce_pln"},
    ),
]
