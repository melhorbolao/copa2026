'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const OPTIONS = [
  { value: '',           label: 'Todos' },
  { value: 'pendente',   label: '✗ Pagamento pendente' },
  { value: 'incompleto', label: '< 100% próxima etapa' },
] as const

export function ParticipantesFilter({ nextStageLabel }: { nextStageLabel: string | null }) {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const active      = searchParams.get('filter') ?? ''

  const set = (v: string) => {
    const p = new URLSearchParams(searchParams.toString())
    if (v) { p.set('filter', v) } else { p.delete('filter') }
    router.push(`?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map(opt => {
        if (opt.value === 'incompleto' && !nextStageLabel) return null
        const isActive = active === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => set(opt.value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isActive
                ? 'border-azul-escuro bg-azul-escuro text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            {opt.value === 'incompleto' && nextStageLabel
              ? `< 100% ${nextStageLabel}`
              : opt.label}
          </button>
        )
      })}
    </div>
  )
}
