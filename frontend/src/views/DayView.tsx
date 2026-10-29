import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, type Auction, type DayView as Day, type Meta, type Settings } from '../api'
import { TooltipBox } from '../components/ChartTooltip'
import { DayStrip } from '../components/DayStrip'
import { ForecastTimeline } from '../components/ForecastTimeline'
import { fmtAxisGW, fmtDayLong, fmtGW, fmtGWh, fmtHours, fmtMW, fmtStamp, fmtTime, ms } from '../format'
import { useApi } from '../useApi'

interface Props {
  meta: Meta
  settings: Settings
}

export function DayView({ meta, settings }: Props) {
  const { start, end } = meta.delivery_period
  const [date, setDate] = useState('2026-01-15')
  const [showActual, setShowActual] = useState(true)
  const [showRuns, setShowRuns] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)

  const s = settings
  const day = useApi(() => api.day(date, s), [date, s.auction, s.prep, s.confidence, s.adjust])
  const acc = useApi(() => api.accuracy(s), [s.auction, s.prep, s.confidence, s.adjust])
  const dailyMae = useMemo(
    () => Object.fromEntries((acc.data?.daily ?? []).map((d) => [d.day, d.mae])),
    [acc.data],
  )

  const pickDate = (d: string) => {
    setDate(d)
    setFocused(null)
  }

  return (
    <>
      <DayStrip start={start} end={end} value={date} onChange={pickDate} dailyMae={dailyMae} />
      <p className="legend-note">Darker days had larger forecast errors at decision time.</p>

      {day.state.status === 'error' && <p className="state error">{day.state.error}</p>}
      {!day.data && day.state.status === 'loading' && <p className="state">Loading the briefing…</p>}
      {day.data && (
        <Briefing
          day={day.data}
          confidencePct={Math.round(s.confidence * 100)}
          auction={meta.auctions.find((a) => a.id === day.data!.auction)!}
          showActual={showActual}
          setShowActual={setShowActual}
          showRuns={showRuns}
          setShowRuns={setShowRuns}
          focused={focused}
          setFocused={setFocused}
        />
      )}
    </>
  )
}

interface BriefingProps {
  day: Day
  confidencePct: number
  auction: Auction
  showActual: boolean
  setShowActual: (v: boolean) => void
  showRuns: boolean
  setShowRuns: (v: boolean) => void
  focused: string | null
  setFocused: (v: string | null) => void
}

