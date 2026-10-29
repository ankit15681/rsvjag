import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { api, type Accuracy, type Compare, type Horizon, type Insight, type Meta, type Settings } from '../api'
import { TooltipBox } from '../components/ChartTooltip'
import { fmtAxisGW, fmtDayShort, fmtGW, fmtHours, fmtMW, fmtPct } from '../format'
import { useApi } from '../useApi'

interface Props {
  meta: Meta
  settings: Settings
}

const AXIS = { stroke: 'var(--line)' }

/** Multiples of ``step`` within [lo, hi]. */
function stepTicks(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t)
  return out
}

export function AccuracyView({ meta, settings: s }: Props) {
  const acc = useApi(() => api.accuracy(s), [s.auction, s.prep, s.confidence, s.adjust])
  const cmp = useApi(() => api.compare(s), [s.prep, s.confidence])
  const hor = useApi(api.horizon, [])
  const ins = useApi(() => api.insight(s), [s.auction, s.prep])

  if (acc.state.status === 'error') return <p className="state error">{acc.state.error}</p>
  if (!acc.data) return <p className="state">Loading accuracy analysis…</p>

  const a = acc.data
  const m = a.metrics
  const auction = meta.auctions.find((x) => x.id === a.auction)!
  const pct = Math.round(a.confidence * 100)

  return (
    <>
      <div className="intro">
        <h1>
          At decision time the wind forecast missed by {fmtMW(m.mae)} on average, {fmtPct(m.nmae_pct)} of typical output.
        </h1>
        <p>
          Every hour of every January delivery day, scored against the forecast available before the {auction.name} closed at{' '}
          {auction.gate_closure}. {a.adjusted ? 'Pilot insight is on: forecasts are rescaled with a line fitted on the previous two weeks.' : 'Forecasts are the official Elexon figures.'}
        </p>
      </div>

      <div className="kpis">
        <Kpi label="Average error" value={fmtMW(m.mae)} note={`${m.n} hours scored`} />
        <Kpi label="Root mean square error" value={fmtMW(m.rmse)} note="Penalises large misses" />
        <Kpi label="Bias" value={fmtMW(m.bias, true)} note={m.bias != null && m.bias > 0 ? 'Forecast ran high' : 'Forecast ran low'} />
        <Kpi label="Shortfall exceeded 1 hour in 10" value={fmtMW(m.p90)} note="90th percentile of error" />
        <Kpi label="Worst hourly shortfall" value={fmtMW(m.max_shortfall)} note="Forecast minus actual" />
        <Kpi
          label={`Reliable level held (target ${pct}%)`}
          value={fmtPct(a.coverage.reliable_hit_pct)}
          note={`Average cover ${fmtMW(a.coverage.mean_buffer_mw)}`}
        />
      </div>

      {cmp.data && <CompareTable data={cmp.data} current={s} />}

      {ins.data && <InsightPanel data={ins.data} />}

      <div className="grid2">
        <section className="panel">
          <h2>Error grows with forecast horizon</h2>
          <p className="sub">
            All official forecast runs, grouped by hours between publication and delivery. The shaded column is the range of
            horizons your decision uses.
          </p>
          {hor.data && <HorizonChart data={hor.data} range={a.horizon_h} />}
        </section>
        <section className="panel">
          <h2>Error day by day</h2>
          <p className="sub">Bars show each delivery day's bias; the line is its average absolute error.</p>
          <DailyChart data={a} />
        </section>
        <section className="panel">
          <h2>Error by hour of day</h2>
          <p className="sub">Average absolute error and bias for each delivery hour, UK time.</p>
          <HourChart data={a} />
        </section>
        <section className="panel">
          <h2>How errors are distributed</h2>
          <p className="sub">Hours by size of error in 500 MW steps. Amber bars are shortfalls (wind below forecast).</p>
          <HistogramChart data={a} />
        </section>
        <section className="panel">
          <h2>Forecast against actual</h2>
          <p className="sub">Each point is one hour. Points below the diagonal are hours where wind fell short of the forecast.</p>
          <ScatterPlot data={a} />
        </section>
        <section className="panel">
          <h2>Reading these numbers</h2>
          <div className="facts">
            <p>
              Error is <strong>forecast minus actual</strong>. A positive value is a shortfall the desk must buy elsewhere; a
              negative value is surplus wind.
            </p>
            <p>
              The <strong>reliable level</strong> is the forecast minus the {pct}th percentile of errors from the previous two
              weeks with known outturn. If it is well calibrated, actual wind should reach it in about {pct}% of hours.
            </p>
            <p>
              The official forecast tends to run above metered generation, most of all on windy days, which fits wind farms
              being curtailed when the grid cannot take their output. The pilot insight below measures this.
            </p>
          </div>
        </section>
      </div>

      <details className="method panel">
        <summary>Method and assumptions</summary>
        <ul>
          <li>Purchase decisions made from 1 to 31 January 2026, covering delivery days 2 January to 1 February.</li>
          <li>Decision time is the auction's gate closure on the day before delivery minus the preparation time you set. The forecast used is the latest WINDFOR run published at or before that time.</li>
          <li>WINDFOR forecasts are hourly; each is compared with the FUELHH wind outturn for the half hour starting at the same time.</li>
          <li>The reliable band and the pilot's corrected forecast use only delivery days up to two days before the target day, since the day before is still in progress at decision time. Two weeks of December history are included so early January days have a track record.</li>
          <li>The corrected forecast fits actual = a + b × forecast on the previous 14 days for each delivery day. The method and window were chosen on 2 to 16 January and are scored separately on 17 January to 1 February. A band that widens with wind level was also tried and dropped: on the unseen days it was no better than the simpler band.</li>
          <li>Horizon analysis uses every published forecast run, not just the one used for decisions.</li>
          <li>Gate closures: EPEX 60-minute 09:20, N2EX hourly 09:50, EPEX 30-minute 15:30 (UK time).</li>
        </ul>
      </details>
    </>
  )
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="figure">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {note && <span className="note">{note}</span>}
    </div>
  )
}

