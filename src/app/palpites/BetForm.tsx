'use client'

import { useTransition, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveBet } from './actions'
import { Countdown } from '@/components/ui/Countdown'

interface Bet {
  score_home: number
  score_away: number
  points: number | null
}

interface Props {
  matchId: string
  deadline: string
  deadlinePassed: boolean
  bet: Bet | null
  resultHome: number | null
  resultAway: number | null
}

export function BetForm({
  matchId,
  deadline,
  deadlinePassed,
  bet,
  resultHome,
  resultAway,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [home, setHome] = useState(bet?.score_home?.toString() ?? '')
  const [away, setAway] = useState(bet?.score_away?.toString() ?? '')
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState('')

  // Sincroniza inputs quando bet muda (após router.refresh)
  useEffect(() => {
    if (bet) {
      setHome(bet.score_home.toString())
      setAway(bet.score_away.toString())
    }
  }, [bet?.score_home, bet?.score_away])

  const hasResult = resultHome !== null && resultAway !== null

  // ── Estado: prazo encerrado ────────────────────────────────
  if (deadlinePassed) {
    return (
      <div className="mt-3 space-y-2">
        {/* Resultado oficial */}
        {hasResult && (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Resultado</span>
            <span className="font-black text-white text-lg">
              {resultHome} × {resultAway}
            </span>
          </div>
        )}

        {/* Palpite do usuário */}
        {bet ? (
          <div className={`flex items-center justify-between rounded-lg px-4 py-2 text-sm ${
            hasResult ? pointsBadgeStyle(bet.points) : 'bg-gray-50 text-gray-700'
          }`}>
            <span className="flex items-center gap-1.5">
              <span>🔒</span>
              <span className="font-medium">Seu palpite:</span>
              <span className="font-black">{bet.score_home} × {bet.score_away}</span>
            </span>
            {hasResult && bet.points !== null && (
              <span className="font-black text-base">
                {pointsLabel(bet.points)}
              </span>
            )}
            {hasResult && bet.points === null && (
              <span className="text-xs text-gray-400">calculando…</span>
            )}
            {!hasResult && (
              <span className="text-xs text-gray-400">aguardando resultado</span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-400">
            <span>🔒</span>
            <span>Sem palpite nesta partida</span>
          </div>
        )}
      </div>
    )
  }

  // ── Estado: aberto para apostas ────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setJustSaved(false)

    if (home === '' || away === '') {
      setError('Preencha o placar dos dois times.')
      return
    }

    const h = parseInt(home, 10)
    const a = parseInt(away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      setError('Placar inválido.')
      return
    }

    startTransition(async () => {
      try {
        await saveBet(matchId, h, a)
        setJustSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar palpite.')
      }
    })
  }

  return (
    <div className="mt-3 space-y-2">
      <Countdown deadline={deadline} label="Prazo:" />

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 w-24 text-right hidden sm:block">
          Seu palpite:
        </span>
        <input
          type="number"
          min={0}
          max={99}
          value={home}
          onChange={e => { setHome(e.target.value); setJustSaved(false) }}
          placeholder="0"
          className="w-14 rounded-xl border-2 border-gray-200 px-2 py-2 text-center text-lg font-black focus:border-verde-500 focus:outline-none"
        />
        <span className="text-gray-300 font-bold text-lg">×</span>
        <input
          type="number"
          min={0}
          max={99}
          value={away}
          onChange={e => { setAway(e.target.value); setJustSaved(false) }}
          placeholder="0"
          className="w-14 rounded-xl border-2 border-gray-200 px-2 py-2 text-center text-lg font-black focus:border-verde-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="ml-1 rounded-xl px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50"
          style={{ backgroundColor: pending ? '#6b7280' : '#009c3b' }}
        >
          {pending ? '…' : bet ? 'Atualizar' : 'Apostar'}
        </button>

        {justSaved && !pending && (
          <span className="text-sm font-medium text-verde-600">✓ Salvo!</span>
        )}
      </form>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}

// ── Helpers de pontuação ──────────────────────────────────────
function pointsBadgeStyle(points: number | null) {
  if (points === 10) return 'bg-amarelo-50 text-amarelo-800'
  if (points !== null && points > 0) return 'bg-verde-50 text-verde-700'
  return 'bg-red-50 text-red-700'
}

function pointsLabel(points: number) {
  if (points === 10) return '🎯 10 pts'
  if (points === 7)  return '✓ 7 pts'
  if (points === 5)  return '✓ 5 pts'
  return '✗ 0 pts'
}
