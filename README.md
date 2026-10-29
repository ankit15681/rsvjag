# Windward: day-ahead wind forecast briefing for GB power purchasing

Windward helps a UK utility's day-ahead trading desk answer two questions before each auction closes:

1. **What is the latest wind forecast I can use right now, and how much of it can I count on?**
2. **How accurate has that forecast been**, so the shortfall I might need to cover from other sources is a number rather than a guess?

The pilot covers GB national wind generation for purchase decisions made in **January 2026** (delivery days 2 January to 1 February), using Elexon BMRS data only.

**Live app:** _add the Vercel URL here after deploying_

## What the app shows

**Day-ahead briefing** (one delivery day at a time)
- The forecast run the desk would actually have had at decision time. Decision time is the auction's gate closure on D-1 minus the preparation time you choose.
- Expected wind energy, the level you can count on at 80, 90 or 95% confidence, and the shortfall to cover if wind disappoints.
- An hourly chart with the forecast, the reliable level and likely range, the actual generation, and optionally every other forecast run.
- A timeline of every forecast run for that day relative to the decision, plus whether waiting for a later run would have helped.
- A 31-day strip shaded by each day's forecast error, for quick navigation.

**Forecast accuracy** (whole period)
- Mean absolute error, RMSE, bias, 90th-percentile shortfall, worst hour, and how often the "reliable" level actually held.
- A comparison across the three GB day-ahead auctions (EPEX 60-min at 09:20, N2EX hourly at 09:50, EPEX 30-min at 15:30).
- Error against forecast horizon (0 to 66 h, using every run), error by day, error by hour of day, the error distribution, and forecast against actual.

Everything above is about the **official Elexon forecast**, which is what the brief asks the app to show and evaluate. That is the default view.

**Pilot insight** (optional, clearly labelled, off by default)
- A breakdown showing that the official forecast's overshoot grows with the amount of wind forecast.
- A corrected forecast the desk could use instead, with its accuracy measured on days the method was not chosen on. Switching on "Pilot insight: show corrected forecast" applies it across both views.

### Key findings (EPEX 09:20 auction, decision 30 minutes before gate closure)

**About the official forecast**
- **It runs high.** On average WINDFOR is 1,746 MW above metered output, so a desk taking it at face value would under-buy. The average error is 2,022 MW, and 1 hour in 10 the shortfall exceeds 4,154 MW.
- **The overshoot grows with wind.** It averages about 0.6 GW when under 5 GW is forecast and about 4.6 GW when over 20 GW is forecast. This fits wind farms being curtailed when the grid cannot take their output, because the forecast describes what turbines could produce.
- **Later auctions see better forecasts.** Error rises from about 1.65 GW for 0–6 h ahead to about 2.4 GW for 60 h or more. The 15:30 half-hourly auction uses a run 4 to 8 hours fresher than the 09:20 one, depending on preparation time. With 30 minutes of preparation, N2EX at 09:50 gets the same run as EPEX at 09:20, because the 09:30 run is published too late. With no preparation time it gets the fresher one.
- **The reliable band is reasonably calibrated.** It is built only from past errors, and the 90% level held in 87–89% of hours depending on the auction.

**Pilot insight: a corrected forecast**

Each day, fit `actual = a + b × forecast` on the previous 14 days of known outturn and apply it to the new forecast. The typical fit is about 1.8 GW + 0.73 × forecast, so a 20 GW forecast is lowered by about 3.6 GW and a 5 GW forecast barely moves.

| Average error | 2–16 Jan (method chosen here) | 17 Jan–1 Feb (unseen days) |
|---|---|---|
| Official forecast | 1,924 MW | 2,115 MW |
| Corrected forecast | 1,260 MW | 1,243 MW |
| Reduction | 34% | 41% |

Over the whole month the corrected forecast cuts the 90th-percentile shortfall from 4,154 MW to 2,350 MW. That is about 1.8 GW less backup the desk needs to hold to be 90% covered. Its reliable level held in 91–92% of hours.

How the method was chosen: a constant offset (7 and 14 days) and a straight-line fit (7 and 14 days) were compared on 2–16 January only. The 14-day line won for every auction and kept its lead on the unseen half. A band that widens with wind level was tried too and dropped: on the first half it held only 73–83% of the time instead of 90%, and on the unseen half it was no better than the simpler band.

## Running locally

### With Docker

```bash
docker compose up --build
```

Open http://localhost:8080. The API is also exposed at http://localhost:8000/docs.

