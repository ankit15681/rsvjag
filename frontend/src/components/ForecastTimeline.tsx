import type { DayView } from '../api'
import { fmtDayShort, fmtStamp, fmtTime, ms } from '../format'

interface Props {
  day: DayView
  focused: string | null
  onFocus: (publishTime: string | null) => void
}

/** Every forecast run that covered the delivery day, laid out against the decision time. */
export function ForecastTimeline({ day, focused, onFocus }: Props) {
  const deliveryStart = ms(day.series[0].t)
  const first = Math.min(...day.vintages.map((v) => ms(v.publish_time)))
  const lo = first - 3 * 3600e3
  const hi = deliveryStart + 3 * 3600e3
  const x = (t: number) => `${(100 * (t - lo)) / (hi - lo)}%`

  const midnights: number[] = []
  for (let t = Math.ceil(lo / 86400e3) * 86400e3; t <= hi; t += 86400e3) midnights.push(t)

  return (
    <div className="timeline" role="group" aria-label="Forecast runs">
      <div className="axis" />
      {midnights.map((t) => (
        <span key={t} className="tick" style={{ left: x(t) }}>
          {fmtDayShort(t)}
        </span>
      ))}
      <div className="marker" style={{ left: x(ms(day.decision_time)) }}>
        <span>Decision {fmtTime(day.decision_time)}</span>
      </div>
      <div className="marker delivery" style={{ left: x(deliveryStart) }}>
        <span>Delivery starts</span>
      </div>
      {day.vintages
        .filter((v) => ms(v.publish_time) <= hi)
        .map((v) => (
          <button
            key={v.publish_time}
            className={`dot${v.available_at_decision ? ' available' : ''}${v.used ? ' used' : ''}`}
            style={{ left: x(ms(v.publish_time)), outline: focused === v.publish_time ? '2px solid var(--ink)' : undefined }}
            title={`Forecast published ${fmtStamp(v.publish_time)}${v.used ? ' (used for the decision)' : v.available_at_decision ? '' : ' (after the decision)'}`}
            aria-label={`Forecast published ${fmtStamp(v.publish_time)}`}
            aria-pressed={focused === v.publish_time}
            onClick={() => onFocus(focused === v.publish_time ? null : v.publish_time)}
          />
        ))}
    </div>
  )
}
