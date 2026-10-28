"""Refresh the bundled data snapshot from Elexon.

    python -m app.ingest

The pilot period is historical, so the API serves a committed snapshot instead of
calling Elexon on every request. This keeps the app fast, deterministic and
independent of Elexon availability.
"""

import json
from datetime import timedelta

from . import config
from .elexon import fetch_wind_actuals, fetch_wind_forecasts


def main() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Pad by a few days so every UK-local delivery day, and every forecast vintage
    # that could cover the first warm-up day (horizons reach ~66h), is included.
    actuals = fetch_wind_actuals(
        config.HISTORY_START - timedelta(days=1), config.DELIVERY_END + timedelta(days=1)
    )
    forecasts = fetch_wind_forecasts(config.HISTORY_START - timedelta(days=3), config.DELIVERY_END)

    actuals.sort(key=lambda r: r["startTime"])
    forecasts.sort(key=lambda r: (r["publishTime"], r["startTime"]))

    for path, rows in ((config.ACTUALS_FILE, actuals), (config.FORECASTS_FILE, forecasts)):
        path.write_text(json.dumps(rows, separators=(",", ":")))
        print(f"wrote {len(rows):>6} rows -> {path}")


if __name__ == "__main__":
    main()
