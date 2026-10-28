"""API tests against the committed January 2026 snapshot."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_meta_lists_auctions():
    body = client.get("/api/meta").json()
    assert {a["id"] for a in body["auctions"]} == {"epex-60", "n2ex-60", "epex-30"}
    assert body["delivery_period"] == {"start": "2026-01-02", "end": "2026-02-01"}


def test_day_view_uses_forecast_published_before_decision():
    body = client.get("/api/day", params={"date": "2026-01-15", "auction": "epex-60", "prep": 30}).json()
    assert body["decision_time"] == "2026-01-14T08:50:00Z"
    assert body["forecast_publish_time"] <= body["decision_time"]
    assert len(body["series"]) == 24
    assert sum(v["used"] for v in body["vintages"]) == 1
    assert all(v["available_at_decision"] == (v["publish_time"] <= body["decision_time"]) for v in body["vintages"])


def test_raw_view_has_no_correction():
    body = client.get("/api/day", params={"date": "2026-01-15", "adjust": "false"}).json()
    assert body["correction_mw"] == 0
    assert all(p["forecast"] == p["raw_forecast"] for p in body["series"])


@pytest.mark.parametrize("params", [{"date": "2025-12-01"}, {"date": "2026-03-01"}])
def test_day_out_of_range_is_rejected(params):
    assert client.get("/api/day", params=params).status_code == 422


def test_unknown_auction_is_404():
    assert client.get("/api/accuracy", params={"auction": "nope"}).status_code == 404


def test_accuracy_covers_every_hour_of_january_deliveries():
    body = client.get("/api/accuracy").json()
    assert body["metrics"]["n"] == 31 * 24
    assert len(body["daily"]) == 31
    assert len(body["by_hour"]) == 24


def test_later_gate_closure_uses_shorter_horizons():
    rows = {(r["auction"], r["adjusted"]): r for r in client.get("/api/compare").json()["rows"]}
    assert rows[("epex-30", False)]["horizon_h"]["max"] < rows[("epex-60", False)]["horizon_h"]["max"]


def test_horizon_profile_is_bucketed():
    stats = client.get("/api/horizon", params={"bucket": 6}).json()["stats"]
    assert stats[0]["horizon_from"] == 0
    assert all(s["horizon_to"] - s["horizon_from"] == 6 for s in stats)
