'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  nextStageLabel: string | null
  /** True quando pelo menos um participante já foi eliminado por corte. Só
   *  então os botões "Apenas ativos / Todos" aparecem. */
  hasAnyEliminated: boolean
}

export function ParticipantesFilter({ nextStageLabel, hasAnyEliminated }: Props) {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const raw         = searchParams.get('filter') ?? ''

  // Quando há eliminados, sem param na URL significa "apenas ativos" (default
  // da nova feature). Quando não há, default volta a ser "todos" (sem mudar UX
  // prévia para torneios pré-mata-mata).
  const active = raw || (hasAnyEliminated ? 'ativos' : '')

  const set = (v: string) => {
    const p = new URLSearchParams(searchParams.toString())
    if (v) { p.set('filter', v) } else { p.delete('filter') }
    router.push(`?${p.toString()}`)
  }

  const baseOptions: { value: string; label: string }[] = []
  if (hasAnyEliminated) {
    baseOptions.push(
      { value: 'ativos', label: 'Apenas ativos' },
      { value: 'todos',  label: 'Todos (inclui cortados)' },
    )
  } else {
    baseOptions.push({ value: '', label: 'Todos' })
  }
  baseOptions.push({ value: 'pendente', label: '✗ Pagamento pendente' })
  baseOptions.push({ value: 'pago',    label: '✓ Pagamento ok' })
  if (nextStageLabel) {
    baseOptions.push({ value: 'incompleto', label: `< 100% ${nextStageLabel}` })
    baseOptions.push({ value: 'completo',   label: `100% ${nextStageLabel}` })
  }

  return (
    <div className="flex flex-wrap gap-2">
      {baseOptions.map(opt => {
        const isActive = active === opt.value || (opt.value === '' && active === '')
        return (
          <button
            key={opt.value || 'all'}
            onClick={() => set(opt.value)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isActive
                ? 'border-azul-escuro bg-azul-escuro text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
