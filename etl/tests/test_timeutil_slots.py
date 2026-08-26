from datetime import date, datetime, timedelta, timezone

import pytest

from dayahead.gaps.slots import expected_slots, expected_timestamps, find_gaps
from dayahead.timeutil import day_window_utc, local_date, parse_resolution

UTC = timezone.utc


def test_parse_resolution():
    assert parse_resolution("PT15M") == timedelta(minutes=15)
    assert parse_resolution("PT60M") == timedelta(hours=1)
    assert parse_resolution("PT1H") == timedelta(hours=1)
    with pytest.raises(ValueError):
        parse_resolution("P1D")
    with pytest.raises(ValueError):
        parse_resolution("")


def test_day_window_summer_madrid():
    start, end = day_window_utc(date(2026, 8, 25), "Europe/Madrid")
    assert start == datetime(2026, 8, 24, 22, tzinfo=UTC)
    assert end == datetime(2026, 8, 25, 22, tzinfo=UTC)


def test_day_window_cet_equals_madrid():
    assert day_window_utc(date(2026, 8, 25), "CET") == day_window_utc(date(2026, 8, 25), "Europe/Madrid")
    assert day_window_utc(date(2026, 1, 15), "CET") == day_window_utc(date(2026, 1, 15), "Europe/Madrid")


def test_day_window_spring_forward_is_23h():
    start, end = day_window_utc(date(2026, 3, 29), "Europe/Warsaw")
    assert start == datetime(2026, 3, 28, 23, tzinfo=UTC)
    assert end == datetime(2026, 3, 29, 22, tzinfo=UTC)
    assert end - start == timedelta(hours=23)


def test_day_window_fall_back_is_25h():
    start, end = day_window_utc(date(2025, 10, 26), "Europe/Berlin")
    assert end - start == timedelta(hours=25)


@pytest.mark.parametrize(
    "d, tz, res, n",
    [
        (date(2026, 8, 25), "Europe/Madrid", "PT15M", 96),
        (date(2026, 8, 25), "CET", "PT15M", 96),
        (date(2026, 8, 25), "Europe/Berlin", "PT60M", 24),
        (date(2026, 8, 25), "Europe/Warsaw", "PT15M", 96),
        (date(2026, 3, 29), "Europe/Madrid", "PT15M", 92),
        (date(2026, 3, 29), "Europe/Berlin", "PT60M", 23),
        (date(2025, 10, 26), "Europe/Warsaw", "PT15M", 100),
        (date(2025, 10, 26), "Europe/Berlin", "PT60M", 25),
    ],
)
def test_expected_slots(d, tz, res, n):
    assert expected_slots(d, tz, res) == n
    assert len(expected_timestamps(d, tz, res)) == n


def test_find_gaps_reports_missing_only():
    ts = expected_timestamps(date(2026, 8, 25), "Europe/Berlin", "PT60M")
    present = ts[:5] + ts[6:]
    assert find_gaps(present, date(2026, 8, 25), "Europe/Berlin", "PT60M") == [ts[5]]
    assert find_gaps(ts, date(2026, 8, 25), "Europe/Berlin", "PT60M") == []


def test_find_gaps_accepts_naive_as_utc():
    ts = expected_timestamps(date(2026, 8, 25), "Europe/Berlin", "PT60M")
    naive = [t.replace(tzinfo=None) for t in ts]
    assert find_gaps(naive, date(2026, 8, 25), "Europe/Berlin", "PT60M") == []


def test_local_date_crosses_midnight():
    assert local_date(datetime(2026, 8, 24, 22, tzinfo=UTC), "Europe/Madrid") == date(2026, 8, 25)
    assert local_date(datetime(2026, 8, 24, 21, 59, tzinfo=UTC), "Europe/Madrid") == date(2026, 8, 24)
