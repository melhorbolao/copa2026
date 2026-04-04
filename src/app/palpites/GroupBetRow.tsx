'use client'

import { useTransition, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveGroupBet } from './actions'
import { Flag } from '@/components/ui/Flag'
import { Combobox } from '@/components/ui/Combobox'
import { formatBrasilia, isDeadlinePassed } from '@/utils/date'
import { useThirdPlace } from './ThirdPlaceContext'

interface Team { team: string; flag: string }

interface Props {
  groupName: string
  teams: Team[]
  deadline: string
  existingBet: { first_place: string; second_place: string } | null
}

export function GroupBetRow({ groupName, teams, deadline, existingBet }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [first,  setFirst]  = useState(existingBet?.first_place  ?? '')
  const [second, setSecond] = useState(existingBet?.second_place ?? '')
  const [justSaved, setJustSaved] = useState(false)
  const [error,  setError]  = useState('')

  const { thirdSelections } = useThirdPlace()
  const thirdTeam = thirdSelections[groupName] ?? ''

  const deadlinePassed = isDeadlinePassed(deadline)

  useEffect(() => {
    if (existingBet) { setFirst(existingBet.first_place); setSecond(existingBet.second_place) }
  }, [existingBet?.first_place, existingBet?.second_place])

  const doSave = (f: string, s: string) => {
    if (!f || !s || f === s) return
    setError(''); setJustSaved(false)
    startTransition(async () => {
      try { await saveGroupBet(groupName, f, s); setJustSaved(true); router.refresh() }
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

  const showCheck = justSaved || (!justSaved && existingBet !== null && !pending)

  return (
    <tr className="border-b border-gray-100 bg-blue-50/30 hover:bg-gray-50/60">
      {/* Grupo */}
      <td className="px-3 py-1.5 text-xs font-bold text-gray-500 whitespace-nowrap">
        Gr. {groupName}
      </td>

      {/* Times (bandeiras) */}
      <td className="px-2 py-1.5 w-full">
        <div className="flex items-center justify-between flex-nowrap overflow-x-auto scrollbar-thin">
          {teams.map(t => (
            <span key={t.team} className="flex flex-1 items-center justify-center gap-0.5 text-[11px] text-gray-500 whitespace-nowrap max-w-[120px]">
              <Flag code={t.flag} size="sm" className="!w-4 !h-3" />
              <span className="hidden xl:inline">{t.team}</span>
            </span>
          ))}
        </div>
      </td>

      {/* 1º Lugar */}
      <td className="px-3 py-2.5 text-center">
        {deadlinePassed ? (
          existingBet ? (
            <span className="text-xs font-bold text-gray-600">🔒 {existingBet.first_place}</span>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )
        ) : (
          <Combobox
            value={first}
            onChange={handleFirst}
            placeholder="1º lugar"
            options={teams.map(t => ({ value: t.team, label: t.team, disabled: t.team === second || (!!thirdTeam && t.team === thirdTeam) }))}
            className="w-full"
          />
        )}
      </td>

      {/* 2º Lugar */}
      <td className="px-3 py-2.5">
        {deadlinePassed ? (
          existingBet ? (
            <span className="text-xs font-bold text-gray-600">{existingBet.second_place}</span>
          ) : null
        ) : (
          <Combobox
            value={second}
            onChange={handleSecond}
            placeholder="2º lugar"
            options={teams.map(t => ({ value: t.team, label: t.team, disabled: t.team === first || (!!thirdTeam && t.team === thirdTeam) }))}
            className="w-full"
          />
        )}
        {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
      </td>

      {/* Data (vazia — grupo não tem horário de jogo) */}
      <td className="hidden sm:table-cell" />

      {/* Prazo */}
      <td className="hidden px-3 py-2.5 text-xs text-gray-400 sm:table-cell whitespace-nowrap">
        {formatBrasilia(deadline, "dd/MM HH:mm")}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5 text-right">
        {pending ? (
          <span className="text-xs text-gray-400">…</span>
        ) : !deadlinePassed && showCheck ? (
          <span className="text-xs font-medium text-verde-600">✓</span>
        ) : null}
      </td>
    </tr>
  )
}
