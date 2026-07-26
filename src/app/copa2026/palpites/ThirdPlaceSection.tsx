'use client'

import { useState, useTransition, useEffect, useMemo, useRef } from 'react'
import { saveThirdPlaceBet, deleteThirdPlaceBet } from './actions'
import { isDeadlinePassed, formatBrasilia } from '@/utils/date'
import { useThirdPlace } from './ThirdPlaceContext'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']
const MAX = 8

interface Team  { team: string; flag: string }
interface Bet   { group_name: string; team: string; points?: number | null }


interface Props {
  groupTeams: Record<string, { teams: Team[]; deadline: string }>
  deadline: string
  existingBets: Bet[] | null
  groupBets?: Record<string, { first_place: string; second_place: string } | undefined>
  calculatedThirds?: Record<string, { third: string; tiedTeams: string[] }>
  officialThirdTeams?: Record<string, string>   // group → official 3rd-place team (from real scores)
  thirdPts?: number
}

export function ThirdPlaceSection({ groupTeams, deadline, existingBets, groupBets, calculatedThirds, officialThirdTeams, thirdPts = 3 }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const [selections, setSelections] = useState<Record<string, string>>(
    () => Object.fromEntries((existingBets ?? []).map(b => [b.group_name, b.team]))
  )

  const { setThirdSelections, groupBetSelections } = useThirdPlace()

  // Hash leve da prop de servidor — substitui JSON.stringify em cada render
  const existingHash = useMemo(() => {
    const arr = (existingBets ?? []).map(b => b.group_name + '=' + b.team).sort()
    return arr.join(';')
  }, [existingBets])
  const lastSyncedHash = useRef(existingHash)

  // Sincroniza quando o servidor revalida (ex: auto-preenchimento)
  useEffect(() => {
    if (existingHash === lastSyncedHash.current) return
    lastSyncedHash.current = existingHash
    setSelections(Object.fromEntries((existingBets ?? []).map(b => [b.group_name, b.team])))
  }, [existingHash, existingBets])

  useEffect(() => {
    setThirdSelections(selections)
  }, [selections, setThirdSelections])

  // Ref para ler selections sem re-derivar no effect abaixo
  const selectionsRef = useRef(selections)
  selectionsRef.current = selections

  // Limpa a seleção de 3º se aquele time passou a ser 1º ou 2º do grupo
  // (ocorre quando o usuário muda a aposta de grupo manualmente após o auto-fill)
  useEffect(() => {
    const toRemove = Object.keys(selectionsRef.current).filter(g => {
      const live = groupBetSelections[g]
      if (!live) return false
      const sel = selectionsRef.current[g]
      return sel && (sel === live.first || sel === live.second)
    })
    if (toRemove.length === 0) return
    setSelections(prev => {
      const next = { ...prev }
      for (const g of toRemove) delete next[g]
      return next
    })
  }, [groupBetSelections])

  const deadlinePassed  = isDeadlinePassed(deadline)
  const selectedGroups  = Object.keys(selections)
  const selectedCount   = selectedGroups.length

  // Times disponíveis para 3º lugar: exclui 1º e 2º apostados.
  // Usa o estado vivo do contexto (atualizado pelo GroupBetRow) em vez da prop
  // estática do servidor, para refletir mudanças manuais sem precisar de refresh.
  const availableTeams = (g: string): Team[] => {
    const all = groupTeams[g]?.teams ?? []
    const live   = groupBetSelections[g]
    const server = groupBets?.[g]
    const firstTeam  = live?.first  ?? server?.first_place
    const secondTeam = live?.second ?? server?.second_place
    if (!firstTeam && !secondTeam) return all
    return all.filter(t => t.team !== firstTeam && t.team !== secondTeam)
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
            {existingBets.map(b => {
              const officialThird = officialThirdTeams?.[b.group_name]
              const isCorrect = !!officialThird && b.team === officialThird
              return (
                <div key={b.group_name} className="px-4 py-3">
                  <div className="text-xs text-gray-400">Gr. {b.group_name}</div>
                  <div className="mt-0.5 flex items-center gap-1 font-bold text-gray-900 text-sm">
                    {b.team}
                  </div>
                  <ThirdPointsBadge
                    dbPoints={b.points}
                    officialThird={officialThird}
                    isCorrect={isCorrect}
                    thirdPts={thirdPts}
                  />
                </div>
              )
            })}
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
            const savedBet   = (existingBets ?? []).find(b => b.group_name === g)
            const teamValue  = selections[g] ?? ''
            const officialThird = officialThirdTeams?.[g]
            const isCorrect     = !!officialThird && teamValue === officialThird

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
                    {savedBet && (
                      <ThirdPointsBadge
                        dbPoints={savedBet.points}
                        officialThird={officialThird}
                        isCorrect={isCorrect}
                        thirdPts={thirdPts}
                      />
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

function ThirdPointsBadge({
  dbPoints, officialThird, isCorrect, thirdPts,
}: { dbPoints?: number | null; officialThird?: string; isCorrect: boolean; thirdPts: number }) {
  // Quando o resultado oficial existe (grupo completo + habilitado p/ pontuação),
  // usa cálculo ao vivo — idêntico ao TabelaMB — para evitar divergência com
  // pontos armazenados desatualizados (ex: pts=0 gravado antes do grupo ser habilitado).
  if (officialThird) {
    return isCorrect
      ? <span className="mt-0.5 block text-xs font-bold text-verde-600">+{thirdPts} pts</span>
      : <span className="mt-0.5 block text-xs text-gray-400">0 pts</span>
  }
  // Sem resultado oficial ainda: exibe pontos armazenados no BD, se existirem
  if (dbPoints != null && dbPoints > 0) {
    return <span className="mt-0.5 block text-xs font-bold text-verde-600">+{dbPoints} pts</span>
  }
  return null
}
