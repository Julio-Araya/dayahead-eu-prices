import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path

from dayahead.models import PriceRecord
from dayahead.publish import build_ingest_request, build_payloads, encode_body, sign, verify

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "hmac_vectors.json").read_text(encoding="utf-8"))["vectors"]


def test_vectors_match():
    for v in VECTORS:
        assert "sha256=" + sign(v["secret"], v["timestamp"], v["nonce"], v["body"].encode("utf-8")) == v["signature"]
        assert verify(v["secret"], v["timestamp"], v["nonce"], v["body"].encode("utf-8"), v["signature"])


def test_verify_rejects_tampering_and_skew():
    v = VECTORS[0]
    body = v["body"].encode("utf-8")
    assert not verify(v["secret"], v["timestamp"], v["nonce"], body + b" ", v["signature"])
    assert not verify("otro", v["timestamp"], v["nonce"], body, v["signature"])
    assert not verify(v["secret"], v["timestamp"], "otro-nonce", body, v["signature"])
    assert verify(v["secret"], v["timestamp"], v["nonce"], body, v["signature"], now=v["timestamp"] + 299)
    assert not verify(v["secret"], v["timestamp"], v["nonce"], body, v["signature"], now=v["timestamp"] + 301)


def test_encode_body_is_canonical():
    assert encode_body({"b": D("1.50"), "a": date(2026, 8, 25), "t": datetime(2026, 8, 24, 22, tzinfo=timezone.utc)}) == \
        b'{"a":"2026-08-25","b":"1.50","t":"2026-08-24T22:00:00Z"}'
    assert encode_body({"n": None, "s": "ñ"}) == '{"n":null,"s":"ñ"}'.encode("utf-8")


def _rec(i):
    return PriceRecord("PL", datetime(2026, 8, 24, 22, tzinfo=timezone.utc) + timedelta(minutes=15 * i), "PT15M", date(2026, 8, 25), D("689.72"), "PLN", "pse",
                       datetime(2026, 8, 24, 11, 46, 21, 852000, tzinfo=timezone.utc), D("160.1951"), D("4.3055"), date(2026, 8, 25))


def test_build_payloads_chunks_and_control_in_first_part():
    control = [{"country_code": "PL", "business_date_local": date(2026, 8, 25), "expected_slots": 96, "loaded_slots": 96, "status": "complete"}]
    parts = build_payloads("run1", datetime(2026, 8, 26, 16, tzinfo=timezone.utc), [_rec(i) for i in range(5)], control, max_rows=2)
    assert [len(p["prices"]) for p in parts] == [2, 2, 1]
    assert [p["part"] for p in parts] == [1, 2, 3] and all(p["parts"] == 3 for p in parts)
    assert parts[0]["load_control"] == control and parts[1]["load_control"] == []
    body = encode_body(parts[0])
    decoded = json.loads(body)
    assert decoded["prices"][0]["price_eur"] == "160.1951"
    assert decoded["prices"][0]["ts_utc"] == "2026-08-24T22:00:00Z"
    assert decoded["prices"][0]["source_published_at"] == "2026-08-24T11:46:21.852000Z"


def test_build_payloads_empty_run_still_sends_control():
    parts = build_payloads("run1", datetime(2026, 8, 26, 16, tzinfo=timezone.utc), [], [{"x": 1}])
    assert len(parts) == 1 and parts[0]["prices"] == [] and parts[0]["load_control"] == [{"x": 1}]


def test_build_ingest_request_headers():
    req = build_ingest_request("https://api.example.com/", "s", {"run_id": "r"}, 1756224000, "n")
    assert req.url == "https://api.example.com/v1/ingest"
    assert req.headers["X-Timestamp"] == "1756224000" and req.headers["X-Nonce"] == "n"
    assert req.headers["X-Signature"] == "sha256=" + sign("s", 1756224000, "n", req.body)
    assert req.body == b'{"run_id":"r"}'
