'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { StageKey } from '@/lib/phase-availability'

const STAGES: { label: string; value: StageKey }[] = [
  { label: 'Rodada 1',  value: 'r1'    },
  { label: 'Rodada 2',  value: 'r2'    },
  { label: 'Rodada 3',  value: 'r3'    },
  { label: '16 avos',   value: 'r32'   },
  { label: 'Oitavas',   value: 'r16'   },
  { label: 'Quartas',   value: 'qf'    },
  { label: 'Semi',      value: 'sf'    },
  { label: '3º e Final',value: 'final' },
]

interface Props {
  /** Default filter applied when no `etapa` param exists in the URL. */
  defaultActiveRound: number | null
  /** Quais etapas o participante pode preencher (admin liberou + passou no corte). */
  fillableStages: Record<StageKey, boolean>
}

export function StageFilter({ defaultActiveRound, fillableStages }: Props) {
  const router = useRouter()
  const sp     = useSearchParams()

  // Resolve qual valor está ativo agora (mesma lógica de PalpitesContent).
  const param = sp.get('etapa')
  const active = param === 'todos'
    ? 'todos'
    : (param ?? (defaultActiveRound !== null ? `r${defaultActiveRound}` : 'todos'))

  const set = (v: string) => {
    const params = new URLSearchParams(sp.toString())
    params.set('etapa', v)
    router.replace(`/palpites?${params.toString()}`)
  }

  // Etapas com preenchimento bloqueado: aparecem cinzas e clicar não navega
  // (chip disabled). Mantemos visíveis para que o participante perceba que a
  // fase existe mas ainda não está liberada (ou ele não passou no corte).
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => set('todos')}
        className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
          active === 'todos'
            ? 'bg-azul-escuro text-white shadow-sm'
            : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
        }`}
      >
        Todos
      </button>
      {STAGES.map(s => {
        const isFillable = fillableStages[s.value]
        const isActive   = active === s.value
        if (!isFillable) {
          return (
            <button
              key={s.value}
              disabled
              title="Etapa ainda não disponível para você"
              className="cursor-not-allowed rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-300 ring-1 ring-gray-100"
            >
              {s.label}
            </button>
          )
        }
        return (
          <button
            key={s.value}
            onClick={() => set(s.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
              isActive
                ? 'bg-azul-escuro text-white shadow-sm'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
