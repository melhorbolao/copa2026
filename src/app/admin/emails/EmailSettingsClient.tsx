'use client'

import { useTransition } from 'react'
import { toggleEmailSetting } from '../actions'

interface Setting {
  key: string
  label: string
  description: string | null
  enabled: boolean
}

interface Stats {
  sent: number
  errors: number
  lastSent: string | null
}

interface Props {
  setting: Setting
  stats: Stats
  isCron: boolean
}

export function EmailSettingCard({ setting, stats, isCron }: Props) {
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    startTransition(async () => {
      await toggleEmailSetting(setting.key, !setting.enabled)
    })
  }

  const lastSentFmt = stats.lastSent
    ? new Date(stats.lastSent).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
    : null

  return (
    <div className={`rounded-xl border p-4 transition ${setting.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{setting.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isCron ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
              {isCron ? 'automático' : 'evento'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{setting.description}</p>

          {/* Stats */}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {stats.sent > 0 && (
              <span className="text-verde-600 font-medium">✓ {stats.sent} enviados (30d)</span>
            )}
            {stats.errors > 0 && (
              <span className="text-red-500 font-medium">✗ {stats.errors} erros (30d)</span>
            )}
            {lastSentFmt && (
              <span>último: {lastSentFmt}</span>
            )}
            {stats.sent === 0 && stats.errors === 0 && (
              <span>sem atividade recente</span>
            )}
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={toggle}
          disabled={pending}
          title={setting.enabled ? 'Clique para desativar' : 'Clique para ativar'}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
            setting.enabled ? 'bg-verde-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              setting.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
