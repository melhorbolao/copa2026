'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveBetsBatch, type BatchBetItem } from './actions'

const DEBOUNCE_MS = 1500

export type Queued = { score_home: number; score_away: number } | { delete: true }

interface Ctx {
  enqueueSave:   (matchId: string, scoreHome: number, scoreAway: number) => void
  enqueueDelete: (matchId: string) => void
  flushNow:      () => Promise<void>
  getQueue:      () => ReadonlyMap<string, Queued>
  status:        'idle' | 'saving' | 'saved' | 'error'
  pendingCount:  number
}

const Ctx = createContext<Ctx>({
  enqueueSave:   () => {},
  enqueueDelete: () => {},
  flushNow:      async () => {},
  getQueue:      () => new Map(),
  status:        'idle',
  pendingCount:  0,
})

/**
 * Provider que centraliza saves de palpites de placar. Cada MatchBetRow
 * emite eventos para a fila; o flush real acontece após `DEBOUNCE_MS` de
 * inatividade, agrupando todos os palpites alterados num único RPC
 * `save_bets_batch`.
 *
 * Exemplo: usuário digita placar em 5 jogos em 2s → 1 chamada batch
 * (vs 5 antes).
 */
export function BetSaveQueueProvider({ children }: { children: React.ReactNode }) {
  const queueRef = useRef<Map<string, Queued>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushingRef = useRef(false)
  const router = useRouter()

  const [status, setStatus] = useState<Ctx['status']>('idle')
  const [pendingCount, setPendingCount] = useState(0)

  const updateCount = () => setPendingCount(queueRef.current.size)

  const flush = async () => {
    if (flushingRef.current) return
    if (queueRef.current.size === 0) return
    flushingRef.current = true
    setStatus('saving')

    const snapshot: BatchBetItem[] = []
    for (const [matchId, op] of queueRef.current.entries()) {
      if ('delete' in op) snapshot.push({ matchId, delete: true })
      else snapshot.push({ matchId, scoreHome: op.score_home, scoreAway: op.score_away })
    }
    queueRef.current.clear()
    updateCount()

    try {
      await saveBetsBatch(snapshot)
      setStatus('saved')
      setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1500)
      router.refresh()
    } catch (e) {
      console.error('[BetSaveQueue] flush erro:', e)
      setStatus('error')
      // Reinjeta no queue para tentar de novo na próxima oportunidade
      for (const item of snapshot) {
        queueRef.current.set(item.matchId, item.delete
          ? { delete: true }
          : { score_home: item.scoreHome!, score_away: item.scoreAway! })
      }
      updateCount()
    } finally {
      flushingRef.current = false
    }
  }

  const schedule = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, DEBOUNCE_MS)
  }

  const enqueueSave = (matchId: string, scoreHome: number, scoreAway: number) => {
    queueRef.current.set(matchId, { score_home: scoreHome, score_away: scoreAway })
    updateCount()
    schedule()
  }

  const enqueueDelete = (matchId: string) => {
    queueRef.current.set(matchId, { delete: true })
    updateCount()
    schedule()
  }

  const flushNow = async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    await flush()
  }

  const getQueue = () => queueRef.current as ReadonlyMap<string, Queued>

  // Garantia anti-perda: se o usuário fechar a aba ou navegar com itens
  // pendentes, dispara um save sincrônico via sendBeacon-like (ou flush async).
  useEffect(() => {
    const onBeforeUnload = () => {
      if (queueRef.current.size > 0) { void flush() }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Limpa timer no unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <Ctx.Provider value={{ enqueueSave, enqueueDelete, flushNow, getQueue, status, pendingCount }}>
      {children}
    </Ctx.Provider>
  )
}

export function useBetSaveQueue() {
  return useContext(Ctx)
}
