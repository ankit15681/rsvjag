"""Forecast selection and accuracy analytics.

All functions are pure: they take the actuals / forecasts DataFrames from
``store`` and return DataFrames or plain dicts, which keeps them easy to test.

Conventions
-----------
* Times are UTC internally; delivery days are UK-local calendar days.
* error = forecast - actual (MW). Positive error means wind under-delivered,
  i.e. a shortfall the desk has to cover from other sources.
* A forecast is compared with the half-hourly actual whose startTime equals the
  forecast's (hourly) startTime.
"""

from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from .config import UK_TZ, Auction


# --- Decision timing ------------------------------------------------------------------------


def decision_time(delivery_day: date, auction: Auction, prep_minutes: int) -> pd.Timestamp:
    """Latest moment (UTC) the desk can read a forecast before bidding for ``delivery_day``."""
    local = datetime.combine(delivery_day - timedelta(days=1), auction.gate_closure) - timedelta(
        minutes=prep_minutes
    )
    return pd.Timestamp(local).tz_localize(UK_TZ).tz_convert("UTC")


def delivery_window(day: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    """UTC bounds [start, end) of a UK-local delivery day (handles 23h/25h clock-change days)."""
    start = pd.Timestamp(day).tz_localize(UK_TZ)
    end = pd.Timestamp(day + timedelta(days=1)).tz_localize(UK_TZ)
    return start.tz_convert("UTC"), end.tz_convert("UTC")


def _uk_day(ts: pd.Series) -> pd.Series:
    return ts.dt.tz_convert(UK_TZ).dt.date


# --- Forecast selection ---------------------------------------------------------------------


def decision_forecasts(
    forecasts: pd.DataFrame,
    actuals: pd.DataFrame,
    auction: Auction,
    prep_minutes: int,
    start_day: date,
    end_day: date,
) -> pd.DataFrame:
    """For each hour of each delivery day, the latest forecast published by the decision time.

    Returns one row per target hour with columns: delivery_day, target_time,
    publish_time, horizon_h, forecast, actual, error.
    """
    lo, _ = delivery_window(start_day)
    _, hi = delivery_window(end_day)
    df = forecasts[(forecasts["target_time"] >= lo) & (forecasts["target_time"] < hi)].copy()
    df["delivery_day"] = _uk_day(df["target_time"])

    cutoffs = {d: decision_time(d, auction, prep_minutes) for d in df["delivery_day"].unique()}
    df = df[df["publish_time"] <= df["delivery_day"].map(cutoffs)]

    # Latest eligible vintage per target hour.
    df = df.sort_values("publish_time").groupby("target_time", as_index=False).tail(1)
    df = df.merge(actuals, on="target_time", how="left")
    df["error"] = df["forecast"] - df["actual"]
    cols = ["delivery_day", "target_time", "publish_time", "horizon_h", "forecast", "actual", "error"]
    return df[cols].sort_values("target_time").reset_index(drop=True)


def _known_history(dec: pd.DataFrame, day: date, window_days: int) -> pd.DataFrame:
    """Rows for delivery days whose full outturn was known when deciding for ``day``.

    The decision for D is made on the morning of D-1, so D-2 is the latest
    complete day of outturn.
    """
    last = day - timedelta(days=2)
    rows = dec[(dec["delivery_day"] <= last) & (dec["delivery_day"] > last - timedelta(days=window_days))]
    return rows.dropna(subset=["actual"])


def scale_adjust(dec: pd.DataFrame, window_days: int, min_hours: int = 48) -> pd.DataFrame:
    """Correct each day's forecast with a straight line fitted on known history.

    For delivery day D, fits ``actual = intercept + slope * forecast`` on the
    previous ``window_days`` of known outturn and applies it to D's forecast.
    A slope below 1 captures the forecast overshooting more on windy days.
    Days with fewer than ``min_hours`` of history are left uncorrected.

    Adds ``raw_forecast``, ``corr_slope``, ``corr_intercept`` and ``correction``
    (raw minus corrected); ``forecast``/``error`` become corrected.
    """
    fits = {}
    for day in dec["delivery_day"].unique():
        hist = _known_history(dec, day, window_days)
        if len(hist) >= min_hours and hist["forecast"].std() > 0:
            slope, intercept = np.polyfit(hist["forecast"], hist["actual"], 1)
            fits[day] = (float(slope), float(intercept))
        else:
            fits[day] = (1.0, 0.0)
    out = dec.copy()
    out["raw_forecast"] = out["forecast"]
    out["corr_slope"] = out["delivery_day"].map(lambda k: fits[k][0])
    out["corr_intercept"] = out["delivery_day"].map(lambda k: fits[k][1])
    out["forecast"] = (out["corr_intercept"] + out["corr_slope"] * out["raw_forecast"]).clip(lower=0)
    out["correction"] = out["raw_forecast"] - out["forecast"]
    out["error"] = out["forecast"] - out["actual"]
    return out


def add_reliability_band(dec: pd.DataFrame, confidence: float, window_days: int) -> pd.DataFrame:
    """Add ``reliable``/``upper`` columns from trailing error quantiles of known history.

    ``reliable`` = forecast - q(confidence): wind output expected to be exceeded
    with probability ``confidence``. The gap to the forecast is the shortfall buffer.
    """
    q = {}
    for day in dec["delivery_day"].unique():
        hist = _known_history(dec, day, window_days)
        q[day] = error_quantiles(hist["error"], confidence) if len(hist) else (np.nan, np.nan)
    out = dec.copy()
    out["q_lo"] = out["delivery_day"].map(lambda k: q[k][0])
    out["q_hi"] = out["delivery_day"].map(lambda k: q[k][1])
    out["reliable"] = out["forecast"] - out["q_hi"]
    out["upper"] = out["forecast"] - out["q_lo"]
    return out


def band_coverage(dec: pd.DataFrame) -> dict:
    """How often outturn actually met the reliable level (should be close to the confidence)."""
    d = dec.dropna(subset=["actual", "reliable"])
    if d.empty:
        return {"n": 0}
    return {
        "n": int(len(d)),
        "reliable_hit_pct": float(100 * (d["actual"] >= d["reliable"]).mean()),
        "within_band_pct": float(100 * ((d["actual"] >= d["reliable"]) & (d["actual"] <= d["upper"])).mean()),
        "mean_buffer_mw": float(d["q_hi"].mean()),
    }


def all_vintages(forecasts: pd.DataFrame, actuals: pd.DataFrame, lo: pd.Timestamp, hi: pd.Timestamp) -> pd.DataFrame:
    """Every forecast vintage for targets in [lo, hi), joined to actuals."""
    df = forecasts[(forecasts["target_time"] >= lo) & (forecasts["target_time"] < hi)]
    df = df[df["horizon_h"] >= 0].merge(actuals, on="target_time", how="inner")
    df["error"] = df["forecast"] - df["actual"]
    return df


# --- Error statistics -----------------------------------------------------------------------


def error_metrics(df: pd.DataFrame) -> dict:
    """Headline accuracy metrics for rows with both forecast and actual."""
    d = df.dropna(subset=["actual", "forecast"])
    if d.empty:
        return {"n": 0}
    err = d["error"].to_numpy()
    mean_actual = float(d["actual"].mean())
    mae = float(np.abs(err).mean())
    return {
        "n": int(len(d)),
        "mae": mae,
        "rmse": float(np.sqrt((err**2).mean())),
        "bias": float(err.mean()),
        "nmae_pct": 100 * mae / mean_actual if mean_actual else None,
        "p10": float(np.quantile(err, 0.10)),
        "p50": float(np.quantile(err, 0.50)),
        "p90": float(np.quantile(err, 0.90)),
        "max_shortfall": float(err.max()),
        "max_surplus": float(err.min()),
        "mean_actual": mean_actual,
        "mean_forecast": float(d["forecast"].mean()),
        "corr": _corr(d["forecast"], d["actual"]),
    }


def _corr(a: pd.Series, b: pd.Series) -> float | None:
    if len(a) < 3 or a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def _grouped_stats(df: pd.DataFrame, key: str | pd.Series) -> pd.DataFrame:
    d = df.dropna(subset=["error"])
    g = d.groupby(key)["error"]
    return pd.DataFrame(
        {
            "n": g.size(),
            "mae": g.apply(lambda e: e.abs().mean()),
            "bias": g.mean(),
            "p10": g.quantile(0.10),
            "p90": g.quantile(0.90),
        }
    )


def daily_stats(dec: pd.DataFrame) -> list[dict]:
    """Per delivery day: MAE, bias and energy (GWh) forecast vs actual."""
    d = dec.dropna(subset=["actual"])
    stats = _grouped_stats(d, "delivery_day")
    energy = d.groupby("delivery_day")[["forecast", "actual"]].sum() / 1000  # hourly MW -> GWh
    out = stats.join(energy.rename(columns={"forecast": "forecast_gwh", "actual": "actual_gwh"}))
    return [{"day": k.isoformat(), **_clean(v)} for k, v in out.to_dict("index").items()]


def level_stats(dec: pd.DataFrame, edges_mw: list[int]) -> list[dict]:
    """Error statistics grouped by forecast wind level (MW bins)."""
    d = dec.dropna(subset=["error"])
    level = pd.cut(d["forecast"], bins=edges_mw, right=False)
    stats = _grouped_stats(d.assign(level=level), "level")
    return [
        {"from": int(k.left), "to": int(k.right), **_clean(v)}
        for k, v in stats.to_dict("index").items()
        if v["n"] > 0
    ]


def hour_of_day_stats(dec: pd.DataFrame) -> list[dict]:
    hour = dec["target_time"].dt.tz_convert(UK_TZ).dt.hour
    stats = _grouped_stats(dec.assign(hour=hour), "hour")
    return [{"hour": int(k), **_clean(v)} for k, v in stats.to_dict("index").items()]


def horizon_stats(vintages: pd.DataFrame, bucket_h: int = 3, max_h: int = 66) -> list[dict]:
    """Error statistics bucketed by forecast horizon (hours between publish and target)."""
    d = vintages[vintages["horizon_h"] < max_h]
    bucket = (d["horizon_h"] // bucket_h * bucket_h).astype(int)
    stats = _grouped_stats(d.assign(bucket=bucket), "bucket")
    return [{"horizon_from": int(k), "horizon_to": int(k) + bucket_h, **_clean(v)} for k, v in stats.to_dict("index").items()]


def error_histogram(dec: pd.DataFrame, bin_mw: int = 500) -> list[dict]:
    err = dec["error"].dropna()
    if err.empty:
        return []
    lo = int(np.floor(err.min() / bin_mw) * bin_mw)
    hi = int(np.ceil(err.max() / bin_mw) * bin_mw) + bin_mw
    counts, edges = np.histogram(err, bins=np.arange(lo, hi + 1, bin_mw))
    return [{"from": int(a), "to": int(b), "count": int(c)} for a, b, c in zip(edges[:-1], edges[1:], counts)]


def error_quantiles(errors: pd.Series, confidence: float) -> tuple[float, float]:
    """Error quantiles at (1 - confidence) and confidence.

    The upper one is the shortfall not exceeded with probability ``confidence``:
    forecast minus it is wind output the desk can rely on at that confidence.
    """
    e = errors.dropna()
    return float(np.quantile(e, 1 - confidence)), float(np.quantile(e, confidence))


def _clean(d: dict) -> dict:
    """Make a row JSON-safe: numpy scalars to Python, NaN to None."""
    out = {}
    for k, v in d.items():
        if isinstance(v, np.integer):
            v = int(v)
        elif isinstance(v, (float, np.floating)):
            v = None if np.isnan(v) else float(v)
        out[k] = v
    return out
