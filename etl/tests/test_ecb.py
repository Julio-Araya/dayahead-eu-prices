from datetime import date, datetime, timezone
from decimal import Decimal as D

import pytest

from dayahead.adapters.pse import parse_page
from dayahead.fx.ecb import FxRateUnavailable, apply_fx, build_request, parse_csv, rate_on_or_before
from dayahead.models import PriceRecord

from conftest import load_json, load_text


def test_parse_csv_reads_time_period_and_value():
    rates = parse_csv(load_text("ecb_pln_eur.csv"))
    assert len(rates) == 7
    assert rates[date(2026, 8, 25)] == D("4.3055")
    assert rates[date(2026, 8, 21)] == D("4.3078")
    assert date(2026, 8, 22) not in rates and date(2026, 8, 23) not in rates


def test_parse_csv_empty_body():
    assert parse_csv("") == {}


def test_weekend_carries_friday():
    rates = parse_csv(load_text("ecb_pln_eur.csv"))
    assert rate_on_or_before(rates, date(2026, 8, 22)) == (D("4.3078"), date(2026, 8, 21))
    assert rate_on_or_before(rates, date(2026, 8, 23)) == (D("4.3078"), date(2026, 8, 21))
    assert rate_on_or_before(rates, date(2026, 8, 24)) == (D("4.3078"), date(2026, 8, 24))
    assert rate_on_or_before(rates, date(2026, 8, 25)) == (D("4.3055"), date(2026, 8, 25))


def test_target_holidays_carry_last_published():
    easter = parse_csv(load_text("ecb_easter2026.csv"))
    assert rate_on_or_before(easter, date(2026, 4, 3)) == (D("4.2855"), date(2026, 4, 2))  # Viernes Santo
    assert rate_on_or_before(easter, date(2026, 4, 6)) == (D("4.2855"), date(2026, 4, 2))  # Lunes de Pascua
    assert rate_on_or_before(easter, date(2026, 4, 7)) == (D("4.2753"), date(2026, 4, 7))
    may = parse_csv(load_text("ecb_may1.csv"))
    assert rate_on_or_before(may, date(2026, 5, 1)) == (D("4.2605"), date(2026, 4, 30))
    assert rate_on_or_before(may, date(2026, 5, 3)) == (D("4.2605"), date(2026, 4, 30))


def test_current_day_before_publication_uses_previous():
    today = parse_csv(load_text("ecb_today.csv"))  # bajado el 26-ago a las 13:34Z, sin tasa del 26
    assert date(2026, 8, 26) not in today
    assert rate_on_or_before(today, date(2026, 8, 26)) == (D("4.3055"), date(2026, 8, 25))


def test_no_rate_before_date_is_error():
    with pytest.raises(FxRateUnavailable):
        rate_on_or_before({date(2026, 8, 25): D("4.3")}, date(2026, 8, 24))


def test_build_request_lookback():
    r = build_request(date(2026, 8, 23), date(2026, 8, 27))
    assert r.url.endswith("/EXR/D.PLN.EUR.SP00.A")
    assert r.params == {"format": "csvdata", "startPeriod": "2026-08-13", "endPeriod": "2026-08-27"}


def test_apply_fx_pln_rows(pl):
    recs, _ = parse_page(load_json("pse_2026-08-25.json"), pl)
    rates = parse_csv(load_text("ecb_pln_eur.csv"))
    out = apply_fx(recs, rates)
    assert len(out) == 96
    assert out[0].price_original == D("689.72")
    assert out[0].fx_rate == D("4.3055")
    assert out[0].fx_rate_date == date(2026, 8, 25)
    assert out[0].price_eur == D("160.1951")  # 689.72 / 4.3055 redondeado a 4 decimales
    assert all(r.price_eur is not None for r in out)
    assert recs[0].price_eur is None  # no muta la entrada


def test_apply_fx_eur_rows_pass_through():
    r = PriceRecord("ES", datetime(2026, 8, 24, 22, tzinfo=timezone.utc), "PT15M", date(2026, 8, 25), D("163.18"), "EUR", "entsoe", None)
    out = apply_fx([r], {})
    assert out[0].price_eur == D("163.18")
    assert out[0].fx_rate == D(1)
    assert out[0].fx_rate_date == date(2026, 8, 25)


def test_apply_fx_missing_rate_raises(pl):
    recs, _ = parse_page(load_json("pse_2026-08-25.json"), pl)
    with pytest.raises(FxRateUnavailable):
        apply_fx(recs, {})
