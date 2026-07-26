'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'

export function ImportButton() {
  const [loading, setLoading] = useState(false)

  async function handleImport() {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/ai-import', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erro ao importar'); return }

      const ok      = data.results?.filter((r: { status: string }) => r.status === 'ok')  ?? []
      const err     = data.results?.filter((r: { status: string }) => r.status === 'erro') ?? []
      const missing = data.results?.filter((r: { status: string }) => r.status === 'arquivo_nao_encontrado') ?? []

      if (ok.length > 0)      toast.success(`${ok.length} IA(s) importada(s)`)
      if (err.length > 0)     toast.error(`${err.length} erro(s) na importação`)
      if (missing.length > 0) toast.error(`${missing.length} arquivo(s) não encontrado(s)`)

      if (ok.length > 0) setTimeout(() => window.location.reload(), 1200)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleImport}
      disabled={loading}
      className="rounded-lg border border-white/20 bg-azul-mid px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-white/40 hover:text-white/80 disabled:opacity-40"
    >
      {loading ? 'Importando…' : '↻ Re-importar palpites'}
    </button>
  )
}
