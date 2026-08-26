"""Un adaptador por fuente. Cada uno expone:

- ``build_request(...)`` -> ``Request`` con URL y parámetros (puro, sin llamar).
- ``parse_*(...)`` -> ``list[PriceRecord]`` a partir de la respuesta cruda.

El notebook elige el adaptador por ``SourceConfig.adapter``.
"""

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass(frozen=True)
class Request:
    url: str
    params: Dict[str, Any] = field(default_factory=dict)
