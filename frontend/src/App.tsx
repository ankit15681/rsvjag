import { useEffect, useState } from 'react'
import { api, type Settings } from './api'
import { SettingsBar } from './components/SettingsBar'
import { useApi } from './useApi'
import { AccuracyView } from './views/AccuracyView'
import { DayView } from './views/DayView'

type Tab = 'day' | 'accuracy'

function readHash(): Tab {
  return window.location.hash === '#accuracy' ? 'accuracy' : 'day'
}

export default function App() {
  const meta = useApi(api.meta, [])
  const [tab, setTab] = useState<Tab>(readHash)
  const [settings, setSettings] = useState<Settings>({ auction: 'epex-60', prep: 30, confidence: 0.9, adjust: false })

  useEffect(() => {
    const onHash = () => setTab(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    window.location.hash = t === 'accuracy' ? 'accuracy' : ''
    setTab(t)
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          Windward
        </div>
        <nav className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'day'} onClick={() => go('day')}>
            Day-ahead briefing
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'accuracy'} onClick={() => go('accuracy')}>
            Forecast accuracy
          </button>
        </nav>
        <span className="scope">GB national wind, purchase decisions in January 2026</span>
      </header>

      {meta.state.status === 'error' && <p className="state error">Could not reach the API: {meta.state.error}</p>}
      {meta.state.status === 'loading' && <p className="state">Loading…</p>}
      {meta.data && (
        <>
          <SettingsBar auctions={meta.data.auctions} value={settings} onChange={setSettings} />
          <main>
            {tab === 'day' ? (
              <DayView meta={meta.data} settings={settings} />
            ) : (
              <AccuracyView meta={meta.data} settings={settings} />
            )}
          </main>
          <footer className="footer">
            Data: {meta.data.data.source}. {meta.data.data.forecast_vintages} forecast runs. Times are UK local.
          </footer>
        </>
      )}
    </div>
  )
}
