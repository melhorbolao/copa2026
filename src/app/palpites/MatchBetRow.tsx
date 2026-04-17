'use client'

import { useTransition, useState, useEffect, useRef } from 'react'
import { saveBet, deleteBet } from './actions'
import { Flag } from '@/components/ui/Flag'
import { formatBrasilia, isDeadlinePassed } from '@/utils/date'

interface Bet { score_home: number; score_away: number; points: number | null }

interface Props {
  match: {
    id: string
    match_number: number
    is_brazil: boolean
    team_home: string
    team_away: string
    flag_home: string
    flag_away: string
    match_datetime: string
    city: string
    betting_deadline: string
    score_home: number | null
    score_away: number | null
  }
  bet: Bet | null
}

export function MatchBetRow({ match, bet }: Props) {
  const [pending, startTransition] = useTransition()
  const [home, setHome] = useState(bet?.score_home?.toString() ?? '')
  const [away, setAway] = useState(bet?.score_away?.toString() ?? '')
  const [error, setError] = useState('')
  const [confirmScore, setConfirmScore] = useState<{ h: number; a: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const homeRef = useRef(home)
  const awayRef = useRef(away)

  useEffect(() => {
    if (bet) {
      const h = bet.score_home.toString()
      const a = bet.score_away.toString()
      setHome(h); setAway(a)
      homeRef.current = h; awayRef.current = a
    } else {
      // Palpite removido — limpa os campos
      setHome(''); setAway('')
      homeRef.current = ''; awayRef.current = ''
    }
  }, [bet?.score_home, bet?.score_away])

  const deadlinePassed = isDeadlinePassed(match.betting_deadline)
  const hasResult = match.score_home !== null && match.score_away !== null
  const rowBg = match.is_brazil ? 'bg-verde-50/60' : ''

  const doSave = (hNum: number, aNum: number) => {
    setError('')
    startTransition(async () => {
      try {
        await saveBet(match.id, hNum, aNum)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro')
      }
    })
  }

  const doDelete = () => {
    setError('')
    startTransition(async () => {
      try {
        await deleteBet(match.id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao apagar')
        // Restaura valores anteriores se falhar
        if (bet) {
          const h = bet.score_home.toString()
          const a = bet.score_away.toString()
          setHome(h); setAway(a)
          homeRef.current = h; awayRef.current = a
        }
      }
    })
  }

  const triggerSave = (h: string, a: string) => {
    clearTimeout(timerRef.current)
    // Ambos vazios com palpite existente → apagar
    if (h === '' && a === '' && bet !== null) {
      timerRef.current = setTimeout(() => doDelete(), 800)
      return
    }
    const hNum = parseInt(h, 10)
    const aNum = parseInt(a, 10)
    if (isNaN(hNum) || isNaN(aNum) || hNum < 0 || aNum < 0) return
    timerRef.current = setTimeout(() => {
      if (hNum >= 10 || aNum >= 10) {
        setConfirmScore({ h: hNum, a: aNum })
      } else {
        doSave(hNum, aNum)
      }
    }, 800)
  }

  const handleHomeChange = (val: string) => {
    setHome(val); homeRef.current = val
    setConfirmScore(null)
    triggerSave(val, awayRef.current)
  }

  const handleAwayChange = (val: string) => {
    setAway(val); awayRef.current = val
    setConfirmScore(null)
    triggerSave(homeRef.current, val)
  }

  return (
    <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-gray-50/60`}>
      {/* # */}
      <td className="py-2.5 text-xs text-gray-400 whitespace-nowrap">
        <div className={`flex items-center gap-1 pl-1.5 sm:gap-1.5 sm:pl-3 ${match.is_brazil ? 'border-l-4 border-verde-500' : 'border-l-4 border-transparent'}`}>
          <span className="font-mono">{match.match_number}</span>
          {match.is_brazil && (
            <span
              title="Peso 2 — jogo do Brasil"
              className="inline-flex items-center rounded-full bg-verde-100 px-1.5 py-0.5 text-[10px] font-black text-verde-700 leading-none"
            >
              ×2
            </span>
          )}
        </div>
      </td>

      {/* Time da Casa */}
      <td className="w-20 px-1.5 py-2.5 text-right sm:w-auto sm:px-3">
        <div className="flex min-w-0 items-center justify-end gap-1 text-gray-900 sm:gap-1.5">
          <span className="min-w-0 truncate text-[10px] font-semibold sm:text-sm sm:whitespace-nowrap">{match.team_home}</span>
          <Flag code={match.flag_home} size="sm" className="shrink-0" />
        </div>
      </td>

      {/* Palpite */}
      <td className="px-1 py-2.5 text-center sm:px-3">
        {deadlinePassed ? (
          bet ? (
            <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-600">
              <span>🔒</span>
              <span>{bet.score_home}–{bet.score_away}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )
        ) : (
          <div className="inline-flex items-center gap-0.5 sm:gap-1">
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={home}
              onChange={e => handleHomeChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="–"
              className="w-8 rounded border border-gray-200 py-1 text-center text-sm font-bold focus:border-verde-400 focus:outline-none sm:w-10"
            />
            <span className="text-gray-300 text-xs">×</span>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={away}
              onChange={e => handleAwayChange(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="–"
              className="w-8 rounded border border-gray-200 py-1 text-center text-sm font-bold focus:border-verde-400 focus:outline-none sm:w-10"
            />
          </div>
        )}
        {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
        {confirmScore && (
          <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 shadow-sm">
            <p className="font-semibold mb-1">
              Placar incomum: {confirmScore.h} × {confirmScore.a}
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={() => { doSave(confirmScore.h, confirmScore.a); setConfirmScore(null) }}
                className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-white hover:bg-amber-600"
              >
                Confirmar
              </button>
              <button
                onClick={() => { setConfirmScore(null); setHome(''); setAway(''); homeRef.current = ''; awayRef.current = '' }}
                className="rounded bg-white border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                Corrigir
              </button>
            </div>
          </div>
        )}
      </td>

      {/* Time Visitante */}
      <td className="w-20 px-1.5 py-2.5 sm:w-auto sm:px-3">
        <div className="flex min-w-0 items-center gap-1 text-gray-900 sm:gap-1.5">
          <Flag code={match.flag_away} size="sm" className="shrink-0" />
          <span className="min-w-0 truncate text-[10px] font-semibold sm:text-sm sm:whitespace-nowrap">{match.team_away}</span>
        </div>
      </td>

      {/* Data · Cidade */}
      <td className="hidden px-3 py-2.5 text-xs text-gray-400 sm:table-cell whitespace-nowrap">
        <div>{formatBrasilia(match.match_datetime, "dd/MM HH:mm")}</div>
        <div className="text-gray-300">{match.city}</div>
      </td>

      {/* Prazo */}
      <td className="hidden px-3 py-2.5 text-xs text-gray-400 sm:table-cell whitespace-nowrap">
        {formatBrasilia(match.betting_deadline, "dd/MM HH:mm")}
      </td>

      {/* Status */}
      <td className="px-1.5 py-2.5 text-right sm:px-3">
        {hasResult && bet ? (
          <PointsBadge points={bet.points} />
        ) : hasResult && !bet ? (
          <span className="text-xs text-gray-300">—</span>
        ) : pending ? (
          <span className="text-xs text-gray-400">…</span>
        ) : null}
      </td>
    </tr>
  )
}

function PointsBadge({ points }: { points: number | null }) {
  if (points === null) return <span className="text-xs text-gray-300">⌛</span>
  if (points === 0)   return <span className="text-xs text-gray-400">✗</span>
  if (points >= 10)  return <span className="text-xs font-black text-amarelo-600">🎯 {points}</span>
  if (points >= 5)   return <span className="text-xs font-bold text-verde-600">{points}</span>
  return <span className="text-xs font-medium text-gray-500">{points}</span>
}
