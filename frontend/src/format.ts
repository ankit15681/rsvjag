// Display helpers. All times are shown in UK local time, the desk's working clock.

const TZ = 'Europe/London'

const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayLong = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
const dayShort = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const dayNum = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric' })
const wkday = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'narrow' })

export const ms = (iso: string) => new Date(iso).getTime()

export const fmtTime = (t: string | number) => hm.format(new Date(t))
export const fmtDayLong = (isoDate: string) => dayLong.format(new Date(`${isoDate}T12:00:00Z`))
export const fmtDayShort = (t: string | number) => dayShort.format(new Date(t))
export const fmtDayNum = (isoDate: string) => dayNum.format(new Date(`${isoDate}T12:00:00Z`))
export const fmtWeekday = (isoDate: string) => wkday.format(new Date(`${isoDate}T12:00:00Z`))

/** "Wed 14 Jan, 07:30" */
export const fmtStamp = (iso: string) => `${fmtDayShort(iso)}, ${fmtTime(iso)}`

export const fmtMW = (v: number | null | undefined, signed = false) => {
  if (v == null || Number.isNaN(v)) return '–'
  const s = Math.round(v).toLocaleString('en-GB')
  return `${signed && v > 0 ? '+' : ''}${s} MW`
}

export const fmtGW = (mw: number | null | undefined, digits = 1) =>
  mw == null ? '–' : `${(mw / 1000).toFixed(digits)} GW`

/** Axis ticks: whole GW where possible, one decimal otherwise. */
export const fmtAxisGW = (mw: number) => `${+(mw / 1000).toFixed(1)} GW`

export const fmtGWh = (v: number | null | undefined) =>
  v == null ? '–' : `${Math.round(v).toLocaleString('en-GB')} GWh`

export const fmtPct = (v: number | null | undefined, digits = 0) => (v == null ? '–' : `${v.toFixed(digits)}%`)

export const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`

export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}
