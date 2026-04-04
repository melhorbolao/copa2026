'use client'

import { useTransition, useState } from 'react'
import { saveMatchScore } from '../actions'

interface Props {
  matchId: string
  teamHome: string
  teamAway: string
  scoreHome: number | null
  scoreAway: number | null
  betsCount: number
}

export function MatchScoreForm({
  matchId,
  teamHome,
  teamAway,
  scoreHome,
  scoreAway,
  betsCount,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [home, setHome] = useState(scoreHome?.toString() ?? '')
  const [away, setAway] = useState(scoreAway?.toString() ?? '')
  const [error, setError] = useState('')

  const hasScore = scoreHome !== null && scoreAway !== null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Ambos preenchidos ou ambos vazios
    if ((home === '') !== (away === '')) {
      setError('Preencha o placar dos dois times ou deixe ambos em branco.')
      return
    }

    const parsedHome = home === '' ? null : parseInt(home, 10)
    const parsedAway = away === '' ? null : parseInt(away, 10)

    startTransition(() => saveMatchScore(matchId, parsedHome, parsedAway))
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      {/* Time casa */}
      <span className="text-xs font-medium text-gray-600 max-w-[80px] truncate" title={teamHome}>
        {teamHome}
      </span>

      {/* Input casa */}
      <input
        type="number"
        min={0}
        max={99}
        value={home}
        onChange={(e) => setHome(e.target.value)}
        placeholder="—"
        className="w-12 rounded-lg border border-gray-300 px-1.5 py-1 text-center text-sm font-bold focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
      />

      <span className="text-gray-400 text-xs font-bold">×</span>

      {/* Input fora */}
      <input
        type="number"
        min={0}
        max={99}
        value={away}
        onChange={(e) => setAway(e.target.value)}
        placeholder="—"
        className="w-12 rounded-lg border border-gray-300 px-1.5 py-1 text-center text-sm font-bold focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
      />

      {/* Time fora */}
      <span className="text-xs font-medium text-gray-600 max-w-[80px] truncate" title={teamAway}>
        {teamAway}
      </span>

      {/* Botão */}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-verde-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-verde-700 disabled:opacity-50"
      >
        {pending ? '…' : hasScore ? 'Atualizar' : 'Salvar'}
      </button>

      {/* Status */}
      {hasScore && !pending && (
        <span className="text-xs text-verde-600">
          ✓ {betsCount} palpite{betsCount !== 1 ? 's' : ''} pontuado{betsCount !== 1 ? 's' : ''}
        </span>
      )}

      {/* Erro de validação */}
      {error && (
        <span className="w-full text-xs text-red-500">{error}</span>
      )}
    </form>
  )
}
