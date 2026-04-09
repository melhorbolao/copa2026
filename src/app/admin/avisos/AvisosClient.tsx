'use client'

import { useState, useTransition } from 'react'
import { createAlert, deactivateAlert, deleteAlert } from './actions'
import type { AdminAlertRow } from '@/types/database'

// ── Fuso horário ─────────────────────────────────────────────────────────────
// Brasil: UTC-3 (sem horário de verão desde 2019)

function isoToBRT(iso: string): string {
  const brt = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 16)
}

function brtToISO(local: string): string {
  return new Date(local + ':00-03:00').toISOString()
}

function fmtBRT(iso: string): string {
  const brt = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(brt.getUTCDate())}/${p(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()} ${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())} BRT`
}

// ── Formulário de criação ────────────────────────────────────────────────────

export function CreateAlertForm() {
  const [message, setMessage]   = useState('')
  const [startAt, setStartAt]   = useState('')
  const [endAt, setEndAt]       = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!message.trim()) { setError('Mensagem obrigatória.'); return }
    if (!startAt)        { setError('Data de início obrigatória.'); return }

    startTransition(async () => {
      try {
        await createAlert({
          message,
          start_at: brtToISO(startAt),
          end_at:   endAt ? brtToISO(endAt) : null,
        })
        setMessage('')
        setStartAt('')
        setEndAt('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao criar aviso.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <h2 className="text-base font-semibold text-gray-800">Novo Aviso</h2>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Mensagem</label>
        <input
          type="text"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Ex: Prazo para Rodada 1 encerra às 14h de amanhã!"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
        />
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-medium text-gray-600 mb-1">Início (BRT)</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={e => setStartAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
          />
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-medium text-gray-600 mb-1">Fim (BRT) — opcional</label>
          <input
            type="datetime-local"
            value={endAt}
            onChange={e => setEndAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-verde-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verde-700 disabled:opacity-50 transition"
      >
        {pending ? 'Criando…' : 'Criar aviso'}
      </button>
    </form>
  )
}

// ── Lista de alertas ─────────────────────────────────────────────────────────

interface AlertListProps {
  alerts: AdminAlertRow[]
  title: string
  showActions?: boolean
}

export function AlertList({ alerts, title, showActions = true }: AlertListProps) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId]        = useState<string | null>(null)

  function handleDeactivate(id: string) {
    setBusyId(id)
    startTransition(async () => {
      try { await deactivateAlert(id) } finally { setBusyId(null) }
    })
  }

  function handleDelete(id: string) {
    if (!confirm('Excluir este aviso permanentemente?')) return
    setBusyId(id)
    startTransition(async () => {
      try { await deleteAlert(id) } finally { setBusyId(null) }
    })
  }

  if (alerts.length === 0) {
    return (
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-800">{title}</h2>
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
          Nenhum aviso.
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-gray-800">{title}</h2>
      <div className="space-y-3">
        {alerts.map(alert => {
          const isBusy = busyId === alert.id && pending
          const now    = Date.now()
          const started  = new Date(alert.start_at).getTime() <= now
          const ended    = alert.end_at ? new Date(alert.end_at).getTime() < now : false

          let badge = ''
          let badgeCls = ''
          if (!alert.is_active) {
            badge = 'Desativado'; badgeCls = 'bg-gray-100 text-gray-500'
          } else if (ended) {
            badge = 'Expirado'; badgeCls = 'bg-gray-100 text-gray-500'
          } else if (!started) {
            badge = 'Programado'; badgeCls = 'bg-blue-100 text-blue-700'
          } else {
            badge = 'Ativo'; badgeCls = 'bg-green-100 text-green-700'
          }

          return (
            <div
              key={alert.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>{badge}</span>
                  <span className="text-xs text-gray-400">
                    {fmtBRT(alert.start_at)}
                    {alert.end_at && ` → ${fmtBRT(alert.end_at)}`}
                  </span>
                </div>
                <p className="text-sm text-gray-800 break-words">{alert.message}</p>
              </div>

              {showActions && (
                <div className="flex gap-2 shrink-0">
                  {alert.is_active && !ended && (
                    <button
                      onClick={() => handleDeactivate(alert.id)}
                      disabled={isBusy}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition"
                    >
                      Desativar
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(alert.id)}
                    disabled={isBusy}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                  >
                    Excluir
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Helper export ─────────────────────────────────────────────────────────────
export { isoToBRT }