### Without Docker

Backend (Python 3.12+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

Frontend (Node 22+), in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the backend on port 8000.

### Tests

```bash
cd backend && pytest
```

The tests cover decision-time selection (including BST and clock-change days), the no-look-ahead rules for the corrected forecast and the uncertainty band, the error metrics, and the API contract against the bundled data. GitHub Actions runs the backend tests and the frontend type-check and build on every push.

### Refreshing the data

The pilot period is in the past, so the app serves a committed snapshot in `backend/data/`. To rebuild it from Elexon:

```bash
cd backend && python -m app.ingest
```

## Deployment (Vercel)

The repo deploys as one Vercel project: the React build is served as static files, and `api/index.py` runs the FastAPI app as a Python serverless function. `vercel.json` routes `/api/*` to it and bundles `backend/app` and `backend/data` with the function. Import the GitHub repo in Vercel and deploy with no extra settings.

## Repository layout

```
.
├── api/index.py              Vercel entry point; imports the FastAPI app from backend/
├── backend/
│   ├── app/
│   │   ├── config.py         Pilot dates, auction gate closures, analysis windows
│   │   ├── elexon.py         Client for the Elexon FUELHH and WINDFOR stream endpoints
│   │   ├── ingest.py         Builds the data snapshot (python -m app.ingest)
│   │   ├── store.py          Loads the snapshot into pandas DataFrames once per process
│   │   ├── analytics.py      Forecast selection, correction, uncertainty band, metrics
│   │   └── main.py           FastAPI routes: /api/meta, /day, /accuracy, /horizon, /compare, /insight
│   ├── data/                 Snapshot: wind actuals and every forecast run (JSON)
│   ├── tests/                pytest unit and API tests
│   ├── Dockerfile
│   └── requirements*.txt
├── frontend/
│   ├── src/
│   │   ├── api.ts            Typed API client and response types
│   │   ├── format.ts         UK-time, MW, GW and GWh formatting
│   │   ├── useApi.ts         Small data-fetching hook
│   │   ├── App.tsx           Shell, tabs and shared decision settings
│   │   ├── views/            DayView (briefing) and AccuracyView (analysis)
│   │   └── components/       Settings bar, day strip, forecast timeline, tooltip
│   ├── nginx.conf            Serves the build and proxies /api in Docker
│   └── Dockerfile
├── docker-compose.yml
├── vercel.json
├── requirements.txt          Python dependencies for the Vercel function
└── .github/workflows/ci.yml
```

## Design notes

**Architecture.** Elexon → `ingest.py` → JSON snapshot → `store.py` (cached DataFrames) → `analytics.py` (pure functions) → `main.py` (FastAPI, JSON) → React. The analytics never do I/O, which keeps them easy to test. The API does the analysis and the frontend only formats and draws, so the numbers on screen are the ones covered by tests.

**Why a snapshot rather than live calls.** January 2026 is historical. Serving a committed snapshot makes the app fast and deterministic, keeps cold starts cheap on serverless, and keeps it working if Elexon is unavailable. The ingest module keeps the snapshot reproducible.

**Decision-time forecast.** For delivery day D, decision time is the gate closure on D-1 (UK local time, so BST is handled) minus the preparation time. For each hour of D the app uses the latest WINDFOR run with `publishTime` at or before that time. Delivery days are UK calendar days, so clock-change days have 23 or 25 hours.

**Matching forecasts to actuals.** WINDFOR is hourly and FUELHH is half-hourly. Each forecast is compared with the actual for the half hour that starts at the same time. Comparing against the hourly mean or a centred mean changed the average error by less than 1%.

**No look-ahead.** The reliable band and the pilot's corrected forecast for day D use only delivery days up to D-2. D-1 is still in progress when the decision is made. The snapshot includes two weeks of December history so that early January has a track record.

**Error sign.** Error = forecast − actual. Positive values are shortfalls the desk has to buy elsewhere.

**Scope and next steps.** National wind only, as specified. The corrected forecast goes beyond what the brief asks, so it is off by default and labelled as a pilot insight. Natural next steps are curtailment data to explain the overshoot directly, demand and solar forecasts for a full net-position view, live data for current decisions, and a longer history so that conditional uncertainty models can be validated properly.

## Use of AI tools

This project was built with help from Claude (Anthropic) through Claude Code. It was used for code generation, data exploration and drafting documentation. The analysis choices and results were reviewed and checked against the data and the tests.
