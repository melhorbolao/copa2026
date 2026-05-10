'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const STAGES = [
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
}

export function StageFilter({ defaultActiveRound }: Props) {
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

  const btn = (label: string, value: string) => (
    <button
      key={value}
      onClick={() => set(value)}
      className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
        active === value
          ? 'bg-azul-escuro text-white shadow-sm'
          : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-wrap gap-1.5">
      {btn('Todos', 'todos')}
      {STAGES.map(s => btn(s.label, s.value))}
    </div>
  )
}
