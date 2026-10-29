"""Static configuration: pilot period, auction gate closures and data paths."""

from dataclasses import dataclass
from datetime import date, time, timedelta
from pathlib import Path

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ACTUALS_FILE = DATA_DIR / "actuals.json"
FORECASTS_FILE = DATA_DIR / "forecasts.json"

UK_TZ = "Europe/London"

# Pilot scope: purchase decisions taken in January 2026. A decision on day D-1
# buys power for delivery day D, so delivery days run from 2 Jan to 1 Feb.
DECISION_START = date(2026, 1, 1)
DECISION_END = date(2026, 1, 31)
DELIVERY_START = date(2026, 1, 2)
DELIVERY_END = date(2026, 2, 1)

# Trailing statistics (forecast correction, uncertainty band) only use outturn
# that was known at decision time, so the snapshot includes a warm-up period of
# history before the first delivery day.
WARMUP_DAYS = 14
CORRECTION_WINDOW_DAYS = 14
BAND_WINDOW_DAYS = 14
HISTORY_START = DELIVERY_START - timedelta(days=WARMUP_DAYS)

# The correction method and window were chosen on deliveries before this date
# and are reported separately on the days from it onwards, which the choice never saw.
VALIDATION_SPLIT = date(2026, 1, 17)

# Forecast wind levels (MW) for the "error by wind level" breakdown.
LEVEL_EDGES_MW = [0, 5000, 10000, 15000, 20000, 30000]


@dataclass(frozen=True)
class Auction:
    id: str
    name: str
    exchange: str
    gate_closure: time  # UK local time on D-1
    granularity: str


# GB day-ahead auctions (gate closures in UK local time on the day before delivery).
AUCTIONS: dict[str, Auction] = {
    a.id: a
    for a in (
        Auction("epex-60", "EPEX GB 60-min auction", "EPEX SPOT", time(9, 20), "hourly"),
        Auction("n2ex-60", "N2EX GB hourly auction", "Nord Pool", time(9, 50), "hourly"),
        Auction("epex-30", "EPEX GB 30-min auction", "EPEX SPOT", time(15, 30), "half-hourly"),
    )
}
DEFAULT_AUCTION = "epex-60"

# Minutes the trading desk needs between reading the forecast and submitting bids.
DEFAULT_PREP_MINUTES = 30
