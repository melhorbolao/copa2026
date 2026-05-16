'use client'

import { useState, useTransition } from 'react'
import { updateClassifColVisibility, updateSobeDesceVisible } from './actions'

interface ColDef {
  key: string
  label: string
  description: string
  enabled: boolean
}

export function ClassificacaoAdminClient({ cols, sobeDesceVisible }: { cols: ColDef[]; sobeDesceVisible: boolean }) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(cols.map(c => [c.key, c.enabled]))
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  // ── Toggle Sobe e Desce ──────────────────────────────────────────────────
  const [sdVisible, setSdVisible]   = useState(sobeDesceVisible)
  const [sdError,   setSdError]     = useState('')
  const [sdPending, setSdPending]   = useState(false)

  const toggleSobeDesce = () => {
    const next = !sdVisible
    setSdVisible(next)
    setSdError('')
    setSdPending(true)
    startTransition(async () => {
      const res = await updateSobeDesceVisible(next)
      setSdPending(false)
      if (res.error) { setSdVisible(!next); setSdError(res.error) }
    })
  }

  // ── Captura de Snapshot ──────────────────────────────────────────────────
  const [snapshotStatus, setSnapshotStatus]   = useState<string | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotDate, setSnapshotDate]       = useState('')   // vazio = hoje (BR)

  const captureSnapshot = async () => {
    setSnapshotLoading(true)
    setSnapshotStatus(null)
    try {
      const body = snapshotDate ? JSON.stringify({ date: snapshotDate }) : '{}'
      const res  = await fetch('/api/admin/snapshots/capture', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido')
      setSnapshotStatus(`✅ Snapshot capturado: ${json.captured} participantes para ${json.date}`)
    } catch (err) {
      setSnapshotStatus(`❌ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSnapshotLoading(false)
    }
  }

  // ── Toggle de visibilidade ───────────────────────────────────────────────
  const toggle = (key: string) => {
    const next = !state[key]
    setState(prev => ({ ...prev, [key]: next }))
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
    startTransition(async () => {
      const res = await updateClassifColVisibility(key, next)
      if (res.error) {
        setState(prev => ({ ...prev, [key]: !next }))
        setErrors(prev => ({ ...prev, [key]: res.error! }))
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* ── Visibilidade Sobe e Desce ────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">📈 Exibir Sobe e Desce</p>
            <p className="mt-0.5 text-xs text-gray-400">
              Quando desativado, usuários não-admin não veem as opções de Sobe e Desce na Classificação MB.
              Admins continuam tendo acesso mesmo quando desativado.
            </p>
            {sdError && <p className="mt-1 text-xs text-red-500">{sdError}</p>}
          </div>
          <button
            onClick={toggleSobeDesce}
            disabled={sdPending}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
              sdVisible ? 'bg-verde-600' : 'bg-gray-200'
            }`}
            role="switch"
            aria-checked={sdVisible}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                sdVisible ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── Painel Sobe e Desce ─────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50 shadow-sm">
        <div className="border-b border-blue-200 bg-blue-100 px-5 py-3">
          <p className="text-sm font-bold text-blue-900">📈 Sobe e Desce — Snapshots Diários</p>
          <p className="mt-0.5 text-xs text-blue-700">
            Capture o ranking atual para habilitar comparações históricas na Classificação.
            Execute uma vez por dia (idealmente após registrar os resultados de jogos).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Data do snapshot (vazio = hoje, horário de Brasília)
            </label>
            <input
              type="date"
              value={snapshotDate}
              onChange={e => setSnapshotDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <button
            onClick={captureSnapshot}
            disabled={snapshotLoading}
            className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {snapshotLoading ? 'Capturando...' : '📸 Capturar Snapshot Diário'}
          </button>
        </div>
        {snapshotStatus && (
          <p className="border-t border-blue-200 px-5 py-2.5 text-xs font-medium text-blue-900">
            {snapshotStatus}
          </p>
        )}
      </div>

      {/* ── Visibilidade de colunas ─────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
        {cols.map(col => (
          <div key={col.key} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">{col.label}</p>
              <p className="mt-0.5 text-xs text-gray-400">{col.description}</p>
              {errors[col.key] && (
                <p className="mt-1 text-xs text-red-500">{errors[col.key]}</p>
              )}
            </div>
            <button
              onClick={() => toggle(col.key)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                state[col.key] ? 'bg-verde-600' : 'bg-gray-200'
              }`}
              role="switch"
              aria-checked={state[col.key]}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  state[col.key] ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
