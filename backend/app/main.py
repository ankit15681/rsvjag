"""HTTP API for the wind forecast decision-support app."""

from datetime import date
from functools import lru_cache
from typing import Annotated

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import analytics, config, store

app = FastAPI(title="GB Wind Forecast Insight API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

AuctionId = Annotated[str, Query(description="Auction id, see /api/meta")]
Prep = Annotated[int, Query(ge=0, le=240, description="Minutes before gate closure the decision is made")]
Confidence = Annotated[float, Query(ge=0.5, le=0.99, description="One-sided confidence for the reliable-wind band")]
Adjust = Annotated[bool, Query(description="Apply trailing bias correction to the forecast")]


def _auction(auction_id: str) -> config.Auction:
    try:
        return config.AUCTIONS[auction_id]
    except KeyError:
        raise HTTPException(404, f"Unknown auction '{auction_id}'")


def _check_day(day: date) -> date:
    if not config.DELIVERY_START <= day <= config.DELIVERY_END:
        raise HTTPException(422, f"Delivery day must be within {config.DELIVERY_START}..{config.DELIVERY_END}")
    return day


def _iso(ts: pd.Timestamp) -> str:
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


@lru_cache(maxsize=64)
def _decisions(auction_id: str, prep: int, adjust: bool, confidence: float) -> pd.DataFrame:
    """Decision-time forecasts from the start of the warm-up history (cached per parameter set).

    Use ``_period`` to restrict to delivery days in the pilot.
    """
    dec = analytics.decision_forecasts(
        store.forecasts(), store.actuals(), config.AUCTIONS[auction_id], prep,
        config.HISTORY_START, config.DELIVERY_END,
    )
    if adjust:
        dec = analytics.bias_adjust(dec, config.BIAS_WINDOW_DAYS)
    else:
        dec = dec.assign(raw_forecast=dec["forecast"], correction=0.0)
    return analytics.add_reliability_band(dec, confidence, config.BAND_WINDOW_DAYS)


def _period(dec: pd.DataFrame, start: date | None, end: date | None) -> pd.DataFrame:
    start, end = _check_day(start or config.DELIVERY_START), _check_day(end or config.DELIVERY_END)
    if start > end:
        raise HTTPException(422, "start must not be after end")
    return dec[(dec["delivery_day"] >= start) & (dec["delivery_day"] <= end)]


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    f, a = store.forecasts(), store.actuals()
    return {
        "auctions": [
            {"id": x.id, "name": x.name, "exchange": x.exchange,
             "gate_closure": x.gate_closure.strftime("%H:%M"), "granularity": x.granularity}
            for x in config.AUCTIONS.values()
        ],
        "default_auction": config.DEFAULT_AUCTION,
        "default_prep_minutes": config.DEFAULT_PREP_MINUTES,
        "decision_period": {"start": config.DECISION_START.isoformat(), "end": config.DECISION_END.isoformat()},
        "delivery_period": {"start": config.DELIVERY_START.isoformat(), "end": config.DELIVERY_END.isoformat()},
        "data": {
            "source": "Elexon BMRS: FUELHH (fuelType=WIND) and WINDFOR",
            "actual_rows": int(len(a)),
            "forecast_rows": int(len(f)),
            "forecast_vintages": int(f["publish_time"].nunique()),
        },
    }


@app.get("/api/day")
def day_view(
    day: Annotated[date, Query(alias="date")],
    auction: AuctionId = config.DEFAULT_AUCTION,
    prep: Prep = config.DEFAULT_PREP_MINUTES,
    confidence: Confidence = 0.9,
    adjust: Adjust = True,
) -> dict:
    """Everything the desk sees for one delivery day: the forecast it would have used,
    a reliable-wind band from past errors, actual outturn and how the forecast evolved."""
    _check_day(day)
    auc = _auction(auction)
    dec = _decisions(auc.id, prep, adjust, confidence)
    rows = dec[dec["delivery_day"] == day]
    if rows.empty:
        raise HTTPException(404, "No forecast available at decision time for this day")

    cutoff = analytics.decision_time(day, auc, prep)
    lo, hi = analytics.delivery_window(day)

    act = store.actuals()
    act = act[(act["target_time"] >= lo) & (act["target_time"] < hi)]

    f = store.forecasts()
    vint = f[(f["target_time"] >= lo) & (f["target_time"] < hi) & (f["publish_time"] < hi)]
    used_pub = rows["publish_time"].max()
    vintages = [
        {
            "publish_time": _iso(pub),
            "available_at_decision": bool(pub <= cutoff),
            "used": bool(pub == used_pub),
            "points": [{"t": _iso(t), "v": float(v)} for t, v in zip(g["target_time"], g["forecast"])],
        }
        for pub, g in vint.groupby("publish_time")
    ]

    # What the latest forecast before delivery would have scored (the cost of deciding a day ahead).
    latest = analytics.all_vintages(vint[vint["publish_time"] <= lo], act, lo, hi)
    latest = latest[latest["publish_time"] == latest["publish_time"].max()] if not latest.empty else latest

    def num(x) -> float | None:
        return None if pd.isna(x) else float(x)

    return {
        "date": day.isoformat(),
        "auction": auc.id,
        "confidence": confidence,
        "adjusted": adjust,
        "decision_time": _iso(cutoff),
        "forecast_publish_time": _iso(used_pub),
        "horizon_h": {"min": float(rows["horizon_h"].min()), "max": float(rows["horizon_h"].max())},
        "correction_mw": float(rows["correction"].iloc[0]),
        "buffer_mw": num(rows["q_hi"].iloc[0]),
        "series": [
            {"t": _iso(r.target_time), "raw_forecast": r.raw_forecast, "forecast": r.forecast,
             "reliable": num(r.reliable), "upper": num(r.upper), "actual": num(r.actual)}
            for r in rows.itertuples()
        ],
        "actuals": [{"t": _iso(t), "v": float(v)} for t, v in zip(act["target_time"], act["actual"])],
        "vintages": vintages,
        "summary": {
            "forecast_gwh": float(rows["forecast"].sum() / 1000),
            "raw_forecast_gwh": float(rows["raw_forecast"].sum() / 1000),
            "reliable_gwh": num(rows["reliable"].clip(lower=0).sum(min_count=1) / 1000),
            "actual_gwh": float(act["actual"].sum() * 0.5 / 1000) if len(act) else None,
            "peak_forecast_mw": float(rows["forecast"].max()),
            "min_forecast_mw": float(rows["forecast"].min()),
        },
        "metrics": analytics.error_metrics(rows),
        "official_metrics": analytics.error_metrics(
            rows.assign(forecast=rows["raw_forecast"], error=rows["raw_forecast"] - rows["actual"])
        ),
        "coverage": analytics.band_coverage(rows),
        "latest_before_delivery": {
            "publish_time": _iso(latest["publish_time"].iloc[0]),
            "metrics": analytics.error_metrics(latest),
        } if not latest.empty else None,
    }


@app.get("/api/accuracy")
def accuracy(
    auction: AuctionId = config.DEFAULT_AUCTION,
    prep: Prep = config.DEFAULT_PREP_MINUTES,
    confidence: Confidence = 0.9,
    adjust: Adjust = True,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    """Accuracy of the forecasts actually available at decision time, over a date range."""
    auc = _auction(auction)
    d = _period(_decisions(auc.id, prep, adjust, confidence), start, end).dropna(subset=["actual"])
    return {
        "auction": auc.id,
        "adjusted": adjust,
        "confidence": confidence,
        "metrics": analytics.error_metrics(d),
        "coverage": analytics.band_coverage(d),
        "horizon_h": {"min": float(d["horizon_h"].min()), "max": float(d["horizon_h"].max())} if len(d) else None,
        "daily": analytics.daily_stats(d),
        "by_hour": analytics.hour_of_day_stats(d),
        "histogram": analytics.error_histogram(d),
        "scatter": [{"forecast": f, "actual": a} for f, a in zip(d["forecast"], d["actual"])],
    }


@app.get("/api/horizon")
def horizon(
    start: date | None = None,
    end: date | None = None,
    bucket: Annotated[int, Query(ge=1, le=12)] = 3,
) -> dict:
    """How the official forecast's error grows with horizon, using every published vintage."""
    start, end = _check_day(start or config.DELIVERY_START), _check_day(end or config.DELIVERY_END)
    lo, _ = analytics.delivery_window(start)
    _, hi = analytics.delivery_window(end)
    v = analytics.all_vintages(store.forecasts(), store.actuals(), lo, hi)
    return {"bucket_h": bucket, "stats": analytics.horizon_stats(v, bucket_h=bucket)}


@app.get("/api/compare")
def compare(
    prep: Prep = config.DEFAULT_PREP_MINUTES,
    confidence: Confidence = 0.9,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    """Each auction's decision-time forecast, official vs bias-adjusted, side by side."""
    out = []
    for auc in config.AUCTIONS.values():
        for adjust in (False, True):
            d = _period(_decisions(auc.id, prep, adjust, confidence), start, end).dropna(subset=["actual"])
            out.append({
                "auction": auc.id,
                "name": auc.name,
                "gate_closure": auc.gate_closure.strftime("%H:%M"),
                "adjusted": adjust,
                "horizon_h": {"min": float(d["horizon_h"].min()), "max": float(d["horizon_h"].max())} if len(d) else None,
                "metrics": analytics.error_metrics(d),
                "coverage": analytics.band_coverage(d),
            })
    return {"confidence": confidence, "rows": out}
