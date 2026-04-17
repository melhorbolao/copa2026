'use client'

import { useTransition, useState, useEffect } from 'react'
import { saveGroupBet, deleteGroupBet } from './actions'
import { Flag } from '@/components/ui/Flag'
import { Combobox } from '@/components/ui/Combobox'
import { formatBrasilia, isDeadlinePassed } from '@/utils/date'
import { useThirdPlace } from './ThirdPlaceContext'

interface Team { team: string; flag: string }

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
  groupName: string
  teams: Team[]
  deadline: string
  existingBet: { first_place: string; second_place: string; points?: number | null } | null
  calculatedTop?: { first: string; second: string; third: string; tiedTeams: string[] }
  /** participantId — usado para ler a ordem manual salva no localStorage (mesma chave do GroupCard) */
  userId: string
}

export function GroupBetRow({ groupName, teams, deadline, existingBet, calculatedTop, userId }: Props) {
  const [pending, startTransition] = useTransition()
  const [first,  setFirst]  = useState(existingBet?.first_place  ?? '')
  const [second, setSecond] = useState(existingBet?.second_place ?? '')
  const [error,  setError]  = useState('')
  const [manualOrder, setManualOrder] = useState<string[] | null>(null)

  const { thirdSelections } = useThirdPlace()
  const thirdTeam = thirdSelections[groupName] ?? ''

  const deadlinePassed = isDeadlinePassed(deadline)

  // Lê a ordem manual do localStorage (mesma chave usada pelo GroupCard em Minha Tabela)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`tie_order_${userId}_${groupName}`)
      if (stored) setManualOrder(JSON.parse(stored) as string[])
    } catch { /* ignore */ }
  }, [userId, groupName])

  useEffect(() => {
    if (existingBet) { setFirst(existingBet.first_place); setSecond(existingBet.second_place) }
  }, [existingBet?.first_place, existingBet?.second_place])

  const doSave = (f: string, s: string) => {
    if (!f || !s || f === s) return
    setError('')
    startTransition(async () => {
      try { await saveGroupBet(groupName, f, s) }
      catch (err) { setError(err instanceof Error ? err.message : 'Erro') }
    })
  }

  const doClear = (clearFirst: boolean) => {
    setError('')
    const otherValue = clearFirst ? second : first
    if (clearFirst) setFirst('')
    else setSecond('')
    startTransition(async () => {
      const r = await deleteGroupBet(groupName, clearFirst ? 'first' : 'second', otherValue)
      if (r.error) setError(r.error)
    })
  }

  const handleFirst = (val: string) => {
    setFirst(val)
    if (val && second && val !== second) doSave(val, second)
  }

  const handleSecond = (val: string) => {
    setSecond(val)
    if (first && val && first !== val) doSave(first, val)
  }

  const calcFirst  = calculatedTop?.first  ?? ''
  const calcSecond = calculatedTop?.second ?? ''
  const manualFirst  = manualOrder?.[0] ?? ''
  const manualSecond = manualOrder?.[1] ?? ''

  // Conflito: palpite formal diverge da classificação calculada pelos placares
  // OU da ordem manual salva em Minha Tabela (drag-and-drop no GroupCard).
  // O alerta é apenas informativo — a regra do bolão permite a incoerência.
  const firstConflict  = !!first  && (
    (!!calcFirst  && first  !== calcFirst)  ||
    (!!manualFirst  && first  !== manualFirst)
  )
  const secondConflict = !!second && (
    (!!calcSecond && second !== calcSecond) ||
    (!!manualSecond && second !== manualSecond)
  )

  return (
    <tr className="border-b border-gray-100 bg-blue-50/30 hover:bg-blue-50/50">
      <td colSpan={7} className="px-2 py-2 sm:px-3">
        {/*
          Mobile (< sm): duas linhas — rótulo+bandeiras em cima, seletores embaixo.
          Desktop (sm+): uma linha — rótulo+times (flex-1) e seletores (shrink-0) à direita.
        */}
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">

          {/* Linha 1 / início desktop: rótulo + times */}
          <div className="flex min-w-0 items-center gap-2 sm:flex-1">
            <span className="w-8 shrink-0 text-xs font-bold text-gray-500">
              Gr. {groupName}
            </span>
            {/* Desktop: bandeira + nome */}
            <div className="hidden sm:flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              {teams.map(t => (
                <span key={t.team} className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                  <Flag code={t.flag} size="sm" className="!h-3 !w-4 shrink-0" />
                  <span>{t.team}</span>
                </span>
              ))}
            </div>
            {/* Mobile: só bandeiras */}
            <div className="flex sm:hidden min-w-0 flex-1 flex-wrap items-center gap-1">
              {teams.map(t => (
                <Flag key={t.team} code={t.flag} size="sm" className="!h-3 !w-4 shrink-0" title={t.team} />
              ))}
            </div>
          </div>

          {/* Linha 2 / fim desktop: seletores ou leitura */}
          {deadlinePassed ? (
            <div className="flex shrink-0 items-center gap-3">
              {existingBet ? (
                <>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥇 {existingBet.first_place}
                    {((!!calcFirst && existingBet.first_place !== calcFirst) || (!!manualFirst && existingBet.first_place !== manualFirst)) && <ConflictDot />}
                  </span>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥈 {existingBet.second_place}
                    {((!!calcSecond && existingBet.second_place !== calcSecond) || (!!manualSecond && existingBet.second_place !== manualSecond)) && <ConflictDot />}
                  </span>
                  <GroupPointsBadge points={existingBet.points} />
                </>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
              {/* 1º lugar — flex-1 no mobile, w-36 fixo no desktop */}
              <div className="flex flex-1 sm:w-36 sm:flex-none items-center gap-1">
                <Combobox
                  value={first}
                  onChange={handleFirst}
                  placeholder="1º lugar"
                  options={teams.map(t => ({
                    value: t.team,
                    label: t.team,
                    disabled: t.team === second || (!!thirdTeam && t.team === thirdTeam),
                  }))}
                  className="flex-1 min-w-0"
                />
                {firstConflict && <ConflictDot />}
                {first && (
                  <button
                    type="button"
                    onClick={() => doClear(true)}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* 2º lugar — flex-1 no mobile, w-36 fixo no desktop */}
              <div className="flex flex-1 sm:w-36 sm:flex-none items-center gap-1">
                <Combobox
                  value={second}
                  onChange={handleSecond}
                  placeholder="2º lugar"
                  options={teams.map(t => ({
                    value: t.team,
                    label: t.team,
                    disabled: t.team === first || (!!thirdTeam && t.team === thirdTeam),
                  }))}
                  className="flex-1 min-w-0"
                />
                {secondConflict && <ConflictDot />}
                {second && (
                  <button
                    type="button"
                    onClick={() => doClear(false)}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Status */}
              <div className="w-5 shrink-0 text-right">
                {pending && <span className="text-xs text-gray-400">…</span>}
              </div>
            </div>
          )}

        </div>
        {error && <p className="mt-0.5 pl-10 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  )
}

function GroupPointsBadge({ points }: { points: number | null | undefined }) {
  if (points === undefined) return null
  if (points === null) return <span className="text-xs text-gray-300">⌛</span>
  if (points > 0) return <span className="text-xs font-bold text-verde-600">+{points} pts</span>
  return <span className="text-xs text-gray-400">0 pts</span>
}
