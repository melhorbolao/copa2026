'use client'

import { useTransition, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveTournamentBet } from './actions'
import { Countdown } from '@/components/ui/Countdown'
import { isDeadlinePassed } from '@/utils/date'

interface Team {
  team: string
  flag: string
}

interface ExistingBet {
  champion: string
  runner_up: string
  semi1: string
  semi2: string
  top_scorer: string
}

interface Props {
  allTeams: Team[]
  deadline: string        // betting_deadline do 1º jogo do torneio
  existingBet: ExistingBet | null
}

const EMPTY: ExistingBet = { champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '' }

export function TournamentBetForm({ allTeams, deadline, existingBet }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<ExistingBet>(existingBet ?? EMPTY)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState('')

  const deadlinePassed = isDeadlinePassed(deadline)
  const hasBet = !!existingBet

  useEffect(() => {
    if (existingBet) setForm(existingBet)
  }, [existingBet])

  const set = (field: keyof ExistingBet) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [field]: e.target.value }))
    setJustSaved(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setJustSaved(false)

    startTransition(async () => {
      try {
        await saveTournamentBet(form)
        setJustSaved(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  // ── Exibição quando prazo encerrado ───────────────────────
  if (deadlinePassed) {
    if (!existingBet) {
      return (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 text-center text-sm text-gray-400">
          🔒 Prazo encerrado — sem palpite de torneio registrado.
        </div>
      )
    }
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 space-y-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-black text-gray-900">Suas apostas de torneio</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">🔒 encerrado</span>
        </div>
        {([
          ['Campeão',        existingBet.champion],
          ['Vice-Campeão',   existingBet.runner_up],
          ['Semifinalista 1',existingBet.semi1],
          ['Semifinalista 2',existingBet.semi2],
          ['Artilheiro',     existingBet.top_scorer],
        ] as [string,string][]).map(([label, value]) => (
          <div key={label} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-0">
            <span className="text-sm text-gray-500">{label}</span>
            <span className="font-bold text-gray-900">{value}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── Formulário aberto ──────────────────────────────────────
  const teamOptions = allTeams.filter(t => t.team !== 'TBD')

  // Opções filtradas por seleção atual (evitar repetição entre campos de seleção)
  const selectedMain = [form.champion, form.runner_up, form.semi1, form.semi2]

  function teamSelect(
    field: 'champion' | 'runner_up' | 'semi1' | 'semi2',
    label: string,
    description: string,
  ) {
    const others = selectedMain.filter((_, i) => {
      const fields = ['champion', 'runner_up', 'semi1', 'semi2'] as const
      return fields[i] !== field
    })
    return (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-700">
          {label}
          <span className="ml-1 text-xs font-normal text-gray-400">{description}</span>
        </label>
        <select
          value={form[field]}
          onChange={set(field)}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
        >
          <option value="">— selecione a seleção —</option>
          {teamOptions.map(t => (
            <option
              key={t.team}
              value={t.team}
              disabled={others.includes(t.team)}
            >
              {t.team}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-gray-900">Aposta de Torneio</h3>
        {hasBet && (
          <span className="rounded-full bg-verde-100 px-2 py-0.5 text-xs font-semibold text-verde-700">✓ salvo</span>
        )}
      </div>

      <Countdown deadline={deadline} label="Prazo:" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {teamSelect('champion',   '🥇 Campeão',         'vence a final')}
        {teamSelect('runner_up',  '🥈 Vice-Campeão',    'perde a final')}
        {teamSelect('semi1',      '🥉 Semifinalista 1', 'perde a semi')}
        {teamSelect('semi2',      '4º Semifinalista 2', 'perde a semi')}
      </div>

      {/* Artilheiro */}
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-700">
          ⚽ Artilheiro
          <span className="ml-1 text-xs font-normal text-gray-400">nome completo do jogador</span>
        </label>
        <input
          type="text"
          value={form.top_scorer}
          onChange={set('top_scorer')}
          placeholder="Ex: Vinicius Jr."
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-verde-500 focus:outline-none focus:ring-1 focus:ring-verde-500"
        />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl px-6 py-2 font-bold text-white transition disabled:opacity-40"
          style={{ backgroundColor: '#009c3b' }}
        >
          {pending ? '…' : hasBet ? 'Atualizar aposta' : 'Salvar aposta'}
        </button>
        {justSaved && !pending && (
          <span className="text-sm font-medium text-verde-600">✓ Salvo!</span>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <p className="text-xs text-gray-400">
        Semifinalistas = as duas seleções que perdem nas semifinais (3º e 4º lugares).
      </p>
    </form>
  )
}
