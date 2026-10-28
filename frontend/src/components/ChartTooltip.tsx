interface Row {
  label: string
  value: string
  color?: string
}

/** Small tooltip body shared by all charts. */
export function TooltipBox({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="tooltip">
      <b>{title}</b>
      {rows.map((r) => (
        <div key={r.label}>
          <span style={r.color ? { color: r.color } : undefined}>{r.label}</span>
          {r.value}
        </div>
      ))}
    </div>
  )
}
