from datetime import date, datetime, timezone
from decimal import Decimal as D

import pytest

from dayahead.adapters.pse import build_request, fetch_all, parse_page
from dayahead.control import DayStatus, evaluate_day
from dayahead.models import SourceError

from conftest import load_json

UTC = timezone.utc


def test_build_request_single_and_range(pl):
    r = build_request(pl, date(2026, 8, 25), date(2026, 8, 25))
    assert r.url == "https://api.raporty.pse.pl/api/rce-pln"
    assert r.params == {"$filter": "business_date eq '2026-08-25'"}
    r = build_request(pl, date(2026, 8, 23), date(2026, 8, 27))
    assert r.params == {"$filter": "business_date ge '2026-08-23' and business_date le '2026-08-27'"}


def test_ts_utc_is_interval_start(pl):
    recs, nxt = parse_page(load_json("pse_2026-08-25.json"), pl)
    assert nxt is None
    assert len(recs) == 96
    # dtime_utc "2026-08-24 22:15:00" es el fin: el inicio es 22:00Z
    assert recs[0].ts_utc == datetime(2026, 8, 24, 22, tzinfo=UTC)
    assert recs[0].price_original == D("689.72")
    assert recs[0].currency_original == "PLN"
    assert recs[0].business_date_local == date(2026, 8, 25)
    assert recs[0].source_published_at == datetime(2026, 8, 24, 11, 46, 21, 852000, tzinfo=UTC)
    assert recs[-1].ts_utc == datetime(2026, 8, 25, 21, 45, tzinfo=UTC)
    assert recs[-1].price_original == D("571.57")
    assert {r.business_date_local for r in recs} == {date(2026, 8, 25)}
    ev = evaluate_day("PL", date(2026, 8, 25), pl.market_tz, pl.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == 96


@pytest.mark.parametrize("name, d, n", [("pse_dst_2026-03-29.json", date(2026, 3, 29), 92), ("pse_dst_2025-10-26.json", date(2025, 10, 26), 100)])
def test_dst_days_match_source_business_date(pl, name, d, n):
    # parse_page verifica que el business_date derivado de market_tz coincide con el de la fuente
    recs, _ = parse_page(load_json(name), pl)
    assert len(recs) == n
    assert {r.business_date_local for r in recs} == {d}
    ev = evaluate_day("PL", d, pl.market_tz, pl.resolution, recs)
    assert ev.status == DayStatus.COMPLETE and ev.expected == n


def test_empty_day_is_empty_not_error(pl):
    assert parse_page({"value": []}, pl) == ([], None)


def test_missing_value_key_is_source_error(pl):
    with pytest.raises(SourceError):
        parse_page({"error": "x"}, pl)


def test_bad_row_is_source_error(pl):
    with pytest.raises(SourceError):
        parse_page({"value": [{"dtime_utc": "nope", "rce_pln": 1}]}, pl)


def test_fetch_all_follows_next_link(pl):
    page1 = load_json("pse_range_30d.json")
    assert "nextLink" in page1
    page2 = load_json("pse_2026-08-25.json")  # sin nextLink: termina
    calls = []

    def fetch(url, params):
        calls.append((url, params))
        return page1 if len(calls) == 1 else page2

    req = build_request(pl, date(2026, 7, 27), date(2026, 8, 25))
    recs = fetch_all(req, pl, fetch)
    assert len(calls) == 2
    assert calls[0] == (req.url, req.params)
    assert calls[1] == (page1["nextLink"], None)
    assert len(recs) == 100 + 96
    assert recs == sorted(recs, key=lambda r: r.ts_utc)


def test_fetch_all_dedups_overlapping_pages(pl):
    page = load_json("pse_2026-08-25.json")
    looped = dict(page, nextLink="https://example/next")
    calls = []

    def fetch(url, params):
        calls.append(url)
        return looped if len(calls) == 1 else page

    recs = fetch_all(build_request(pl, date(2026, 8, 25), date(2026, 8, 25)), pl, fetch)
    assert len(recs) == 96


def test_fetch_all_guards_against_pagination_loops(pl):
    page = dict(load_json("pse_2026-08-25.json"), nextLink="https://example/next")
    with pytest.raises(SourceError):
        fetch_all(build_request(pl, date(2026, 8, 25), date(2026, 8, 25)), pl, lambda u, p: page, max_pages=3)
