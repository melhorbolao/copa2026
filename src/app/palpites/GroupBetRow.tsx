'use client'

import { useTransition, useState, useEffect } from 'react'
import { saveGroupBet } from './actions'
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
  existingBet: { first_place: string; second_place: string } | null
  calculatedTop?: { first: string; second: string; third: string; tiedTeams: string[] }
}

export function GroupBetRow({ groupName, teams, deadline, existingBet, calculatedTop }: Props) {
  const [pending, startTransition] = useTransition()
  const [first,  setFirst]  = useState(existingBet?.first_place  ?? '')
  const [second, setSecond] = useState(existingBet?.second_place ?? '')
  const [error,  setError]  = useState('')

  const { thirdSelections } = useThirdPlace()
  const thirdTeam = thirdSelections[groupName] ?? ''

  const deadlinePassed = isDeadlinePassed(deadline)

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
  const tiedArr    = calculatedTop?.tiedTeams ?? []
  const areTied    = (a: string, b: string) => tiedArr.includes(a) && tiedArr.includes(b)

  const firstConflict  = !!first  && !!calcFirst  && first  !== calcFirst  && !areTied(first,  calcFirst)
  const secondConflict = !!second && !!calcSecond && second !== calcSecond && !areTied(second, calcSecond)

  return (
    <tr className="border-b border-gray-100 bg-blue-50/30 hover:bg-blue-50/50">
      <td colSpan={7} className="px-2 py-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">

          {/* Rótulo do grupo */}
          <span className="w-8 shrink-0 text-xs font-bold text-gray-500">
            Gr. {groupName}
          </span>

          {/* Times: nomes visíveis apenas em sm+; no mobile o div age como espaçador flex-1 */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            {teams.map(t => (
              <span key={t.team} className="hidden sm:flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                <Flag code={t.flag} size="sm" className="!h-3 !w-4 shrink-0" />
                <span>{t.team}</span>
              </span>
            ))}
          </div>

          {/* Seletores ou leitura após prazo */}
          {deadlinePassed ? (
            <div className="flex shrink-0 items-center gap-3">
              {existingBet ? (
                <>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥇 {existingBet.first_place}
                    {!!calcFirst && existingBet.first_place !== calcFirst && !areTied(existingBet.first_place, calcFirst) && <ConflictDot />}
                  </span>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥈 {existingBet.second_place}
                    {!!calcSecond && existingBet.second_place !== calcSecond && !areTied(existingBet.second_place, calcSecond) && <ConflictDot />}
                  </span>
                </>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>
          ) : (
            <>
              {/* 1º lugar */}
              <div className="flex w-28 sm:w-36 shrink-0 items-center gap-1">
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
                    onClick={() => setFirst('')}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* 2º lugar */}
              <div className="flex w-28 sm:w-36 shrink-0 items-center gap-1">
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
                    onClick={() => setSecond('')}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>
            </>
          )}

          {/* Status */}
          <div className="w-5 shrink-0 text-right">
            {pending && (
              <span className="text-xs text-gray-400">…</span>
            )}
          </div>

        </div>
        {error && <p className="mt-0.5 pl-10 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  )
}
