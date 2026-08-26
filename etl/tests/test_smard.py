from datetime import date, datetime, timezone
from decimal import Decimal as D

import pytest

from dayahead.adapters.smard import (
    block_request,
    blocks_for_range,
    index_request,
    parse_block,
    parse_blocks,
    parse_index,
    select_block,
)
from dayahead.control import DayStatus, evaluate_day
from dayahead.models import SourceError

from conftest import load_json

UTC = timezone.utc
AUG_BLOCK = 1787522400000  # 2026-08-23T22:00Z = lunes 24-ago 00:00 CEST
PREV_BLOCK = 1786917600000  # 2026-08-16T22:00Z
MAR_BLOCK = 1774220400000  # 2026-03-22T23:00Z (invierno)
OCT_BLOCK = 1760911200000  # 2025-10-19T22:00Z


def test_urls(de):
    assert index_request(de).url == "https://www.smard.de/app/chart_data/4169/DE/index_hour.json"
    assert block_request(de, AUG_BLOCK).url == f"https://www.smard.de/app/chart_data/4169/DE/4169_DE_hour_{AUG_BLOCK}.json"


def test_index_blocks_start_at_berlin_midnight_monday():
    ts = parse_index(load_json("smard_index.json"))
    assert len(ts) == 413
    assert ts == sorted(ts)
    assert {datetime.fromtimestamp(t / 1000, tz=UTC).hour for t in ts} == {22, 23}
    assert {datetime.fromtimestamp(t / 1000, tz=UTC).weekday() for t in ts} == {6}  # domingo en UTC


def test_select_block_is_greatest_leq():
    ts = parse_index(load_json("smard_index.json"))
    monday = 1787522400000
    assert select_block(ts, monday) == AUG_BLOCK
    assert select_block(ts, monday + 3600_000) == AUG_BLOCK
    assert select_block(ts, monday - 1) == PREV_BLOCK
    with pytest.raises(SourceError):
        select_block(ts, ts[0] - 1)


def test_blocks_for_range_spanning_two_weeks(de):
    ts = parse_index(load_json("smard_index.json"))
    assert blocks_for_range(ts, de, date(2026, 8, 22), date(2026, 8, 26)) == [PREV_BLOCK, AUG_BLOCK]
    assert blocks_for_range(ts, de, date(2026, 8, 25), date(2026, 8, 25)) == [AUG_BLOCK]


def test_parse_block_regular_day(de):
    recs = parse_block(load_json(f"smard_block_{AUG_BLOCK}.json"), de, date(2026, 8, 25), date(2026, 8, 25))
    assert len(recs) == 24
    assert recs[0].ts_utc == datetime(2026, 8, 24, 22, tzinfo=UTC)
    assert recs[0].price_original == D("152.34")
    assert recs[0].resolution == "PT60M"
    assert recs[0].business_date_local == date(2026, 8, 25)
    assert recs[0].source_published_at == datetime(2026, 8, 25, 12, 42, 45, 245000, tzinfo=UTC)
    assert {r.business_date_local for r in recs} == {date(2026, 8, 25)}


def test_parse_block_unpublished_day_yields_nothing_and_is_pending(de):
    recs = parse_block(load_json(f"smard_block_{AUG_BLOCK}.json"), de, date(2026, 8, 27), date(2026, 8, 27))
    assert recs == []
    ev = evaluate_day("DE", date(2026, 8, 27), de.market_tz, de.resolution, recs)
    assert ev.status == DayStatus.PENDING and ev.loaded == 0 and ev.expected == 24


def test_parse_block_spring_forward_23(de):
    recs = parse_block(load_json(f"smard_block_{MAR_BLOCK}.json"), de, date(2026, 3, 29), date(2026, 3, 29))
    assert len(recs) == 23
    ev = evaluate_day("DE", date(2026, 3, 29), de.market_tz, de.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == 23


def test_parse_block_fall_back_25(de):
    recs = parse_block(load_json(f"smard_block_{OCT_BLOCK}.json"), de, date(2025, 10, 26), date(2025, 10, 26))
    assert len(recs) == 25
    ev = evaluate_day("DE", date(2025, 10, 26), de.market_tz, de.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == 25


def test_parse_blocks_across_week_boundary(de):
    payloads = [load_json(f"smard_block_{PREV_BLOCK}.json"), load_json(f"smard_block_{AUG_BLOCK}.json")]
    recs = parse_blocks(payloads, de, date(2026, 8, 22), date(2026, 8, 26))
    assert len(recs) == 5 * 24
    assert recs[0].ts_utc == datetime(2026, 8, 21, 22, tzinfo=UTC)
    assert recs[-1].ts_utc == datetime(2026, 8, 26, 21, tzinfo=UTC)
    assert len({r.ts_utc for r in recs}) == len(recs)


def test_block_without_series_is_source_error(de):
    with pytest.raises(SourceError):
        parse_block({"meta_data": {}}, de, date(2026, 8, 25), date(2026, 8, 25))