function Briefing({ day, confidencePct, auction, showActual, setShowActual, showRuns, setShowRuns, focused, setFocused }: BriefingProps) {
  const sum = day.summary
  const hours = day.series.length
  const avgForecast = (sum.forecast_gwh * 1000) / hours
  const avgReliable = sum.reliable_gwh == null ? null : (sum.reliable_gwh * 1000) / hours
  const cover = sum.reliable_gwh == null ? null : sum.forecast_gwh - sum.reliable_gwh
  const later = day.latest_before_delivery

  return (
    <div className="brief">
      <div className="brief-head">
        <h1>{fmtDayLong(day.date)}</h1>
        <p>
          The {auction.name} closes at {auction.gate_closure} the day before. Deciding at{' '}
          <strong>{fmtTime(day.decision_time)}</strong>, the newest wind forecast was published at{' '}
          <strong>{fmtStamp(day.forecast_publish_time)}</strong>, looking {fmtHours(day.horizon_h.min)} to{' '}
          {fmtHours(day.horizon_h.max)} ahead.
          {day.adjusted && (
            <>
              {' '}Pilot insight is on: the forecast is rescaled using the last 14 days, actual ≈{' '}
              {fmtGW(day.correction.intercept_mw)} + {day.correction.slope.toFixed(2)} × forecast, which lowers it by{' '}
              <strong>{fmtMW(day.correction.mean_mw)}</strong> on average for this day.
            </>
          )}
        </p>
      </div>

      <div className="figures">
        <div className="figure forecast">
          <span className="label">Expected wind</span>
          <span className="value">{fmtGWh(sum.forecast_gwh)}</span>
          <span className="note">
            Average {fmtGW(avgForecast)}
            {day.adjusted && <>, official forecast {fmtGWh(sum.raw_forecast_gwh)}</>}
          </span>
        </div>
        <div className="figure reliable">
          <span className="label">Count on at {confidencePct}% confidence</span>
          <span className="value">{fmtGWh(sum.reliable_gwh)}</span>
          <span className="note">Average {fmtGW(avgReliable)}</span>
        </div>
        <div className="figure">
          <span className="label">Shortfall to cover if wind disappoints</span>
          <span className="value">{fmtGWh(cover)}</span>
          <span className="note">{fmtMW(day.buffer_mw)} below forecast each hour</span>
        </div>
        <div className="figure hindsight">
          <span className="label">What actually happened</span>
          <span className="value">{fmtGWh(sum.actual_gwh)} generated</span>
          <dl>
            <dt>Average error</dt>
            <dd>{fmtMW(day.metrics.mae)}</dd>
            <dt>Bias (forecast minus actual)</dt>
            <dd>{fmtMW(day.metrics.bias, true)}</dd>
            <dt>Hours at or above reliable level</dt>
            <dd>
              {day.coverage.reliable_hit_pct == null ? '–' : `${Math.round((day.coverage.reliable_hit_pct * hours) / 100)} of ${hours}`}
            </dd>
          </dl>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Hourly wind generation</h2>
            <p className="sub">
              The shaded band runs from the reliable level to its mirror on the upside, built from the last two weeks of
              forecast errors that were known at decision time.
            </p>
          </div>
          <div className="chart-toggles">
            <label className="switch">
              <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
              Show actual generation
            </label>
            <label className="switch">
              <input type="checkbox" checked={showRuns} onChange={(e) => setShowRuns(e.target.checked)} />
              Show every forecast run
            </label>
          </div>
        </div>
        <DayChart day={day} showActual={showActual} showRuns={showRuns} focused={focused} />
        <div className="keys">
          <span className="key"><i className="swatch" style={{ borderColor: 'var(--wind)' }} />Forecast used{day.adjusted ? ' (corrected)' : ''}</span>
          {day.adjusted && <span className="key"><i className="swatch dash" style={{ borderColor: 'var(--wind-pale)' }} />Official forecast</span>}
          <span className="key"><i className="swatch" style={{ borderColor: 'var(--signal)' }} />Reliable at {confidencePct}%</span>
          <span className="key"><i className="swatch area" style={{ background: 'var(--wind-wash)' }} />Likely range</span>
          {showActual && <span className="key"><i className="swatch" style={{ borderColor: 'var(--outturn)' }} />Actual (half-hourly)</span>}
          {(showRuns || focused) && <span className="key"><i className="swatch dash" style={{ borderColor: 'var(--muted)' }} />Other forecast runs</span>}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <h2>How the forecast evolved</h2>
          <p className="sub">
            Each dot is a forecast run covering this day. Dark rings were published before the decision, pale ones after;
            the filled dot is the run used. Select a dot to draw it on the chart.
          </p>
          <ForecastTimeline day={day} focused={focused} onFocus={setFocused} />
        </section>
        <section className="panel">
          <h2>Deciding a day ahead</h2>
          <div className="facts">
            <p>
              Wind is forecast between <strong>{fmtGW(sum.min_forecast_mw)}</strong> and{' '}
              <strong>{fmtGW(sum.peak_forecast_mw)}</strong> across the day.
            </p>
            {later && later.metrics.mae != null && day.official_metrics.mae != null && (
              <p>
                Waiting longer would {later.metrics.mae < day.official_metrics.mae ? 'have helped' : 'not have helped'}: the
                official forecast at decision time missed by <strong>{fmtMW(day.official_metrics.mae)}</strong> on average,
                the last one before delivery ({fmtStamp(later.publish_time)}) by <strong>{fmtMW(later.metrics.mae)}</strong>.
                {day.adjusted && <> The pilot's corrected forecast missed by <strong>{fmtMW(day.metrics.mae)}</strong>.</>}
              </p>
            )}
            <p>
              Largest hourly shortfall: <strong>{fmtMW(day.metrics.max_shortfall)}</strong>. Largest surplus:{' '}
              <strong>{fmtMW(day.metrics.max_surplus == null ? null : -day.metrics.max_surplus)}</strong>.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

type Row = { t: number; [key: string]: number | [number, number] | null | undefined }

function DayChart({ day, showActual, showRuns, focused }: { day: Day; showActual: boolean; showRuns: boolean; focused: string | null }) {
  const runs = day.vintages.filter((v) => !v.used && (showRuns || v.publish_time === focused))

  const data = useMemo(() => {
    const rows = new Map<number, Row>()
    const at = (t: string) => {
      const k = ms(t)
      if (!rows.has(k)) rows.set(k, { t: k })
      return rows.get(k)!
    }
    for (const p of day.series) {
      const r = at(p.t)
      r.forecast = p.forecast
      r.raw = p.raw_forecast
      r.reliable = p.reliable
      r.upper = p.upper
      r.band = p.reliable == null || p.upper == null ? null : [p.reliable, p.upper]
    }
    for (const p of day.actuals) at(p.t).actual = p.v
    day.vintages.forEach((v, i) => v.points.forEach((p) => (at(p.t)[`run${i}`] = p.v)))
    return [...rows.values()].sort((a, b) => a.t - b.t)
  }, [day])

  const domain: [number, number] = [ms(day.series[0].t), ms(day.series[day.series.length - 1].t) + 3600e3]
  const ticks = Array.from({ length: 9 }, (_, i) => domain[0] + i * 3 * 3600e3)
  const yMax = Math.max(...data.flatMap((r) => [r.upper, r.forecast, r.raw, r.actual].filter((v): v is number => typeof v === 'number')))
  const yTicks = gwTicks(yMax)

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" vertical={false} />
        <XAxis dataKey="t" type="number" domain={domain} ticks={ticks} tickFormatter={fmtTime} stroke="var(--line)" />
        <YAxis tickFormatter={fmtAxisGW} stroke="var(--line)" width={56} domain={[0, yTicks[yTicks.length - 1]]} ticks={yTicks} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as Row
            const n = (k: string) => (typeof r[k] === 'number' ? fmtMW(r[k] as number) : null)
            const rows = [
              { label: 'Forecast used', value: n('forecast'), color: 'var(--wind)' },
              { label: 'Official forecast', value: day.adjusted ? n('raw') : null },
              { label: 'Reliable level', value: n('reliable'), color: 'var(--signal)' },
              { label: 'Actual', value: showActual ? n('actual') : null },
            ].filter((x): x is { label: string; value: string; color?: string } => x.value != null)
            return <TooltipBox title={fmtTime(label as number)} rows={rows} />
          }}
        />
        <Area dataKey="band" stroke="none" fill="var(--wind-wash)" connectNulls isAnimationActive={false} />
        {runs.map((v) => {
          const i = day.vintages.indexOf(v)
          const isFocus = v.publish_time === focused
          return (
            <Line
              key={v.publish_time}
              dataKey={`run${i}`}
              stroke={isFocus ? 'var(--ink)' : 'var(--muted)'}
              strokeOpacity={isFocus ? 0.9 : v.available_at_decision ? 0.35 : 0.25}
              strokeDasharray={v.available_at_decision ? undefined : '3 3'}
              strokeWidth={isFocus ? 2 : 1}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          )
        })}
        {day.adjusted && <Line dataKey="raw" stroke="var(--wind-pale)" strokeDasharray="6 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
        <Line dataKey="reliable" stroke="var(--signal)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="forecast" stroke="var(--wind)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
        {showActual && <Line dataKey="actual" stroke="var(--outturn)" strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** Evenly spaced GW ticks from zero that cover ``max`` MW. */
function gwTicks(max: number): number[] {
  const step = max > 16000 ? 5000 : 2500
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, i) => i * step)
}
