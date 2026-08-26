"""PSE (Polskie Sieci Elektroenergetyczne), endpoint rce-pln, OData.

Hechos verificados en el spike:
- Respuesta {"value": [...]} con dtime, period, rce_pln (float), dtime_utc, period_utc,
  business_date, publication_ts, publication_ts_utc.
- dtime_utc es el FIN del intervalo: ts_utc = dtime_utc - resolución (D11).
- dtime y period usan notación "02a:15:00" en la hora repetida: no se parsean nunca.
- Pagina de a 100 filas con clave "nextLink" (URL completa con cursor $after).
- Día sin datos: 200 {"value": []}.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import Request
from ..config import SourceConfig
from ..models import PriceRecord, SourceError
from ..timeutil import UTC, local_date, parse_resolution

BASE_URL = "https://api.raporty.pse.pl/api"
SOURCE = "pse"
PAGE_KEY = "nextLink"
MAX_PAGES = 200  # 100 filas/página; 30 días de PT15M son 29 páginas


def build_request(config: SourceConfig, start_date: date, end_date: date) -> Request:
    if end_date < start_date:
        raise ValueError("end_date anterior a start_date")
    if start_date == end_date:
        flt = f"business_date eq '{start_date.isoformat()}'"
    else:
        flt = f"business_date ge '{start_date.isoformat()}' and business_date le '{end_date.isoformat()}'"
    return Request(url=f"{BASE_URL}/{config.params['endpoint']}", params={"$filter": flt})


def _parse_ts(text: str) -> datetime:
    # "2026-08-24 22:15:00" o "2026-08-24 11:46:21.852", sin zona, siempre UTC.
    fmt = "%Y-%m-%d %H:%M:%S.%f" if "." in text else "%Y-%m-%d %H:%M:%S"
    return datetime.strptime(text, fmt).replace(tzinfo=UTC)


def parse_page(payload: Dict[str, Any], config: SourceConfig) -> Tuple[List[PriceRecord], Optional[str]]:
    """Filas de una página y el nextLink si hay más."""
    rows = payload.get("value")
    if not isinstance(rows, list):
        raise SourceError("respuesta de PSE sin 'value'")
    step = parse_resolution(config.resolution)
    price_field = config.params.get("price_field", "rce_pln")
    out: List[PriceRecord] = []
    for row in rows:
        try:
            end_utc = _parse_ts(row["dtime_utc"])
            price = Decimal(str(row[price_field]))
        except (KeyError, ValueError, TypeError) as e:
            raise SourceError(f"fila de PSE inválida: {row!r}") from e
        ts_utc = end_utc - step
        bd = local_date(ts_utc, config.market_tz)
        src_bd = row.get("business_date")
        if src_bd and src_bd != bd.isoformat():
            raise SourceError(f"business_date de la fuente {src_bd} no coincide con {bd} ({config.market_tz}) para {ts_utc}")
        pub = row.get("publication_ts_utc")
        out.append(
            PriceRecord(
                country_code=config.country_code,
                ts_utc=ts_utc,
                resolution=config.resolution,
                business_date_local=bd,
                price_original=price,
                currency_original=config.currency,
                source=SOURCE,
                source_published_at=_parse_ts(pub) if pub else None,
            )
        )
    return out, payload.get(PAGE_KEY) or None


Fetcher = Callable[[str, Optional[Dict[str, Any]]], Dict[str, Any]]


def fetch_all(request: Request, config: SourceConfig, fetch: Fetcher, max_pages: int = MAX_PAGES) -> List[PriceRecord]:
    """Sigue nextLink hasta agotar. ``fetch(url, params)`` la pone quien orquesta (HTTP real o fixture)."""
    records: List[PriceRecord] = []
    payload = fetch(request.url, request.params)
    for _ in range(max_pages):
        rows, next_link = parse_page(payload, config)
        records.extend(rows)
        if not next_link:
            by_ts = {r.ts_utc: r for r in records}
            return [by_ts[k] for k in sorted(by_ts)]
        payload = fetch(next_link, None)
    raise SourceError(f"PSE: más de {max_pages} páginas; posible bucle de paginación")
