from datetime import date, datetime, timezone
from decimal import Decimal as D
from dataclasses import replace

import pytest

from dayahead.adapters.entsoe import EntsoeAcknowledgement, build_request, parse_document
from dayahead.control import DayStatus, evaluate_day
from dayahead.models import SourceError, SourceNoData

from conftest import load_bytes

UTC = timezone.utc


def test_es_wide_window_keeps_only_day_ahead_and_fills_two_full_days(es):
    recs = parse_document(load_bytes("entsoe_ES_2026-08-25.xml"), es)
    assert len(recs) == 192
    by_day = {}
    for r in recs:
        by_day.setdefault(r.business_date_local, []).append(r)
    assert {d: len(v) for d, v in by_day.items()} == {date(2026, 8, 25): 96, date(2026, 8, 26): 96}
    assert recs[0].ts_utc == datetime(2026, 8, 24, 22, tzinfo=UTC)
    assert recs[0].price_original == D("163.18")
    assert recs[0].resolution == "PT15M"
    assert recs[0].currency_original == "EUR"
    assert recs[0].source == "entsoe"
    assert recs[0].source_published_at == datetime(2026, 8, 26, 13, 30, 8, tzinfo=UTC)
    # Día 26: A01 abre a 212.4; la IDA1 (A07) abría a 213.41. Si se colara, ganaría la última.
    first_26 = next(r for r in recs if r.ts_utc == datetime(2026, 8, 25, 22, tzinfo=UTC))
    assert first_26.price_original == D("212.4")
    assert len({r.ts_utc for r in recs}) == 192


def test_es_a03_forward_fill_positions_51_to_55(es):
    recs = parse_document(load_bytes("entsoe_ES_2026-08-25.xml"), es)
    day = [r for r in recs if r.business_date_local == date(2026, 8, 25)]
    # posiciones ausentes en el documento: 51-55, 58, 59, 87 (spike). Índice = posición - 1.
    for pos in (51, 52, 53, 54, 55):
        assert day[pos - 1].price_original == day[49].price_original
    for pos in (58, 59):
        assert day[pos - 1].price_original == day[56].price_original
    assert day[86].price_original == day[85].price_original
    assert day[95].ts_utc == datetime(2026, 8, 25, 21, 45, tzinfo=UTC)


def test_exact_window_returns_single_day(es):
    recs = parse_document(load_bytes("entsoe_ES_exact_2026-08-25.xml"), es)
    assert len(recs) == 96
    assert {r.business_date_local for r in recs} == {date(2026, 8, 25)}


def test_ro_two_days_no_omissions(ro):
    recs = parse_document(load_bytes("entsoe_RO_2026-08-25.xml"), ro)
    assert len(recs) == 192
    assert recs[0].ts_utc == datetime(2026, 8, 24, 22, tzinfo=UTC)
    assert recs[0].price_original == D("190.05")
    assert {r.business_date_local for r in recs} == {date(2026, 8, 25), date(2026, 8, 26)}


