import json
from pathlib import Path

import pytest

from dayahead.config import DEFAULT_SOURCES

FIXTURES = Path(__file__).parent / "fixtures"


def load_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def load_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def load_json(name: str) -> dict:
    return json.loads(load_text(name))


def cfg(country: str):
    return next(c for c in DEFAULT_SOURCES if c.country_code == country)


@pytest.fixture
def es():
    return cfg("ES")


@pytest.fixture
def ro():
    return cfg("RO")


@pytest.fixture
def de():
    return cfg("DE")


@pytest.fixture
def pl():
    return cfg("PL")
