'use client'

import { useState, useRef } from 'react'
import { toast } from 'react-hot-toast'

interface Props {
  userId:   string
  userName: string
}

interface ConfirmState {
  existingCount: number
  file: File
}

export function PalpitesModal({ userId, userName }: Props) {
  const [open,         setOpen]         = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [result,       setResult]       = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleClose = () => {
    setOpen(false)
    setResult(null)
    setConfirmState(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const doUpload = async (file: File, force = false) => {
    setUploading(true)
    setResult(null)
    try {
      const form = new FormData()
      form.set('userId', userId)
      form.set('file', file)
      if (force) form.set('force', 'true')

      const res  = await fetch('/api/admin/palpites/import', { method: 'POST', body: form })
      const data = await res.json() as Record<string, unknown>

      if (!res.ok) {
        setResult({ ok: false, msg: String(data.error ?? 'Erro desconhecido') })
        return
      }

      if (data.needsConfirm) {
        setConfirmState({ existingCount: data.existingCount as number, file })
        return
      }

      const parts: string[] = []
      if ((data.updated as number) > 0) parts.push(`${data.updated} palpite(s) de jogos`)
      if ((data.bonus   as number) > 0) parts.push(`${data.bonus} aposta(s) de bônus`)
      if ((data.skipped as number) > 0) parts.push(`${data.skipped} ignorado(s)`)
      setResult({ ok: true, msg: `✓ ${parts.length ? parts.join(' · ') : 'Nenhum dado importado'}` })

      const warnings = data.warnings as string[] | undefined
      warnings?.forEach(w => toast(w, { icon: '⚠️' }))
    } catch {
      setResult({ ok: false, msg: 'Falha ao enviar o arquivo.' })
    } finally {
      setUploading(false)
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) return
    await doUpload(file)
  }

  const handleConfirm = async () => {
    if (!confirmState) return
    const file = confirmState.file
    setConfirmState(null)
    await doUpload(file, true)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Gerenciar palpites"
        className="rounded p-1.5 text-gray-300 hover:bg-blue-50 hover:text-blue-500 transition"
      >
        <SpreadsheetIcon />
      </button>

      {/* Modal principal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between rounded-t-2xl bg-gray-900 px-5 py-3">
              <span className="text-sm font-black uppercase tracking-wide text-white">
                Palpites — {userName}
              </span>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-5 flex flex-col gap-5">
              {/* Download */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Download</p>
                <div className="flex gap-2">
                  <a
                    href={`/api/admin/palpites/export?userId=${encodeURIComponent(userId)}&blank=1`}
                    download
                    className="flex-1 rounded-lg py-2 text-center text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                  >
                    📄 Modelo em branco
                  </a>
                  <a
                    href={`/api/admin/palpites/export?userId=${encodeURIComponent(userId)}`}
                    download
                    className="flex-1 rounded-lg py-2 text-center text-xs font-semibold bg-verde-50 text-verde-700 hover:bg-verde-100 transition"
                  >
                    📥 Palpites atuais
                  </a>
                </div>
              </div>

              {/* Upload */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Importar palpites</p>
                <form onSubmit={handleUpload} className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx"
                    className="flex-1 text-xs text-gray-600
                      file:mr-2 file:rounded file:border-0
                      file:bg-gray-100 file:px-2 file:py-1
                      file:text-xs file:font-medium file:text-gray-600
                      hover:file:bg-gray-200 cursor-pointer"
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="shrink-0 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 transition"
                    style={{ backgroundColor: '#009c3b' }}
                  >
                    {uploading ? '…' : 'Importar'}
                  </button>
                </form>
                <p className="mt-1.5 text-xs text-gray-400">
                  Prazos são ignorados — o admin pode importar em qualquer etapa.
                </p>
              </div>

              {/* Resultado */}
              {result && (
                <p className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  result.ok
                    ? 'bg-verde-50 text-verde-700'
                    : 'bg-red-50 text-red-600'
                }`}>
                  {result.msg}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6 text-center">
            <p className="text-3xl mb-3">⚠️</p>
            <p className="text-sm font-bold text-gray-800 mb-1">
              {userName} já possui {confirmState.existingCount} registro(s) de palpites.
            </p>
            <p className="text-xs text-gray-500 mb-6">
              Deseja sobrescrever os palpites existentes com o arquivo enviado?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmState(null)}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={uploading}
                className="flex-1 rounded-lg py-2.5 text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {uploading ? '…' : 'Sobrescrever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SpreadsheetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2v2h2V6H5zm0 4v2h2v-2H5zm0 4v2h2v-2H5zm4-8v2h2V6H9zm0 4v2h2v-2H9zm0 4v2h2v-2H9zm4-8v2h2V6h-2zm0 4v2h2v-2h-2zm0 4v2h2v-2h-2z" clipRule="evenodd" />
    </svg>
  )
}
