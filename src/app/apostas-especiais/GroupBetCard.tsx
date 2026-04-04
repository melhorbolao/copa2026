'use client'

import { useTransition, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveGroupBet } from './actions'
import { Countdown } from '@/components/ui/Countdown'
import { Flag } from '@/components/ui/Flag'
import { isDeadlinePassed } from '@/utils/date'

interface Team {
  team: string
  flag: string
}

interface Props {
  groupName: string          // 'A', 'B', ...
  teams: Team[]              // exatamente 4
  deadline: string           // betting_deadline do 1º jogo do grupo
  existingBet: { first_place: string; second_place: string } | null
}

export function GroupBetCard({ groupName, teams, deadline, existingBet }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [first,   setFirst]   = useState(existingBet?.first_place  ?? '')
  const [second,  setSecond]  = useState(existingBet?.second_place ?? '')
  const [justSaved, setJustSaved] = useState(false)
  const [error,   setError]   = useState('')

  const deadlinePassed = isDeadlinePassed(deadline)
  const hasBet = !!existingBet

  useEffect(() => {
    if (existingBet) {
      setFirst(existingBet.first_place)
      setSecond(existingBet.second_place)
    }
  }, [existingBet?.first_place, existingBet?.second_place])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setJustSaved(false)

    if (!first || !second) { setError('Selecione os dois times.'); return }
    if (first === second)  { setError('1º e 2º devem ser diferentes.'); return }

    startTransition(async () => {
      try {
        await saveGroupBet(groupName, first, second)
        setJustSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  return (
    <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${
      hasBet ? 'ring-verde-200' : 'ring-gray-100'
    }`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-black text-gray-900">Grupo {groupName}</h3>
        {hasBet && !deadlinePassed && (
          <span className="rounded-full bg-verde-100 px-2 py-0.5 text-xs font-semibold text-verde-700">
            ✓ salvo
          </span>
        )}
        {hasBet && deadlinePassed && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
            🔒 encerrado
          </span>
        )}
      </div>

      {/* Times do grupo */}
      <div className="mb-3 flex flex-wrap gap-2">
        {teams.map(t => (
          <span key={t.team} className="flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700">
            <Flag code={t.flag} size="sm" />
            {t.team}
          </span>
        ))}
      </div>

      {/* Prazo encerrado */}
      {deadlinePassed ? (
        existingBet ? (
          <div className="space-y-1 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Flag code={teams.find(t => t.team === existingBet.first_place)?.flag ?? 'un'} size="sm" />
              <span><strong>1º</strong> {existingBet.first_place}</span>
            </div>
            <div className="flex items-center gap-2">
              <Flag code={teams.find(t => t.team === existingBet.second_place)?.flag ?? 'un'} size="sm" />
              <span><strong>2º</strong> {existingBet.second_place}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Sem palpite neste grupo.</p>
        )
      ) : (
        /* Formulário */
        <form onSubmit={handleSubmit} className="space-y-2">
          <Countdown deadline={deadline} label="Prazo:" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500">1º Lugar</label>
              <select
                value={first}
                onChange={e => { setFirst(e.target.value); setJustSaved(false) }}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-verde-500 focus:outline-none"
              >
                <option value="">— selecione —</option>
                {teams.map(t => (
                  <option key={t.team} value={t.team}>{t.team}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500">2º Lugar</label>
              <select
                value={second}
                onChange={e => { setSecond(e.target.value); setJustSaved(false) }}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-verde-500 focus:outline-none"
              >
                <option value="">— selecione —</option>
                {teams.filter(t => t.team !== first).map(t => (
                  <option key={t.team} value={t.team}>{t.team}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={pending || !first || !second}
              className="rounded-lg px-4 py-1.5 text-sm font-bold text-white transition disabled:opacity-40"
              style={{ backgroundColor: '#009c3b' }}
            >
              {pending ? '…' : hasBet ? 'Atualizar' : 'Salvar'}
            </button>
            {justSaved && !pending && (
              <span className="text-sm font-medium text-verde-600">✓ Salvo!</span>
            )}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </form>
      )}
    </div>
  )
}
