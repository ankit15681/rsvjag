import type { Auction, Settings } from '../api'

const PREP_OPTIONS = [0, 15, 30, 60, 90]
const CONFIDENCE_OPTIONS = [0.8, 0.9, 0.95]

interface Props {
  auctions: Auction[]
  value: Settings
  onChange: (s: Settings) => void
}

export function SettingsBar({ auctions, value, onChange }: Props) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch })
  return (
    <section className="settings" aria-label="Decision settings">
      <div className="field">
        <span>Day-ahead auction (gate closure on the day before)</span>
        <div className="segmented" role="group">
          {auctions.map((a) => (
            <button key={a.id} aria-pressed={a.id === value.auction} onClick={() => set({ auction: a.id })} title={a.name}>
              {a.name.replace(' auction', '')}
              <small>{a.gate_closure}</small>
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Decide this long before gate closure</span>
        <select value={value.prep} onChange={(e) => set({ prep: Number(e.target.value) })}>
          {PREP_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'At gate closure' : `${m} minutes`}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Confidence for reliable wind</span>
        <div className="segmented" role="group">
          {CONFIDENCE_OPTIONS.map((c) => (
            <button key={c} aria-pressed={c === value.confidence} onClick={() => set({ confidence: c })}>
              {Math.round(c * 100)}%
            </button>
          ))}
        </div>
      </div>

      <label
        className="switch"
        title="Goes beyond the official forecast: rescales it with a line fitted on the last 14 days of known outturn"
      >
        <input type="checkbox" checked={value.adjust} onChange={(e) => set({ adjust: e.target.checked })} />
        Pilot insight: show corrected forecast
      </label>
    </section>
  )
}
