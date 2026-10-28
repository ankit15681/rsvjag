import { useEffect, useState } from 'react'

export type Loadable<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T }

/** Run ``load`` whenever ``deps`` change; stale responses are ignored. Keeps showing previous data while reloading. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]): { state: Loadable<T>; data: T | undefined } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' })
  const [data, setData] = useState<T>()

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    load()
      .then((d) => {
        if (!live) return
        setData(d)
        setState({ status: 'ready', data: d })
      })
      .catch((e: unknown) => live && setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { state, data }
}
