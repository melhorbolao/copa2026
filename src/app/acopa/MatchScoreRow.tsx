'use client'

import { useTransition, useState, useRef } from 'react'
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
  canEdit: boolean  // computed server-side or by client clock
}

const KNOCKOUT_PHASES = new Set(['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'])

export function MatchScoreRow({ match, canEdit }: Props) {
  const [editing, setEditing]       = useState(false)
  const [home, setHome]             = useState(match.score_home?.toString() ?? '')
  const [away, setAway]             = useState(match.score_away?.toString() ?? '')
  const [error, setError]           = useState('')
  const [pending, startTransition]  = useTransition()
  const homeRef = useRef(home)
  const awayRef = useRef(away)

  const hasScore    = match.score_home !== null && match.score_away !== null
  const isDraw      = hasScore && match.score_home === match.score_away
  const isKnockout  = KNOCKOUT_PHASES.has(match.phase)
  const showPenalty = isKnockout && isDraw

  const doSave = () => {
    const h = parseInt(home, 10)
    const a = parseInt(away, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      setError('Placar inválido')
      return
    }
    setError('')
    startTransition(async () => {
      try {
        await saveOfficialScore(match.id, h, a)
        // Se o placar deixou de ser empate, limpa penalty_winner
        if (h !== a) await savePenaltyWinner(match.id, null)
        setEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro')
      }
    })
  }

  const doClear = () => {
    setError('')
    startTransition(async () => {
      try {
        await saveOfficialScore(match.id, null, null)
        await savePenaltyWinner(match.id, null)
        setHome(''); setAway('')
        homeRef.current = ''; awayRef.current = ''
        setEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro')
      }
    })
  }

  const doPenalty = (winner: string) => {
    setError('')
    startTransition(async () => {
      try {
        await savePenaltyWinner(match.id, winner)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro')
      }
    })
  }

  const startEdit = () => {
    setHome(match.score_home?.toString() ?? '')
    setAway(match.score_away?.toString() ?? '')
    homeRef.current = match.score_home?.toString() ?? ''
    awayRef.current = match.score_away?.toString() ?? ''
    setError('')
    setEditing(true)
  }

  const rowBg = match.is_brazil ? 'bg-verde-50/60' : ''

  return (
    <>
      <tr className={`border-b border-gray-100 last:border-0 ${rowBg} hover:bg-gray-50/40`}>
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

        {/* Placar / Edição */}
        <td className="px-1 py-2.5 text-center sm:px-3">
          {editing ? (
            <div className="inline-flex flex-col items-center gap-1">
              <div className="inline-flex items-center gap-0.5 sm:gap-1">
                <input
                  type="text" inputMode="numeric" pattern="[0-9]*"
                  value={home}
                  onChange={e => { setHome(e.target.value.replace(/\D/g, '').slice(0, 2)); homeRef.current = e.target.value }}
                  placeholder="–"
                  className="w-8 rounded border border-gray-300 py-1 text-center text-sm font-bold focus:border-verde-400 focus:outline-none sm:w-10"
                  autoFocus
                />
                <span className="text-gray-300 text-xs">×</span>
                <input
                  type="text" inputMode="numeric" pattern="[0-9]*"
                  value={away}
                  onChange={e => { setAway(e.target.value.replace(/\D/g, '').slice(0, 2)); awayRef.current = e.target.value }}
                  placeholder="–"
                  className="w-8 rounded border border-gray-300 py-1 text-center text-sm font-bold focus:border-verde-400 focus:outline-none sm:w-10"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={doSave}
                  disabled={pending}
                  className="rounded bg-verde-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-verde-700 disabled:opacity-50"
                >
                  {pending ? '…' : 'Salvar'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded border border-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                {hasScore && (
                  <button
                    onClick={doClear}
                    disabled={pending}
                    className="rounded border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-400 hover:bg-red-50 disabled:opacity-50"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
          ) : hasScore ? (
            <div className="inline-flex items-center gap-1">
              <span className="text-sm font-black text-gray-800">
                {match.score_home} – {match.score_away}
              </span>
              {canEdit && (
                <button
                  onClick={startEdit}
                  className="ml-1 rounded p-0.5 text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                  title="Editar placar"
                >
                  ✎
                </button>
              )}
            </div>
          ) : (
            <div className="inline-flex items-center gap-1">
              <span className="text-xs text-gray-300">–</span>
              {canEdit && (
                <button
                  onClick={startEdit}
                  className="ml-1 rounded border border-dashed border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-400 hover:border-verde-400 hover:text-verde-600"
                >
                  + placar
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
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

      {/* Linha de pênaltis — exibida abaixo quando é empate em mata-mata */}
      {showPenalty && !editing && (
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
