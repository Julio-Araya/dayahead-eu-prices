"""ENTSO-E Transparency Platform, documentType A44 (day-ahead prices).

Hechos verificados en el spike (spike/findings-2026-08-26.md):
- Los Period vienen alineados al día CET/CEST para todas las zonas (D7).
- Un documento puede traer varios TimeSeries: day-ahead (contract_MarketAgreement.type
  A01) y subastas intradiarias (A07). Solo se acepta el tipo configurado (D8).
- curveType A03 omite posiciones con precio repetido: forward fill por posición.
- La resolución se lee de cada Period (D13).
- createdDateTime es la hora de generación de la respuesta, no de publicación: se guarda
  en source_published_at con significado "as-of" (D12).
- Sin datos: HTTP 200 con Acknowledgement_MarketDocument y Reason/code 999.
  Token inválido: HTTP 401 con el mismo código. Se distinguen por status y texto.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime
from decimal import Decimal
from typing import Dict, List, Optional, Union

from . import Request
from ..config import SourceConfig
from ..models import PriceRecord, SourceError, SourceNoData
from ..timeutil import UTC, day_window_utc, local_date, parse_resolution
from ..transform.forward_fill import forward_fill_positions

BASE_URL = "https://web-api.tp.entsoe.eu/api"
DOCUMENT_TYPE = "A44"
SOURCE = "entsoe"
_NO_DATA_PREFIX = "No matching data found"


class EntsoeAcknowledgement(SourceError):
    """La API devolvió un Acknowledgement_MarketDocument en vez de datos."""

    def __init__(self, code: str, text: str, http_status: Optional[int] = None):
        super().__init__(f"ENTSO-E ack {code}: {text}")
        self.code = code
        self.text = text
        self.http_status = http_status

    @property
    def is_no_data(self) -> bool:
        """True cuando la fuente simplemente no tiene datos aún (día pendiente, D10)."""
        status_ok = self.http_status in (None, 200)
        return status_ok and self.text.startswith(_NO_DATA_PREFIX)


def build_request(config: SourceConfig, start_date: date, end_date: date, token: str) -> Request:
    """Una sola llamada para el rango [start_date, end_date] de días de mercado."""
    if end_date < start_date:
        raise ValueError("end_date anterior a start_date")
    start_utc, _ = day_window_utc(start_date, config.market_tz)
    _, end_utc = day_window_utc(end_date, config.market_tz)
    domain = config.params["domain"]
    return Request(
        url=BASE_URL,
        params={
            "documentType": DOCUMENT_TYPE,
            "in_Domain": domain,
            "out_Domain": domain,
            "periodStart": start_utc.strftime("%Y%m%d%H%M"),
            "periodEnd": end_utc.strftime("%Y%m%d%H%M"),
            "securityToken": token,
        },
    )


def _ns(root: ET.Element) -> Dict[str, str]:
    if not root.tag.startswith("{"):
        raise SourceError(f"XML sin namespace, tag raíz {root.tag!r}")
    return {"ns": root.tag[1:].split("}")[0]}


def _parse_interval(text: str) -> datetime:
    # Formato observado: 2026-08-24T22:00Z
    return datetime.strptime(text, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)


def parse_document(xml: Union[bytes, str], config: SourceConfig, http_status: Optional[int] = None) -> List[PriceRecord]:
    """Convierte un Publication_MarketDocument en filas de precio.

    Levanta ``EntsoeAcknowledgement`` si el cuerpo es un acuse (sin datos, token malo).
    Si el documento abarca varios días, devuelve todos; el upsert es idempotente.
    """
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as e:
        raise SourceError(f"XML inválido de ENTSO-E: {e}") from e
    ns = _ns(root)
    local_tag = root.tag.split("}")[1]

    if local_tag == "Acknowledgement_MarketDocument":
        code = root.findtext("ns:Reason/ns:code", default="?", namespaces=ns)
        text = root.findtext("ns:Reason/ns:text", default="", namespaces=ns)
        raise EntsoeAcknowledgement(code, text, http_status)
    if local_tag != "Publication_MarketDocument":
        raise SourceError(f"documento inesperado: {local_tag}")

    created = root.findtext("ns:createdDateTime", namespaces=ns)
    published_at = datetime.strptime(created, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC) if created else None
    wanted_contract = config.params.get("contract_type", "A01")

    by_ts: Dict[datetime, PriceRecord] = {}
    for ts in root.findall("ns:TimeSeries", ns):
        contract = ts.findtext("ns:contract_MarketAgreement.type", namespaces=ns)
        if contract != wanted_contract:
            continue  # intradiarias A07 u otros contratos: fuera de alcance (D8)
        currency = ts.findtext("ns:currency_Unit.name", namespaces=ns)
        unit = ts.findtext("ns:price_Measure_Unit.name", namespaces=ns)
        if unit != "MWH":
            raise SourceError(f"unidad de precio inesperada: {unit!r}")
        if currency != config.currency:
            raise SourceError(f"moneda {currency!r} distinta de la configurada {config.currency!r}")

        for period in ts.findall("ns:Period", ns):
            resolution = period.findtext("ns:resolution", namespaces=ns)
            step = parse_resolution(resolution)
            start = _parse_interval(period.findtext("ns:timeInterval/ns:start", namespaces=ns))
            end = _parse_interval(period.findtext("ns:timeInterval/ns:end", namespaces=ns))
            expected = (end - start) / step
            if expected != int(expected) or expected <= 0:
                raise SourceError(f"Period {start}->{end} no es múltiplo de {resolution}")
            points: Dict[int, Decimal] = {}
            for pt in period.findall("ns:Point", ns):
                pos = int(pt.findtext("ns:position", namespaces=ns))
                points[pos] = Decimal(pt.findtext("ns:price.amount", namespaces=ns))
            prices = forward_fill_positions(points, int(expected))
            for i, price in enumerate(prices):
                ts_utc = start + step * i
                by_ts[ts_utc] = PriceRecord(
                    country_code=config.country_code,
                    ts_utc=ts_utc,
                    resolution=resolution,
                    business_date_local=local_date(ts_utc, config.market_tz),
                    price_original=price,
                    currency_original=currency,
                    source=SOURCE,
                    source_published_at=published_at,
                )
    if not by_ts:
        raise SourceNoData(f"el documento no trae TimeSeries con contract_type={wanted_contract}")
    return [by_ts[k] for k in sorted(by_ts)]
