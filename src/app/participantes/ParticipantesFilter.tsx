'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  nextStageLabel: string | null
  hasAnyEliminated: boolean
  fillCounts: { zerado: number; parcial: number; completo: number } | null
}

export function ParticipantesFilter({ nextStageLabel, hasAnyEliminated, fillCounts }: Props) {
  const router      = useRouter()
  const searchParams = useSearchParams()

  const currentFilter    = searchParams.get('filter')    ?? ''
  const currentPagamento = searchParams.get('pagamento') ?? ''
  const currentPalpite   = searchParams.get('palpite')   ?? ''

  const viewFilter = currentFilter || (hasAnyEliminated ? 'ativos' : '')

  const setParam = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else       p.delete(key)
    router.push(`?${p.toString()}`)
  }

  const toggleParam = (key: string, value: string, current: string) =>
    setParam(key, current === value ? '' : value)

  const pill = (active: boolean, color: 'blue' | 'red' | 'green' | 'amber') => {
    const on: Record<string, string> = {
      blue:  'border-azul-escuro bg-azul-escuro text-white',
      red:   'border-red-500    bg-red-500    text-white',
      green: 'border-verde-600  bg-verde-600  text-white',
      amber: 'border-amber-500  bg-amber-500  text-white',
    }
    return `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active ? on[color] : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
    }`
  }

  return (
    <div className="flex flex-col gap-2">

      {/* View toggle — só quando há eliminados */}
      {hasAnyEliminated && (
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'ativos', label: 'Apenas ativos' },
            { value: 'todos',  label: 'Todos (inclui cortados)' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setParam('filter', viewFilter === opt.value ? '' : opt.value)}
              className={pill(viewFilter === opt.value, 'blue')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Filtros combináveis: pagamento + preenchimento */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => toggleParam('pagamento', 'pendente', currentPagamento)}
          className={pill(currentPagamento === 'pendente', 'red')}
        >
          ✗ Pendente
        </button>
        <button
          onClick={() => toggleParam('pagamento', 'pago', currentPagamento)}
          className={pill(currentPagamento === 'pago', 'green')}
        >
          ✓ Pago
        </button>

        {nextStageLabel && fillCounts && (
          <>
            <span className="text-gray-300 select-none">|</span>
            <button
              onClick={() => toggleParam('palpite', 'zerado', currentPalpite)}
              className={pill(currentPalpite === 'zerado', 'red')}
            >
              Zerado · {fillCounts.zerado}
            </button>
            <button
              onClick={() => toggleParam('palpite', 'parcial', currentPalpite)}
              className={pill(currentPalpite === 'parcial', 'amber')}
            >
              Parcial · {fillCounts.parcial}
            </button>
            <button
              onClick={() => toggleParam('palpite', 'completo', currentPalpite)}
              className={pill(currentPalpite === 'completo', 'green')}
            >
              Completo · {fillCounts.completo}
            </button>
          </>
        )}

        {(currentPagamento || currentPalpite) && (
          <button
            onClick={() => {
              const p = new URLSearchParams(searchParams.toString())
              p.delete('pagamento')
              p.delete('palpite')
              router.push(`?${p.toString()}`)
            }}
            className="text-xs text-gray-400 hover:text-gray-600 transition"
          >
            limpar
          </button>
        )}
      </div>
    </div>
  )
}
