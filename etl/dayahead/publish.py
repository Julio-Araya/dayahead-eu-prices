"""Firma HMAC para publicar hacia la API (D18). Puro: no hace la llamada HTTP.

Esquema, idéntico al que verifica ``api/src/auth/hmac.ts``:

    mensaje  = f"{timestamp}.{nonce}." + cuerpo_bytes
    firma    = HMAC-SHA256(secreto, mensaje) en hexadecimal minúscula
    cabeceras: X-Timestamp (segundos Unix, entero), X-Nonce (UUID v4), X-Signature ("sha256=<hex>")

El servidor rechaza firmas cuyo timestamp se aleje más de 5 minutos de su reloj y nonces ya vistos.
El cuerpo se firma tal cual se envía: JSON compacto con claves ordenadas, Decimal como texto,
fechas y timestamps en ISO 8601 (timestamps en UTC con sufijo Z).

Los vectores de ``etl/tests/fixtures/hmac_vectors.json`` los comparten los tests de Python y de TypeScript.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Optional

from .models import PriceRecord

SIGNATURE_PREFIX = "sha256="
MAX_ROWS_PER_REQUEST = 2000


@dataclass(frozen=True)
class IngestRequest:
    url: str
    headers: Dict[str, str]
    body: bytes


def sign(secret: str, timestamp: int, nonce: str, body: bytes) -> str:
    """Firma hexadecimal (sin prefijo)."""
    message = f"{timestamp}.{nonce}.".encode("utf-8") + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f"tipo no serializable: {type(value).__name__}")


def encode_body(payload: Mapping[str, Any]) -> bytes:
    """JSON canónico: compacto, claves ordenadas, UTF-8. Es lo que se firma y lo que se envía."""
    return json.dumps(payload, default=_json_default, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")


def price_payload(record: PriceRecord) -> Dict[str, Any]:
    return {
        "country_code": record.country_code,
        "ts_utc": record.ts_utc,
        "resolution": record.resolution,
        "business_date_local": record.business_date_local,
        "price_original": record.price_original,
        "currency_original": record.currency_original,
        "price_eur": record.price_eur,
        "fx_rate": record.fx_rate,
        "fx_rate_date": record.fx_rate_date,
        "source": record.source,
        "source_published_at": record.source_published_at,
    }


def build_payloads(run_id: str, ingested_at_utc: datetime, records: Iterable[PriceRecord],
                   control_rows: Iterable[Mapping[str, Any]], max_rows: int = MAX_ROWS_PER_REQUEST) -> List[Dict[str, Any]]:
    """Divide una corrida en cuerpos de hasta ``max_rows`` precios. load_control viaja en el primero."""
    prices = [price_payload(r) for r in records]
    control = [dict(c) for c in control_rows]
    chunks = [prices[i:i + max_rows] for i in range(0, len(prices), max_rows)] or [[]]
    payloads = []
    for i, chunk in enumerate(chunks):
        payloads.append({
            "run_id": run_id,
            "ingested_at_utc": ingested_at_utc,
            "part": i + 1,
            "parts": len(chunks),
            "prices": chunk,
            "load_control": control if i == 0 else [],
        })
    return payloads


def build_ingest_request(api_url: str, secret: str, payload: Mapping[str, Any], timestamp: int, nonce: str,
                         path: str = "/v1/ingest") -> IngestRequest:
    body = encode_body(payload)
    return IngestRequest(
        url=api_url.rstrip("/") + path,
        headers={
            "Content-Type": "application/json",
            "X-Timestamp": str(int(timestamp)),
            "X-Nonce": nonce,
            "X-Signature": SIGNATURE_PREFIX + sign(secret, int(timestamp), nonce, body),
        },
        body=body,
    )


def verify(secret: str, timestamp: int, nonce: str, body: bytes, signature: str, now: Optional[int] = None,
           max_skew_seconds: int = 300) -> bool:
    """Verificación de referencia (la que hace el servidor). Útil para tests cruzados."""
    if now is not None and abs(int(now) - int(timestamp)) > max_skew_seconds:
        return False
    expected = SIGNATURE_PREFIX + sign(secret, int(timestamp), nonce, body)
    return hmac.compare_digest(expected, signature)
