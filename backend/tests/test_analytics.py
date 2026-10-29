from datetime import date, time

import numpy as np
import pandas as pd
import pytest

from app import analytics
from app.config import Auction

AUCTION = Auction("test", "Test auction", "Test", time(9, 20), "hourly")


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz="UTC")


def make_forecasts(rows: list[tuple[str, str, float]]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["publish_time", "target_time", "forecast"])
    df["publish_time"] = pd.to_datetime(df["publish_time"], utc=True)
    df["target_time"] = pd.to_datetime(df["target_time"], utc=True)
    df["horizon_h"] = (df["target_time"] - df["publish_time"]).dt.total_seconds() / 3600
    return df


def make_actuals(rows: list[tuple[str, float]]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["target_time", "actual"])
    df["target_time"] = pd.to_datetime(df["target_time"], utc=True)
    return df


class TestTiming:
    def test_decision_time_in_winter_is_gmt(self):
        assert analytics.decision_time(date(2026, 1, 15), AUCTION, 30) == ts("2026-01-14T08:50")

    def test_decision_time_in_summer_is_bst(self):
        assert analytics.decision_time(date(2026, 7, 15), AUCTION, 0) == ts("2026-07-14T08:20")

    def test_delivery_window_on_clock_change_day_is_23_hours(self):
        lo, hi = analytics.delivery_window(date(2026, 3, 29))
        assert (hi - lo) == pd.Timedelta(hours=23)


class TestDecisionForecasts:
    def test_picks_latest_vintage_published_before_cutoff(self):
        f = make_forecasts([
            ("2026-01-14T04:30", "2026-01-15T12:00", 1000),
            ("2026-01-14T07:30", "2026-01-15T12:00", 1100),  # latest before 08:50 cutoff
            ("2026-01-14T09:30", "2026-01-15T12:00", 1200),  # too late
        ])
        a = make_actuals([("2026-01-15T12:00", 900)])
        dec = analytics.decision_forecasts(f, a, AUCTION, 30, date(2026, 1, 15), date(2026, 1, 15))
        assert len(dec) == 1
        row = dec.iloc[0]
        assert row["forecast"] == 1100
        assert row["publish_time"] == ts("2026-01-14T07:30")
        assert row["error"] == 200

    def test_zero_prep_lets_a_forecast_published_at_gate_closure_count(self):
        f = make_forecasts([("2026-01-14T09:20", "2026-01-15T12:00", 1)])
        dec = analytics.decision_forecasts(f, make_actuals([]), AUCTION, 0, date(2026, 1, 15), date(2026, 1, 15))
        assert len(dec) == 1

    def test_missing_actual_gives_nan_error(self):
        f = make_forecasts([("2026-01-14T07:30", "2026-01-15T12:00", 1000)])
        dec = analytics.decision_forecasts(f, make_actuals([]), AUCTION, 30, date(2026, 1, 15), date(2026, 1, 15))
        assert np.isnan(dec.iloc[0]["error"])


def daily_decisions(errors: dict[date, float]) -> pd.DataFrame:
    """One decision row per day with a given error (forecast 10 GW)."""
    return pd.DataFrame([
        {"delivery_day": d, "target_time": ts(f"{d}T12:00"), "forecast": 10_000.0,
         "actual": 10_000.0 - e, "error": e}
        for d, e in errors.items()
    ])


def hourly_decisions(days: dict[date, list[tuple[float, float]]]) -> pd.DataFrame:
    """Decision rows from (forecast, actual) pairs per delivery day."""
    return pd.DataFrame([
        {"delivery_day": d, "target_time": ts(f"{d}T{h:02d}:00"), "forecast": f, "actual": a, "error": f - a}
        for d, pairs in days.items()
        for h, (f, a) in enumerate(pairs)
    ])


