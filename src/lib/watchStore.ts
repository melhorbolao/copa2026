type Listener = () => void

type WatchStore = {
  subscribe: (cb: Listener) => () => void
  getSnapshot: () => string | null
  getServerSnapshot: () => null
  set: (id: string | null) => void
}

const stores = new Map<string, WatchStore>()

export function getWatchStore(key: string): WatchStore {
  const existing = stores.get(key)
  if (existing) return existing

  const listeners = new Set<Listener>()

  const store: WatchStore = {
    subscribe: (cb) => {
      listeners.add(cb)
      const handler = (e: StorageEvent) => { if (e.key === key) cb() }
      window.addEventListener('storage', handler)
      return () => {
        listeners.delete(cb)
        window.removeEventListener('storage', handler)
      }
    },
    getSnapshot: () => localStorage.getItem(key),
    getServerSnapshot: () => null,
    set: (id) => {
      if (id) localStorage.setItem(key, id)
      else localStorage.removeItem(key)
      listeners.forEach(cb => cb())
    },
  }

  stores.set(key, store)
  return store
}
