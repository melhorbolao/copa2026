'use client'

import { useTransition, useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { saveTournamentBet } from './actions'
import { Combobox } from '@/components/ui/Combobox'
import { isDeadlinePassed, formatBrasilia } from '@/utils/date'

interface Team { team: string; flag: string }
interface TBet { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

const EMPTY: TBet = { champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '' }

interface Props {
  allTeams: Team[]
  deadline: string
  existingBet: TBet | null
}

export function TournamentSection({ allTeams, deadline, existingBet }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<TBet>(() => existingBet
    ? {
        champion:   existingBet.champion   ?? '',
        runner_up:  existingBet.runner_up  ?? '',
        semi1:      existingBet.semi1      ?? '',
        semi2:      existingBet.semi2      ?? '',
        top_scorer: existingBet.top_scorer ?? '',
      }
    : EMPTY
  )
  const [error, setError] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const deadlinePassed = isDeadlinePassed(deadline)

  useEffect(() => {
    if (existingBet) setForm({
      champion:   existingBet.champion   ?? '',
      runner_up:  existingBet.runner_up  ?? '',
      semi1:      existingBet.semi1      ?? '',
      semi2:      existingBet.semi2      ?? '',
      top_scorer: existingBet.top_scorer ?? '',
    })
  }, [existingBet])

  const triggerSave = (updated: TBet, delay = 0) => {
    clearTimeout(timerRef.current)
    setError('')
    timerRef.current = setTimeout(() => {
      startTransition(() =>
        saveTournamentBet(updated)
          .then(() => router.refresh())
          .catch(e => setError(e instanceof Error ? e.message : 'Erro ao salvar.'))
      )
    }, delay)
  }

  const handleSelect = (field: keyof TBet, value: string) => {
    const updated = { ...form, [field]: value }
    setForm(updated)
    triggerSave(updated)
  }

  const handleScorer = (value: string) => {
    const updated = { ...form, top_scorer: value }
    setForm(updated)
    triggerSave(updated, 800)
  }

  const teams = allTeams.filter(t => t.team !== 'TBD')
  const selected = [form.champion, form.runner_up, form.semi1, form.semi2]
  const filledCount = [form.champion, form.runner_up, form.semi1, form.semi2, form.top_scorer].filter(Boolean).length

  // Detecta campos G4 com valores duplicados
  const conflictFields = new Set<string>()
  const g4Entries: [string, string][] = [
    ['champion', form.champion], ['runner_up', form.runner_up],
    ['semi1', form.semi1],       ['semi2', form.semi2],
  ]
  const seenG4 = new Map<string, string>()
  for (const [field, val] of g4Entries) {
    if (!val) continue
    if (seenG4.has(val)) { conflictFields.add(field); conflictFields.add(seenG4.get(val)!) }
    else seenG4.set(val, field)
  }

  if (deadlinePassed) {
    return (
      <div className="border-t-4 border-azul-escuro bg-white">
        <div className="flex items-center gap-3 bg-gray-900 px-4 py-2.5">
          <span className="text-sm font-black uppercase tracking-widest text-white">🏆 Bônus G4 e Artilheiro</span>
          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">🔒 encerrado</span>
        </div>
        {existingBet ? (
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-gray-100 sm:grid-cols-3 lg:grid-cols-5">
            {([
              ['🥇 Campeão',        existingBet.champion],
              ['🥈 Vice',           existingBet.runner_up],
              ['3º Semifinalista',  existingBet.semi1],
              ['4º Semifinalista',  existingBet.semi2],
              ['⚽ Artilheiro',     existingBet.top_scorer],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} className="px-4 py-3">
                <div className="text-xs text-gray-400">{label}</div>
                <div className="mt-0.5 font-bold text-gray-900">{val}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-400">Sem aposta de torneio registrada.</p>
        )}
      </div>
    )
  }

  return (
    <div className="border-t-4 border-azul-escuro bg-white">
      <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-black uppercase tracking-widest text-white">🏆 Bônus G4 e Artilheiro</span>
          {pending && (
            <span className="text-xs text-gray-400 animate-pulse">Salvando…</span>
          )}
          {!pending && filledCount > 0 && !error && (
            <span className="text-xs text-verde-400">✓ salvo automaticamente</span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          prazo: {formatBrasilia(deadline, "dd/MM HH:mm")}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {(['champion','runner_up','semi1','semi2'] as const).map((field, i) => {
            const labels = ['🥇 Campeão','🥈 Vice-Campeão','3º Semifinalista','4º Semifinalista']
            const others = selected.filter((_, j) => j !== i)
            const hasConflict = conflictFields.has(field)
            return (
              <div key={field}>
                <label className={`mb-1 block text-xs font-semibold ${hasConflict ? 'text-red-500' : 'text-gray-500'}`}>
                  {labels[i]}{hasConflict && ' ⚠️'}
                </label>
                <Combobox
                  value={form[field]}
                  onChange={v => handleSelect(field, v)}
                  options={teams.map(t => ({ value: t.team, label: t.team, disabled: others.includes(t.team) }))}
                  className={`w-full ${hasConflict ? 'ring-1 ring-red-400 rounded' : ''}`}
                />
              </div>
            )
          })}

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">⚽ Artilheiro</label>
            <input
              type="text"
              value={form.top_scorer}
              onChange={e => handleScorer(e.target.value)}
              placeholder=""
              className="w-full rounded border border-gray-200 py-1 px-1.5 text-xs focus:border-verde-400 focus:outline-none"
            />
          </div>
        </div>

        {conflictFields.size > 0 && (
          <p className="mt-2 text-xs text-red-500 font-medium">
            ⚠️ Times repetidos no G4: corrija os campos marcados acima.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}
