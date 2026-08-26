from decimal import Decimal as D

import pytest

from dayahead.transform.forward_fill import ForwardFillError, forward_fill_positions


def test_fills_omitted_positions_with_previous_value():
    pts = {1: D("10"), 2: D("11"), 5: D("12")}
    assert forward_fill_positions(pts, 6) == [D("10"), D("11"), D("11"), D("11"), D("12"), D("12")]


def test_complete_series_is_unchanged():
    pts = {i: D(i) for i in range(1, 5)}
    assert forward_fill_positions(pts, 4) == [D(1), D(2), D(3), D(4)]


def test_missing_position_one_is_an_error():
    with pytest.raises(ForwardFillError):
        forward_fill_positions({2: D("1")}, 4)


def test_position_beyond_expected_is_an_error():
    with pytest.raises(ForwardFillError):
        forward_fill_positions({1: D("1"), 7: D("2")}, 4)


def test_non_positive_expected_is_an_error():
    with pytest.raises(ForwardFillError):
        forward_fill_positions({1: D("1")}, 0)
