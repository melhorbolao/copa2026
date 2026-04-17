'use client'

import { useState } from 'react'

export function RecalcButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  const handleClick = async () => {
    if (status === 'loading') return
    setStatus('loading')
    try {
      const res = await fetch('/api/scoring/recalculate', { method: 'POST' })
      setStatus(res.ok ? 'ok' : 'error')
    } catch {
      setStatus('error')
    }
    setTimeout(() => setStatus('idle'), 4000)
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={status === 'loading'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 transition"
      >
        {status === 'loading' ? '⏳ Recalculando…' : '⚙️ Recalcular pontuações'}
      </button>
      {status === 'ok'    && <span className="text-xs font-medium text-green-600">✓ Recálculo iniciado</span>}
      {status === 'error' && <span className="text-xs font-medium text-red-500">Erro ao iniciar</span>}
    </div>
  )
}
