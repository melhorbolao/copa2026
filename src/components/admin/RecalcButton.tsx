'use client'

import { useState } from 'react'

export function RecalcButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [diagInfo, setDiagInfo] = useState<string | null>(null)

  const handleClick = async () => {
    if (status === 'loading') return
    setStatus('loading')
    setErrMsg('')
    setDiagInfo(null)
    try {
      const res = await fetch('/api/scoring/recalculate', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        const d = body?.diag
        if (d) setDiagInfo(`betsWithPts=${d.betsWithPts} | ppdRows=${d.ppdRows} | datas=${JSON.stringify(d.ppdDates)}`)
        setStatus('ok')
        setTimeout(() => window.location.reload(), 4000)
      } else {
        setErrMsg(body?.error ?? `HTTP ${res.status}`)
        setStatus('error')
        setTimeout(() => setStatus('idle'), 8000)
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Erro de rede')
      setStatus('error')
      setTimeout(() => setStatus('idle'), 8000)
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={handleClick}
          disabled={status === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 transition"
        >
          {status === 'loading' ? '⏳ Recalculando…' : '⚙️ Recalcular pontuações'}
        </button>
        {status === 'ok' && <span className="text-xs font-medium text-green-600">✓ Recalculado — recarregando em 4s…</span>}
      </div>
      {diagInfo && <span className="text-xs font-mono text-gray-600">{diagInfo}</span>}
      {status === 'error' && (
        <span className="text-xs font-medium text-red-500">
          Erro: {errMsg || 'falha desconhecida'}
        </span>
      )}
    </div>
  )
}