class TestNoLookAhead:
    def test_scale_correction_fits_line_on_known_history(self):
        # History follows actual = 1000 + 0.5 * forecast exactly.
        history = {date(2026, 1, d): [(f, 1000 + 0.5 * f) for f in (2000.0, 8000.0, 14000.0)] for d in (1, 2)}
        out = analytics.scale_adjust(hourly_decisions(history | {date(2026, 1, 4): [(10000.0, 0.0)]}), 7, min_hours=6)
        row = out[out["delivery_day"] == date(2026, 1, 4)].iloc[0]
        assert row["corr_slope"] == pytest.approx(0.5)
        assert row["corr_intercept"] == pytest.approx(1000)
        assert row["forecast"] == pytest.approx(6000)
        assert row["raw_forecast"] == 10000
        assert row["correction"] == pytest.approx(4000)

    def test_scale_correction_ignores_d_minus_1_and_later(self):
        clean = [(f, 1000 + 0.5 * f) for f in (2000.0, 8000.0, 14000.0)]
        wild = [(f, 0.0) for f in (2000.0, 8000.0, 14000.0)]  # would wreck the fit if used
        days = {date(2026, 1, 1): clean, date(2026, 1, 2): clean, date(2026, 1, 3): wild, date(2026, 1, 4): [(10000.0, 0.0)], date(2026, 1, 5): wild}
        out = analytics.scale_adjust(hourly_decisions(days), 7, min_hours=6)
        assert out[out["delivery_day"] == date(2026, 1, 4)].iloc[0]["forecast"] == pytest.approx(6000)

    def test_scale_correction_needs_enough_history(self):
        out = analytics.scale_adjust(hourly_decisions({date(2026, 1, 1): [(5000.0, 4000.0)], date(2026, 1, 3): [(5000.0, 0.0)]}), 7)
        assert (out["forecast"] == out["raw_forecast"]).all()
        assert (out["corr_slope"] == 1.0).all()

    def test_scale_correction_never_goes_negative(self):
        history = {date(2026, 1, d): [(f, max(0.0, f - 9000)) for f in (10000.0, 15000.0, 20000.0)] for d in (1, 2)}
        out = analytics.scale_adjust(hourly_decisions(history | {date(2026, 1, 4): [(1000.0, 0.0)]}), 7, min_hours=6)
        assert out[out["delivery_day"] == date(2026, 1, 4)].iloc[0]["forecast"] == 0

    def test_band_ignores_the_day_itself(self):
        dec = daily_decisions({date(2026, 1, d): 0.0 for d in range(1, 10)} | {date(2026, 1, 10): 50_000.0})
        out = analytics.add_reliability_band(dec, 0.9, window_days=14).set_index("delivery_day")
        assert out.loc[date(2026, 1, 10), "q_hi"] == 0.0


class TestLevelStats:
    def test_groups_by_forecast_level(self):
        dec = hourly_decisions({date(2026, 1, 1): [(3000.0, 2000.0), (4000.0, 4000.0), (12000.0, 9000.0)]})
        levels = analytics.level_stats(dec, [0, 5000, 10000, 15000])
        assert [(lv["from"], lv["n"]) for lv in levels] == [(0, 2), (10000, 1)]
        assert levels[0]["bias"] == pytest.approx(500)
        assert levels[1]["bias"] == pytest.approx(3000)


class TestMetrics:
    def test_error_metrics(self):
        df = pd.DataFrame({"forecast": [110.0, 90.0, 100.0], "actual": [100.0, 100.0, 100.0]})
        df["error"] = df["forecast"] - df["actual"]
        m = analytics.error_metrics(df)
        assert m["n"] == 3
        assert m["mae"] == pytest.approx(20 / 3)
        assert m["bias"] == pytest.approx(0.0)
        assert m["rmse"] == pytest.approx(np.sqrt(200 / 3))
        assert m["max_shortfall"] == 10 and m["max_surplus"] == -10

    def test_error_metrics_empty(self):
        df = pd.DataFrame({"forecast": [1.0], "actual": [np.nan], "error": [np.nan]})
        assert analytics.error_metrics(df) == {"n": 0}

    def test_band_coverage(self):
        df = pd.DataFrame({"actual": [5.0, 15.0, 25.0, 9.0], "reliable": [10.0] * 4, "upper": [20.0] * 4, "q_hi": [1.0] * 4})
        cov = analytics.band_coverage(df)
        assert cov["reliable_hit_pct"] == 50.0
        assert cov["within_band_pct"] == 25.0

    def test_histogram_counts_everything(self):
        df = pd.DataFrame({"error": [-600.0, -10.0, 0.0, 499.0, 1200.0]})
        hist = analytics.error_histogram(df, bin_mw=500)
        assert sum(b["count"] for b in hist) == 5
