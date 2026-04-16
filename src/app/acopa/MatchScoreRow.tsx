'use client'

import { useTransition, useState, useEffect, useRef } from 'react'
import { saveOfficialScore, savePenaltyWinner } from './actions'
import { Flag } from '@/components/ui/Flag'
import { formatBrasilia } from '@/utils/date'

interface MatchRow {
  id: string
  match_number: number
  phase: string
  group_name: string | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  match_datetime: string
  city: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
  is_brazil: boolean
}

interface Props {
  match: MatchRow
  canEdit: boolean
  onPenaltyUpdate?: (matchId: string, winner: string | null) => void
}

const KNOCKOUT_PHASES = new Set(['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'])

export function MatchScoreRow({ match, canEdit, onPenaltyUpdate }: Props) {
  const [pending, startTransition]  = useTransition()
  const [home, setHome]             = useState(match.score_home?.toString() ?? '')
  const [away, setAway]             = useState(match.score_away?.toString() ?? '')
  const [error, setError]           = useState('')
  const [confirmScore, setConfirmScore] = useState<{ h: number; a: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const homeRef  = useRef(home)
  const awayRef  = useRef(away)

  // Sincroniza campos quando o placar muda externamente (realtime de outro usuário)
  useEffect(() => {
    if (match.score_home !== null && match.score_away !== null) {
      const h = match.score_home.toString()
      const a = match.score_away.toString()
      setHome(h); setAway(a)
      homeRef.current = h; awayRef.current = a
    } else {
      setHome(''); setAway('')
      homeRef.current = ''; awayRef.current = ''
    }
  }, [match.score_home, match.score_away])

  const hasScore   = match.score_home !== null && match.score_away !== null
  const isDraw     = hasScore && match.score_home === match.score_away
  const isKnockout = KNOCKOUT_PHASES.has(match.phase)
  const showPenalty = isKnockout && isDraw

  const doSave = (h: number, a: number) => {
    setError('')
    startTransition(async () => {
      const r1 = await saveOfficialScore(match.id, h, a)
      if (r1.error) { setError(r1.error); return }
      if (h !== a && isKnockout) {
        const r2 = await savePenaltyWinner(match.id, null)
        if (r2.error) setError(r2.error)
      }
    })
  }

  const doClear = () => {
    setError('')
    startTransition(async () => {
      const r1 = await saveOfficialScore(match.id, null, null)
      if (r1.error) { setError(r1.error); return }
      if (isKnockout) {
        const r2 = await savePenaltyWinner(match.id, null)
        if (r2.error) setError(r2.error)
      }
    })
  }

  const doPenalty = (winner: string | null) => {
    setError('')
    startTransition(async () => {
      const r = await savePenaltyWinner(match.id, winner)
      if (r.error) setError(r.error)
      else onPenaltyUpdate?.(match.id, winner)
    })
  }

  const triggerSave = (h: string, a: string) => {
    clearTimeout(timerRef.current)
    // Ambos vazios com placar existente → apagar
    if (h === '' && a === '' && hasScore) {
      timerRef.current = setTimeout(() => doClear(), 800)
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

  const rowBg = match.is_brazil ? 'bg-verde-50/60' : ''

  return (
    <>
      <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-gray-50/60`}>
        {/* # */}
        <td className="py-2.5 text-xs text-gray-400 whitespace-nowrap">
          <div className={`flex items-center gap-1 pl-1.5 sm:gap-1.5 sm:pl-3 ${match.is_brazil ? 'border-l-4 border-verde-500' : 'border-l-4 border-transparent'}`}>
            <span className="font-mono">{match.match_number}</span>
            {match.is_brazil && (
              <span className="inline-flex items-center rounded-full bg-verde-100 px-1.5 py-0.5 text-[10px] font-black text-verde-700 leading-none">
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

        {/* Placar */}
        <td className="px-1 py-2.5 text-center sm:px-3">
          {canEdit ? (
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
          ) : hasScore ? (
            <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-600">
              <span>🔒</span>
              <span>{match.score_home}–{match.score_away}</span>
            </span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
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
                  onClick={() => {
                    setConfirmScore(null)
                    setHome(''); setAway('')
                    homeRef.current = ''; awayRef.current = ''
                  }}
                  className="rounded bg-white border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                >
                  Corrigir
                </button>
              </div>
            </div>
          )}

          {pending && !confirmScore && (
            <span className="block mt-0.5 text-xs text-gray-400">…</span>
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
          <div>{formatBrasilia(match.match_datetime, 'dd/MM HH:mm')}</div>
          <div className="text-gray-300">{match.city}</div>
        </td>
      </tr>

      {/* Linha de pênaltis — empate em mata-mata */}
      {showPenalty && (
        <tr className={`border-b border-gray-100 ${rowBg}`}>
          <td colSpan={5} className="pb-2 pt-0 pl-4 sm:pl-6">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-amber-700">🥅 Pênaltis:</span>
              {[match.team_home, match.team_away].map(team => {
                const isWinner = match.penalty_winner === team
                return (
                  <button
                    key={team}
                    onClick={() => canEdit && doPenalty(isWinner ? null : team)}
                    disabled={!canEdit || pending}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold transition ${
                      isWinner
                        ? 'bg-amber-400 text-amber-900'
                        : canEdit
                          ? 'bg-gray-100 text-gray-600 hover:bg-amber-100 hover:text-amber-800 cursor-pointer'
                          : 'bg-gray-100 text-gray-400 cursor-default'
                    }`}
                  >
                    {isWinner && '✓ '}{team}
                  </button>
                )
              })}
              {!match.penalty_winner && (
                <span className="text-gray-400 italic">não registrado</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
