import { addDays, daysBetween, fmtDayNum, fmtMW, fmtWeekday } from '../format'

interface Props {
  start: string
  end: string
  value: string
  onChange: (d: string) => void
  /** Daily mean absolute error (MW) used to shade each day. */
  dailyMae?: Record<string, number>
}

export function DayStrip({ start, end, value, onChange, dailyMae = {} }: Props) {
  const days = daysBetween(start, end)
  const max = Math.max(1, ...Object.values(dailyMae))
  return (
    <nav className="daystrip" aria-label="Delivery day">
      <button className="stepper" aria-label="Previous day" disabled={value <= start} onClick={() => onChange(addDays(value, -1))}>
        ‹
      </button>
      <div className="daystrip-cells">
        {days.map((d) => {
          const mae = dailyMae[d]
          const weekday = fmtWeekday(d)
          const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
          return (
            <button
              key={d}
              className="daycell"
              aria-pressed={d === value}
              data-weekend={dow === 0 || dow === 6}
              onClick={() => onChange(d)}
              title={mae == null ? d : `${d}: average error ${fmtMW(mae)}`}
              style={mae == null ? undefined : { background: `rgba(185, 124, 0, ${0.06 + 0.5 * (mae / max)})` }}
            >
              <small>{weekday}</small>
              <b>{fmtDayNum(d)}</b>
            </button>
          )
        })}
      </div>
      <button className="stepper" aria-label="Next day" disabled={value >= end} onClick={() => onChange(addDays(value, 1))}>
        ›
      </button>
    </nav>
  )
}
