"""Loads the data snapshot into DataFrames once per process."""

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

from . import config


def _read(path: Path) -> pd.DataFrame:
    return pd.DataFrame(json.loads(path.read_text()))


@lru_cache(maxsize=1)
def actuals() -> pd.DataFrame:
    """Columns: target_time (UTC), actual (MW). One row per half hour."""
    df = _read(config.ACTUALS_FILE)
    df = pd.DataFrame(
        {"target_time": pd.to_datetime(df["startTime"], utc=True), "actual": df["generation"].astype(float)}
    )
    return df.drop_duplicates("target_time", keep="last").sort_values("target_time").reset_index(drop=True)


@lru_cache(maxsize=1)
def forecasts() -> pd.DataFrame:
    """Columns: publish_time, target_time (UTC), forecast (MW), horizon_h. One row per vintage x hour."""
    df = _read(config.FORECASTS_FILE)
    df = pd.DataFrame(
        {
            "publish_time": pd.to_datetime(df["publishTime"], utc=True),
            "target_time": pd.to_datetime(df["startTime"], utc=True),
            "forecast": df["generation"].astype(float),
        }
    )
    df = df.drop_duplicates(["publish_time", "target_time"], keep="last")
    df["horizon_h"] = (df["target_time"] - df["publish_time"]).dt.total_seconds() / 3600
    return df.sort_values(["publish_time", "target_time"]).reset_index(drop=True)
