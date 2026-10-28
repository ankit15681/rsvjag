"""Thin client for the Elexon BMRS Insights API (FUELHH and WINDFOR streams)."""

from datetime import date, datetime, time, timedelta, timezone

import httpx

from .config import ELEXON_BASE_URL

TIMEOUT = httpx.Timeout(60.0)


def _get(path: str, params: dict) -> list[dict]:
    resp = httpx.get(f"{ELEXON_BASE_URL}{path}", params=params, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_wind_actuals(start: date, end: date) -> list[dict]:
    """Half-hourly outturn wind generation (MW) for settlement dates start..end inclusive."""
    rows = _get(
        "/datasets/FUELHH/stream",
        {"settlementDateFrom": start.isoformat(), "settlementDateTo": end.isoformat(), "fuelType": "WIND"},
    )
    return [
        {"startTime": r["startTime"], "generation": r["generation"]}
        for r in rows
        if r.get("fuelType") == "WIND"
    ]


def fetch_wind_forecasts(publish_start: date, publish_end: date, chunk_days: int = 7) -> list[dict]:
    """Every WINDFOR vintage published between publish_start 00:00 and publish_end 24:00 UTC.

    Requested in weekly chunks to keep individual responses small.
    """
    out: list[dict] = []
    cursor = datetime.combine(publish_start, time(), tzinfo=timezone.utc)
    stop = datetime.combine(publish_end + timedelta(days=1), time(), tzinfo=timezone.utc)
    while cursor < stop:
        chunk_end = min(cursor + timedelta(days=chunk_days), stop)
        rows = _get(
            "/datasets/WINDFOR/stream",
            {
                "publishDateTimeFrom": cursor.isoformat().replace("+00:00", "Z"),
                # The API treats the upper bound as inclusive; step back a second to avoid duplicates.
                "publishDateTimeTo": (chunk_end - timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
            },
        )
        out.extend(
            {"publishTime": r["publishTime"], "startTime": r["startTime"], "generation": r["generation"]}
            for r in rows
        )
        cursor = chunk_end
    return out
