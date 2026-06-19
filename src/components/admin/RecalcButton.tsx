'use client'

import { useState } from 'react'

export function RecalcButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [msg, setMsg]       = useState('')

  const handleClick = async () => {
    if (status === 'loading') return
    setStatus('loading')
    setMsg('')
    try {
      // 1. Recalcular pontuações (bets.points + participant_scores)
      const res1  = await fetch('/api/scoring/recalculate', { method: 'POST' })
      const body1 = await res1.json().catch(() => null)
      if (!res1.ok) throw new Error(body1?.error ?? `HTTP ${res1.status}`)

      // 2. Recalcular pontos diários (participant_points_by_day — histórico p/ evolução)
      const res2  = await fetch('/api/scoring/recalculate-daily', { method: 'POST' })
      const body2 = await res2.json().catch(() => null)
      if (!res2.ok) throw new Error(body2?.error ?? `HTTP ${res2.status}`)

      setMsg(`${body2?.count ?? '?'} registros no histórico`)
      setStatus('ok')
      setTimeout(() => window.location.reload(), 1500)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro desconhecido')
      setStatus('error')
      setTimeout(() => setStatus('idle'), 8000)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleClick}
          disabled={status === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 transition"
        >
          {status === 'loading' ? '⏳ Recalculando…' : '⚙️ Recalcular'}
        </button>
        {status === 'ok' && (
          <span className="text-xs font-medium text-green-600">
            ✓ Recalculado ({msg}) — recarregando…
          </span>
        )}
      </div>
      {status === 'error' && (
        <span className="text-xs font-medium text-red-500">
          Erro: {msg || 'falha desconhecida'}
        </span>
      )}
    </div>
  )
}
