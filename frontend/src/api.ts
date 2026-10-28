// Typed client for the FastAPI backend. Times are ISO strings in UTC; MW unless noted.

export interface Auction {
  id: string
  name: string
  exchange: string
  gate_closure: string
  granularity: string
}

export interface Meta {
  auctions: Auction[]
  default_auction: string
  default_prep_minutes: number
  decision_period: { start: string; end: string }
  delivery_period: { start: string; end: string }
  data: { source: string; actual_rows: number; forecast_rows: number; forecast_vintages: number }
}

export interface Metrics {
  n: number
  mae?: number
  rmse?: number
  bias?: number
  nmae_pct?: number | null
  p10?: number
  p50?: number
  p90?: number
  max_shortfall?: number
  max_surplus?: number
  mean_actual?: number
  mean_forecast?: number
  corr?: number | null
}

export interface Coverage {
  n: number
  reliable_hit_pct?: number
  within_band_pct?: number
  mean_buffer_mw?: number
}

export interface Range {
  min: number
  max: number
}

export interface Point {
  t: string
  v: number
}

export interface DayView {
  date: string
  auction: string
  confidence: number
  adjusted: boolean
  decision_time: string
  forecast_publish_time: string
  horizon_h: Range
  correction_mw: number
  buffer_mw: number | null
  series: {
    t: string
    raw_forecast: number
    forecast: number
    reliable: number | null
    upper: number | null
    actual: number | null
  }[]
  actuals: Point[]
  vintages: { publish_time: string; available_at_decision: boolean; used: boolean; points: Point[] }[]
  summary: {
    forecast_gwh: number
    raw_forecast_gwh: number
    reliable_gwh: number | null
    actual_gwh: number | null
    peak_forecast_mw: number
    min_forecast_mw: number
  }
  metrics: Metrics
  official_metrics: Metrics
  coverage: Coverage
  latest_before_delivery: { publish_time: string; metrics: Metrics } | null
}

export interface GroupStats {
  n: number
  mae: number
  bias: number
  p10: number
  p90: number
}

export interface Accuracy {
  auction: string
  adjusted: boolean
  confidence: number
  metrics: Metrics
  coverage: Coverage
  horizon_h: Range | null
  daily: (GroupStats & { day: string; forecast_gwh: number; actual_gwh: number })[]
  by_hour: (GroupStats & { hour: number })[]
  histogram: { from: number; to: number; count: number }[]
  scatter: { forecast: number; actual: number }[]
}

export interface Horizon {
  bucket_h: number
  stats: (GroupStats & { horizon_from: number; horizon_to: number })[]
}

export interface Compare {
  confidence: number
  rows: {
    auction: string
    name: string
    gate_closure: string
    adjusted: boolean
    horizon_h: Range | null
    metrics: Metrics
    coverage: Coverage
  }[]
}

export interface Settings {
  auction: string
  prep: number
  confidence: number
  adjust: boolean
}

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function get<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`${BASE}/api/${path}${qs.size ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ? String(body.detail) : `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const api = {
  meta: () => get<Meta>('meta'),
  day: (date: string, s: Settings) => get<DayView>('day', { date, ...s }),
  accuracy: (s: Settings) => get<Accuracy>('accuracy', { ...s }),
  horizon: () => get<Horizon>('horizon', { bucket: 3 }),
  compare: (s: Pick<Settings, 'prep' | 'confidence'>) => get<Compare>('compare', s),
}
