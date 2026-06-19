'use client'

import { useState } from 'react'
import { useProgressTransition } from '@/hooks/useProgressTransition'
import { updateClassifColVisibility, updateSobeDesceVisible } from './actions'
import { RecalcButton } from '@/components/admin/RecalcButton'

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
  const [, startTransition] = useProgressTransition()

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

      {/* ── Recalcular ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-4">
          <p className="text-sm font-semibold text-gray-800 mb-0.5">⚙️ Recalcular pontuações</p>
          <p className="text-xs text-gray-400 mb-3">
            Reprocessa palpites, atualiza totais e recalcula o histórico diário usado no gráfico de Evolução.
            Execute após registrar ou corrigir resultados de jogos.
          </p>
          <RecalcButton />
        </div>
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