def test_spring_forward_es_has_92_slots(es):
    recs = parse_document(load_bytes("entsoe_ES_dst_2026-03-29.xml"), es)
    assert len(recs) == 92
    assert {r.business_date_local for r in recs} == {date(2026, 3, 29)}
    assert recs[0].ts_utc == datetime(2026, 3, 28, 23, tzinfo=UTC)
    assert recs[-1].ts_utc == datetime(2026, 3, 29, 21, 45, tzinfo=UTC)
    ev = evaluate_day("ES", date(2026, 3, 29), es.market_tz, es.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == 92 and ev.loaded == 92


def test_spring_forward_ro_is_aligned_to_cet(ro):
    # Ventana pedida en el spike: 28-mar 22:00Z -> 29-mar 21:00Z. ENTSO-E devolvió dos días CET.
    recs = parse_document(load_bytes("entsoe_RO_dst_2026-03-29.xml"), ro)
    by_day = {}
    for r in recs:
        by_day.setdefault(r.business_date_local, 0)
        by_day[r.business_date_local] += 1
    assert by_day == {date(2026, 3, 28): 96, date(2026, 3, 29): 92}


def test_fall_back_es_has_100_slots(es):
    recs = parse_document(load_bytes("entsoe_ES_dst_2025-10-26.xml"), es)
    assert len(recs) == 100
    assert {r.business_date_local for r in recs} == {date(2025, 10, 26)}
    ev = evaluate_day("ES", date(2025, 10, 26), es.market_tz, es.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == 100


def test_resolution_is_read_from_period_not_config(es):
    recs = parse_document(load_bytes("entsoe_ES_pre15m_2025-09-15.xml"), es)
    assert len(recs) == 24
    assert {r.resolution for r in recs} == {"PT60M"}
    # Contra la resolución esperada hoy (PT15M) el día queda incompleto: 24 de 96.
    ev = evaluate_day("ES", date(2025, 9, 15), es.market_tz, es.resolution, recs)
    assert ev.status == DayStatus.INCOMPLETE and ev.loaded == 24 and ev.expected == 96


def test_partially_published_next_day_still_fills_to_96(es):
    recs = parse_document(load_bytes("entsoe_ES_future_2026-08-27.xml"), es)
    assert len(recs) == 96
    assert {r.business_date_local for r in recs} == {date(2026, 8, 27)}


def test_no_data_acknowledgement_is_pending_not_error(es):
    with pytest.raises(EntsoeAcknowledgement) as ei:
        parse_document(load_bytes("entsoe_ES_ack_nodata_2026-09-10.xml"), es, http_status=200)
    assert ei.value.code == "999"
    assert ei.value.is_no_data is True


def test_auth_failure_acknowledgement_is_an_error(es):
    with pytest.raises(EntsoeAcknowledgement) as ei:
        parse_document(load_bytes("entsoe_ES_ack_401.xml"), es, http_status=401)
    assert ei.value.code == "999"  # mismo código que "sin datos": se distingue por status y texto
    assert ei.value.text == "Authentication failed."
    assert ei.value.is_no_data is False


def test_document_without_wanted_contract_raises_no_data(es):
    cfg = replace(es, params={**es.params, "contract_type": "ZZZ"})
    with pytest.raises(SourceNoData):
        parse_document(load_bytes("entsoe_RO_2026-08-25.xml"), cfg)


def test_currency_mismatch_is_source_error(es):
    cfg = replace(es, currency="PLN")
    with pytest.raises(SourceError):
        parse_document(load_bytes("entsoe_RO_2026-08-25.xml"), cfg)


def test_invalid_xml_is_source_error(es):
    with pytest.raises(SourceError):
        parse_document(b"<not xml", es)


SYNTHETIC = """<?xml version="1.0" encoding="UTF-8"?>
<Publication_MarketDocument xmlns="urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3">
  <createdDateTime>2026-08-26T10:00:00Z</createdDateTime>
  <TimeSeries>
    <contract_MarketAgreement.type>A01</contract_MarketAgreement.type>
    <currency_Unit.name>EUR</currency_Unit.name>
    <price_Measure_Unit.name>MWH</price_Measure_Unit.name>
    <curveType>A03</curveType>
    <Period>
      <timeInterval><start>2026-08-24T22:00Z</start><end>2026-08-24T23:00Z</end></timeInterval>
      <resolution>PT15M</resolution>
      <Point><position>1</position><price.amount>10</price.amount></Point>
      <Point><position>4</position><price.amount>12</price.amount></Point>
    </Period>
    <Period>
      <timeInterval><start>2026-08-24T23:00Z</start><end>2026-08-25T00:00Z</end></timeInterval>
      <resolution>PT30M</resolution>
      <Point><position>1</position><price.amount>20</price.amount></Point>
    </Period>
  </TimeSeries>
</Publication_MarketDocument>
"""


def test_multiple_periods_with_different_resolutions(es):
    recs = parse_document(SYNTHETIC.encode(), es)
    assert [(r.ts_utc.strftime("%H:%M"), r.resolution, r.price_original) for r in recs] == [
        ("22:00", "PT15M", D("10")),
        ("22:15", "PT15M", D("10")),
        ("22:30", "PT15M", D("10")),
        ("22:45", "PT15M", D("12")),
        ("23:00", "PT30M", D("20")),
        ("23:30", "PT30M", D("20")),
    ]


def test_build_request_single_day_es(es):
    req = build_request(es, date(2026, 8, 25), date(2026, 8, 25), token="T")
    assert req.url == "https://web-api.tp.entsoe.eu/api"
    assert req.params["periodStart"] == "202608242200"
    assert req.params["periodEnd"] == "202608252200"
    assert req.params["in_Domain"] == req.params["out_Domain"] == "10YES-REE------0"
    assert req.params["documentType"] == "A44"
    assert req.params["securityToken"] == "T"


def test_build_request_window_ro_uses_cet_and_dst(ro):
    req = build_request(ro, date(2026, 3, 26), date(2026, 3, 30), token="T")
    assert req.params["periodStart"] == "202603252300"  # invierno: 23:00Z
    assert req.params["periodEnd"] == "202603302200"  # verano: 22:00Z
    assert req.params["in_Domain"] == "10YRO-TEL------P"


def test_build_request_rejects_inverted_range(es):
    with pytest.raises(ValueError):
        build_request(es, date(2026, 8, 25), date(2026, 8, 24), token="T")