function CompareTable({ data, current }: { data: Compare; current: Settings }) {
  const maes = data.rows.map((r) => r.metrics.mae ?? Infinity)
  const best = Math.min(...maes)
  return (
    <section className="panel">
      <h2>Which auction and forecast give the clearest view</h2>
      <p className="sub">
        Later gate closures see fresher forecasts. Preparation time and confidence follow your settings above.
      </p>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Auction</th>
              <th>Gate closure</th>
              <th>Forecast</th>
              <th>Hours ahead</th>
              <th>Average error</th>
              <th>Bias</th>
              <th>90th pct shortfall</th>
              <th>Reliable level held</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.auction}-${r.adjusted}`} className={r.auction === current.auction && r.adjusted === current.adjust ? 'current' : undefined}>
                <td>{r.name}</td>
                <td>{r.gate_closure}</td>
                <td>{r.adjusted ? 'Corrected (pilot)' : 'Official'}</td>
                <td>{r.horizon_h ? `${fmtHours(r.horizon_h.min)} to ${fmtHours(r.horizon_h.max)}` : '–'}</td>
                <td>{r.metrics.mae === best ? <span className="best">{fmtMW(r.metrics.mae)}</span> : fmtMW(r.metrics.mae)}</td>
                <td>{fmtMW(r.metrics.bias, true)}</td>
                <td>{fmtMW(r.metrics.p90)}</td>
                <td>{fmtPct(r.coverage.reliable_hit_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function InsightPanel({ data }: { data: Insight }) {
  const levels = data.by_level.map((b) => ({ ...b, label: `${b.from / 1000}–${b.to / 1000}` }))
  const range = (r: [string, string]) => `${fmtDayShort(`${r[0]}T12:00:00Z`)} to ${fmtDayShort(`${r[1]}T12:00:00Z`)}`
  const gain = (h: 'selection' | 'test') => {
    const o = data.official[h].mae, c = data.corrected[h].mae
    return o && c ? fmtPct((100 * (o - c)) / o) : '–'
  }
  return (
    <section className="panel insight">
      <h2>Pilot insight: the forecast overshoots most on windy days</h2>
      <p className="sub">
        This goes beyond the two questions in scope. It uses only the same Elexon data, and only what was known at each
        decision.
      </p>
      <div className="two-col">
        <div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={levels} margin={{ top: 12, right: 8, bottom: 14, left: 0 }}>
              <CartesianGrid stroke="var(--line-soft)" vertical={false} />
              <XAxis dataKey="label" interval={0} {...AXIS} label={{ value: 'Official forecast for the hour (GW)', position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted)' }} />
              <YAxis tickFormatter={fmtAxisGW} width={52} {...AXIS} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const r = payload[0].payload as (typeof levels)[number]
                  return (
                    <TooltipBox
                      title={`Forecast ${r.label} GW`}
                      rows={[
                        { label: 'Average overshoot', value: fmtMW(r.bias, true), color: 'var(--signal)' },
                        { label: 'Average error', value: fmtMW(r.mae) },
                        { label: 'Hours', value: String(r.n) },
                      ]}
                    />
                  )
                }}
              />
              <Bar dataKey="bias" fill="var(--signal)" fillOpacity={0.75} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="sub">Average amount the official forecast was above actual generation, by forecast level.</p>
        </div>
        <div className="facts">
          <p>
            When more than 20 GW is forecast, actual output comes in about <strong>{fmtGW(levels.at(-1)?.bias)}</strong> lower.
            Below 5 GW the gap is only <strong>{fmtGW(levels[0]?.bias)}</strong>. This fits wind farms being curtailed when the
            grid cannot take their output.
          </p>
          <p>
            Rescaling each day's forecast with a line fitted on the previous {data.window_days} days (typically actual ≈{' '}
            {fmtGW(data.typical_fit.intercept_mw)} + {data.typical_fit.slope.toFixed(2)} × forecast) cuts the average error:
          </p>
          <table className="compare">
            <thead>
              <tr>
                <th>Average error</th>
                <th>{range(data.split.selection)}<br />method chosen</th>
                <th>{range(data.split.test)}<br />unseen days</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Official forecast</td><td>{fmtMW(data.official.selection.mae)}</td><td>{fmtMW(data.official.test.mae)}</td></tr>
              <tr><td>Corrected (pilot)</td><td>{fmtMW(data.corrected.selection.mae)}</td><td>{fmtMW(data.corrected.test.mae)}</td></tr>
              <tr><td>Reduction</td><td>{gain('selection')}</td><td><span className="best">{gain('test')}</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function HorizonChart({ data, range }: { data: Horizon; range: Accuracy['horizon_h'] }) {
  const rows = data.stats.map((s) => ({ ...s, mid: s.horizon_from + data.bucket_h / 2, band: [s.p10, s.p90] }))
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 14, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" vertical={false} />
        {range && <ReferenceArea x1={range.min} x2={range.max} fill="var(--signal-wash)" stroke="none" />}
        <XAxis dataKey="mid" type="number" domain={[0, 66]} ticks={[0, 12, 24, 36, 48, 60]} tickFormatter={(v) => `${v} h`} {...AXIS} label={{ value: 'Hours ahead', position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted)' }} />
        <YAxis tickFormatter={fmtAxisGW} width={52} {...AXIS} />
        <ReferenceLine y={0} stroke="var(--line)" />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as (typeof rows)[number]
            return (
              <TooltipBox
                title={`${r.horizon_from} to ${r.horizon_to} hours ahead`}
                rows={[
                  { label: 'Average error', value: fmtMW(r.mae), color: 'var(--wind)' },
                  { label: 'Bias', value: fmtMW(r.bias, true) },
                  { label: '10th to 90th pct', value: `${fmtMW(r.p10)} to ${fmtMW(r.p90)}` },
                  { label: 'Hours', value: String(r.n) },
                ]}
              />
            )
          }}
        />
        <Area dataKey="band" fill="var(--wind-wash)" stroke="none" isAnimationActive={false} />
        <Line dataKey="bias" stroke="var(--muted)" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        <Line dataKey="mae" stroke="var(--wind)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function DailyChart({ data }: { data: Accuracy }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8).replace(/^0/, '')} interval={2} {...AXIS} />
        <YAxis tickFormatter={fmtAxisGW} width={52} {...AXIS} />
        <ReferenceLine y={0} stroke="var(--line)" />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as Accuracy['daily'][number]
            return (
              <TooltipBox
                title={fmtDayShort(`${r.day}T12:00:00Z`)}
                rows={[
                  { label: 'Average error', value: fmtMW(r.mae), color: 'var(--wind)' },
                  { label: 'Bias', value: fmtMW(r.bias, true) },
                  { label: 'Forecast energy', value: `${Math.round(r.forecast_gwh)} GWh` },
                  { label: 'Actual energy', value: `${Math.round(r.actual_gwh)} GWh` },
                ]}
              />
            )
          }}
        />
        <Bar dataKey="bias" isAnimationActive={false}>
          {data.daily.map((d) => (
            <Cell key={d.day} fill={d.bias > 0 ? 'var(--signal)' : 'var(--wind-pale)'} fillOpacity={0.55} />
          ))}
        </Bar>
        <Line dataKey="mae" stroke="var(--wind)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function HourChart({ data }: { data: Accuracy }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data.by_hour} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" vertical={false} />
        <XAxis dataKey="hour" tickFormatter={(h: number) => `${String(h).padStart(2, '0')}:00`} interval={3} {...AXIS} />
        <YAxis tickFormatter={fmtAxisGW} width={52} {...AXIS} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as Accuracy['by_hour'][number]
            return (
              <TooltipBox
                title={`${String(r.hour).padStart(2, '0')}:00 to ${String(r.hour + 1).padStart(2, '0')}:00`}
                rows={[
                  { label: 'Average error', value: fmtMW(r.mae), color: 'var(--wind)' },
                  { label: 'Bias', value: fmtMW(r.bias, true) },
                  { label: '90th pct shortfall', value: fmtMW(r.p90) },
                ]}
              />
            )
          }}
        />
        <Bar dataKey="mae" fill="var(--wind)" fillOpacity={0.75} isAnimationActive={false} />
        <Line dataKey="bias" stroke="var(--signal)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function HistogramChart({ data }: { data: Accuracy }) {
  const rows = data.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }))
  const lo = rows.length ? rows[0].from : 0
  const hi = rows.length ? rows[rows.length - 1].to : 0
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid stroke="var(--line-soft)" vertical={false} />
        <XAxis dataKey="mid" type="number" domain={[lo, hi]} ticks={stepTicks(lo, hi, 2500)} tickFormatter={fmtAxisGW} {...AXIS} />
        <YAxis width={40} allowDecimals={false} {...AXIS} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as (typeof rows)[number]
            return <TooltipBox title={`${fmtMW(r.from)} to ${fmtMW(r.to)}`} rows={[{ label: 'Hours', value: String(r.count) }]} />
          }}
        />
        <Bar dataKey="count" isAnimationActive={false}>
          {rows.map((b) => (
            <Cell key={b.from} fill={b.mid > 0 ? 'var(--signal)' : 'var(--wind)'} fillOpacity={0.75} />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function ScatterPlot({ data }: { data: Accuracy }) {
  const max = Math.ceil(Math.max(...data.scatter.flatMap((p) => [p.forecast, p.actual])) / 5000) * 5000
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 14, left: 0 }}>
        <CartesianGrid stroke="var(--line-soft)" />
        <XAxis dataKey="forecast" type="number" domain={[0, max]} ticks={stepTicks(0, max, 5000)} tickFormatter={fmtAxisGW} {...AXIS} label={{ value: 'Forecast', position: 'insideBottom', offset: -8, fontSize: 12, fill: 'var(--muted)' }} />
        <YAxis dataKey="actual" type="number" domain={[0, max]} ticks={stepTicks(0, max, 5000)} tickFormatter={fmtAxisGW} width={52} {...AXIS} />
        <ZAxis range={[14, 14]} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="var(--ink)" strokeDasharray="4 4" />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const r = payload[0].payload as Accuracy['scatter'][number]
            return (
              <TooltipBox
                title="One hour"
                rows={[
                  { label: 'Forecast', value: fmtMW(r.forecast) },
                  { label: 'Actual', value: fmtMW(r.actual) },
                ]}
              />
            )
          }}
        />
        <Scatter data={data.scatter} fill="var(--wind)" fillOpacity={0.35} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}
