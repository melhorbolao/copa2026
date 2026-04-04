'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'

export function ExcelActions() {
  const router      = useRouter()
  const fileRef     = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [emailing,  setEmailing]  = useState(false)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setImporting(true)
    const form = new FormData()
    form.append('file', file)

    try {
      const res  = await fetch('/api/palpites/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao importar.')
        return
      }
      const { updated, bonus, skipped, warnings } = data
      const parts = []
      if (updated > 0) parts.push(`${updated} jogo${updated > 1 ? 's' : ''} importado${updated > 1 ? 's' : ''}`)
      if (bonus   > 0) parts.push(`${bonus} bônus importado${bonus > 1 ? 's' : ''}`)
      if (skipped > 0) parts.push(`${skipped} ignorado${skipped > 1 ? 's' : ''} (prazo)`)
      toast.success(parts.join(' · ') || 'Nenhuma alteração.')
      if (warnings?.length > 0) {
        toast.error(`⚠️ Conflito no G4: ${warnings.join('; ')}`, { duration: 6000 })
      }
      if (updated > 0 || bonus > 0) router.refresh()
    } catch {
      toast.error('Erro ao enviar arquivo.')
    } finally {
      setImporting(false)
    }
  }

  const handleEmail = async () => {
    setEmailing(true)
    try {
      const res  = await fetch('/api/palpites/email', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erro ao enviar e-mail.')
        return
      }
      toast.success(`E-mail enviado para ${data.email}!`, { duration: 5000 })
    } catch {
      toast.error('Erro ao enviar e-mail.')
    } finally {
      setEmailing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Exportar */}
      <a
        href="/api/palpites/export"
        download
        className="flex items-center gap-1.5 rounded-lg border border-verde-200 bg-verde-50 px-3 py-1.5 text-xs font-semibold text-verde-700 hover:bg-verde-100 transition"
      >
        <DownloadIcon />
        Excel
      </a>

      {/* Importar */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
      >
        <UploadIcon />
        {importing ? 'Importando…' : 'Importar'}
      </button>

      {/* E-mail */}
      <button
        onClick={handleEmail}
        disabled={emailing}
        className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
      >
        {emailing ? <SpinnerIcon /> : <MailIcon />}
        {emailing ? 'Enviando…' : 'E-mail'}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleImport}
      />
    </div>
  )
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
