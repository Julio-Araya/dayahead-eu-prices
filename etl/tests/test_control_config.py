import json
from datetime import date

import pytest

from dayahead.config import DEFAULT_SOURCES, SourceConfig
from dayahead.control import load_window


def test_load_window_default_is_d_minus_3_to_d_plus_1():
    assert load_window(date(2026, 8, 26)) == [date(2026, 8, d) for d in (23, 24, 25, 26, 27)]


def test_load_window_custom():
    assert load_window(date(2026, 1, 1), days_back=1, days_ahead=0) == [date(2025, 12, 31), date(2026, 1, 1)]


def test_default_sources_cover_four_countries():
    assert [c.country_code for c in DEFAULT_SOURCES] == ["ES", "RO", "DE", "PL"]
    assert all(c.active for c in DEFAULT_SOURCES)


def test_from_row_accepts_json_params_and_roundtrips():
    row = {"country_code": "ES", "adapter": "entsoe", "market_tz": "Europe/Madrid", "currency": "EUR", "resolution": "PT15M", "params": json.dumps({"domain": "X"}), "active": 1}
    c = SourceConfig.from_row(row)
    assert c.params == {"domain": "X"} and c.active is True
    assert SourceConfig.from_row(c.to_row()) == c


def test_unknown_adapter_rejected():
    with pytest.raises(ValueError):
        SourceConfig("XX", "csv", "UTC", "EUR", "PT60M")
