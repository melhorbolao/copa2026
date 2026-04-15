'use client'

import { useState, useTransition, useEffect } from 'react'
import { saveThirdPlaceBet, deleteThirdPlaceBet } from './actions'
import { isDeadlinePassed, formatBrasilia } from '@/utils/date'
import { useThirdPlace } from './ThirdPlaceContext'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']
const MAX = 8

interface Team  { team: string; flag: string }
interface Bet   { group_name: string; team: string }

const CONFLICT_TITLE = 'Alerta informativo: o palpite de classificado(s) está divergente da classificação decorrente dos palpites dos jogos. A regra do Melhor Bolão permite essa "incoerência".'

function ConflictDot() {
  return (
    <span
      title={CONFLICT_TITLE}
      className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white"
    >!</span>
  )
}

interface Props {
  groupTeams: Record<string, { teams: Team[]; deadline: string }>
  deadline: string
  existingBets: Bet[] | null
  groupBets?: Record<string, { first_place: string; second_place: string } | undefined>
  calculatedThirds?: Record<string, { third: string; tiedTeams: string[] }>
}

export function ThirdPlaceSection({ groupTeams, deadline, existingBets, groupBets, calculatedThirds }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [selections, setSelections] = useState<Record<string, string>>(
    () => Object.fromEntries((existingBets ?? []).map(b => [b.group_name, b.team]))
  )

  const { setThirdSelections } = useThirdPlace()

  // Sincroniza quando o servidor revalida (ex: auto-preenchimento)
  useEffect(() => {
    setSelections(Object.fromEntries((existingBets ?? []).map(b => [b.group_name, b.team])))
  }, [JSON.stringify(existingBets)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setThirdSelections(selections)
  }, [selections]) // eslint-disable-line react-hooks/exhaustive-deps

  const deadlinePassed  = isDeadlinePassed(deadline)
  const selectedGroups  = Object.keys(selections)
  const selectedCount   = selectedGroups.length

  // Times disponíveis para 3º lugar: exclui 1º e 2º apostados
  const availableTeams = (g: string): Team[] => {
    const all = groupTeams[g]?.teams ?? []
    const bet = groupBets?.[g]
    if (!bet) return all
    return all.filter(t => t.team !== bet.first_place && t.team !== bet.second_place)
  }

  const toggleGroup = (g: string) => {
    setError('')
    if (g in selections) {
      setSelections(prev => { const next = { ...prev }; delete next[g]; return next })
      startTransition(() =>
        deleteThirdPlaceBet(g)
          .catch(e => setError(e instanceof Error ? e.message : 'Erro ao remover.'))
      )
    } else {
      if (selectedCount >= MAX) return
      setSelections(prev => ({ ...prev, [g]: '' }))
    }
  }

  const setTeam = (g: string, team: string) => {
    setError('')
    setSelections(prev => ({ ...prev, [g]: team }))
    if (team) {
      startTransition(() =>
        saveThirdPlaceBet(g, team)
          .catch(e => setError(e instanceof Error ? e.message : 'Erro ao salvar.'))
      )
    }
  }

  // ── Vista encerrada ────────────────────────────────────────
  if (deadlinePassed) {
    return (
      <div className="border-t-4 border-gray-300 bg-white">
        <div className="flex items-center gap-3 bg-gray-900 px-4 py-2.5">
          <span className="text-sm font-black uppercase tracking-widest text-white">
            🥉 Terceiros Classificados
          </span>
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
            🔒 encerrado
          </span>
        </div>
        {existingBets?.length ? (
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-gray-100 sm:grid-cols-4">
            {existingBets.map(b => (
              <div key={b.group_name} className="px-4 py-3">
                <div className="text-xs text-gray-400">Gr. {b.group_name}</div>
                <div className="mt-0.5 flex items-center gap-1 font-bold text-gray-900 text-sm">
                  {b.team}
                  {b.team && calculatedThirds?.[b.group_name] &&
                    b.team !== calculatedThirds[b.group_name].third &&
                    !calculatedThirds[b.group_name].tiedTeams.includes(b.team) && <ConflictDot />}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-400">Sem palpite de terceiros registrado.</p>
        )}
      </div>
    )
  }

  // ── Vista editável ─────────────────────────────────────────
  return (
    <div className="border-t-4 border-gray-300 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-black uppercase tracking-widest text-white">
            🥉 Terceiros Classificados
          </span>
          {pending && (
            <span className="text-xs text-gray-400 animate-pulse">Salvando…</span>
          )}
          {!pending && selectedCount > 0 && !error && (
            <span className="text-xs text-verde-400">✓ salvo automaticamente</span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          prazo: {formatBrasilia(deadline, 'dd/MM HH:mm')}
        </span>
      </div>

      <div className="p-4">
        {/* Instrução + contador */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Escolha <strong>8 grupos</strong> cujo 3º lugar avançará ao mata-mata e indique o time.
          </p>
          <span className={`text-xs font-black tabular-nums ${
            selectedCount === MAX ? 'text-verde-600' : 'text-gray-400'
          }`}>
            {selectedCount}/{MAX}
          </span>
        </div>

        {/* Grid de grupos */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {GROUP_ORDER.map(g => {
            const isSelected = g in selections
            const maxReached = selectedCount >= MAX && !isSelected
            const teams      = availableTeams(g)
            const hasSavedBet = !!(existingBets ?? []).find(b => b.group_name === g)
            const teamValue  = selections[g] ?? ''

            return (
              <div
                key={g}
                className={`rounded-xl border p-2 transition ${
                  isSelected
                    ? 'border-verde-400 bg-verde-50'
                    : maxReached
                      ? 'border-gray-100 bg-gray-50 opacity-40'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(g)}
                  disabled={maxReached}
                  className="flex w-full items-center justify-between"
                >
                  <span className="text-xs font-black text-gray-700">Gr. {g}</span>
                  <span className={`text-xs font-bold ${
                    isSelected ? 'text-red-400 hover:text-red-600' : 'text-gray-300'
                  }`}>
                    {isSelected ? '✕' : '+'}
                  </span>
                </button>

                {isSelected && (
                  <div className="mt-1.5">
                    <div className="relative">
                      <select
                        value={teamValue}
                        onChange={e => setTeam(g, e.target.value)}
                        className="w-full rounded border border-gray-200 py-1 px-1 text-xs focus:border-verde-400 focus:outline-none"
                      >
                        <option value="">— time —</option>
                        {teams.map(t => (
                          <option key={t.team} value={t.team}>{t.team}</option>
                        ))}
                      </select>
                    </div>
                    {teamValue && calculatedThirds?.[g] &&
                      teamValue !== calculatedThirds[g].third &&
                      !calculatedThirds[g].tiedTeams.includes(teamValue) && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <ConflictDot />
                        <span className="text-[10px] text-red-500">divergente</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-500">{error}</p>
        )}
      </div>
    </div>
  )
}
