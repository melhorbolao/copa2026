'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateGoalsCount, insertTopScorer } from './actions'

export interface Bettor {
  apelido: string
  position: number | null
}

export interface TopScorerItem {
  id: string
  player_name: string
  team: string
  goals_count: number
  bettors: Bettor[]
}

interface Props {
  initialScorers: TopScorerItem[]
  showBettors: boolean
  showPositions: boolean
}

function PlayerAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-azul-mid text-sm font-bold text-white">
      {initials}
    </div>
  )
}

function GoalsControl({
  id,
  count,
  onUpdate,
}: {
  id: string
  count: number
  onUpdate: (id: string, newCount: number) => void
}) {
  const [, startTransition] = useTransition()
  const [localError, setLocalError] = useState('')

  const change = (delta: number) => {
    const next = Math.max(0, count + delta)
    onUpdate(id, next)
    setLocalError('')
    startTransition(async () => {
      const r = await updateGoalsCount(id, next)
      if (r.error) {
        setLocalError(r.error)
        onUpdate(id, count)
      }
    })
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <button
          onClick={() => change(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-bold text-gray-500 transition hover:border-azul-mid hover:bg-azul-mid hover:text-white disabled:opacity-40"
          disabled={count === 0}
          aria-label="Remover gol"
        >
          −
        </button>
        <span className="min-w-[3ch] text-center text-5xl font-black tabular-nums text-azul-navy">
          {count}
        </span>
        <button
          onClick={() => change(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-lg font-bold text-gray-500 transition hover:border-verde-600 hover:bg-verde-600 hover:text-white"
          aria-label="Adicionar gol"
        >
          +
        </button>
      </div>
      <span className="text-xs text-gray-400">
        {count === 1 ? 'gol' : 'gols'}
      </span>
      {localError && <span className="text-xs text-red-500">{localError}</span>}
    </div>
  )
}

function BettorList({
  bettors,
  showPositions,
}: {
  bettors: Bettor[]
  showPositions: boolean
}) {
  if (bettors.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {bettors.map((b, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
        >
          {b.apelido}
          {showPositions && b.position !== null && (
            <span className="text-gray-400">({b.position}º)</span>
          )}
        </span>
      ))}
    </div>
  )
}

function ScorerCard({
  scorer,
  rank,
  showBettors,
  showPositions,
  onUpdate,
}: {
  scorer: TopScorerItem
  rank: number
  showBettors: boolean
  showPositions: boolean
  onUpdate: (id: string, newCount: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const hasBettors = showBettors && scorer.bettors.length > 0

  const rankColors = [
    'text-yellow-500',
    'text-gray-400',
    'text-amber-600',
  ]
  const rankCls = rankColors[rank - 1] ?? 'text-gray-300'

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start gap-4 p-4">
        {/* Posição */}
        <div className={`w-7 shrink-0 pt-1 text-center text-sm font-black ${rankCls}`}>
          {rank}
        </div>

        {/* Avatar */}
        <PlayerAvatar name={scorer.player_name} />

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-bold text-gray-900">{scorer.player_name}</span>
            {scorer.team && (
              <span className="text-sm text-gray-400">{scorer.team}</span>
            )}
          </div>

          {/* Voter list — visible by default on desktop, accordion on mobile */}
          {hasBettors && (
            <>
              {/* Desktop: always visible */}
              <div className="mt-2 hidden sm:block">
                <BettorList bettors={scorer.bettors} showPositions={showPositions} />
              </div>

              {/* Mobile: accordion */}
              <div className="mt-2 sm:hidden">
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-azul-mid"
                >
                  <span>{expanded ? '▲' : '▼'}</span>
                  <span>
                    {scorer.bettors.length} apostador{scorer.bettors.length !== 1 ? 'es' : ''}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2">
                    <BettorList bettors={scorer.bettors} showPositions={showPositions} />
                  </div>
                )}
              </div>
            </>
          )}

          {showBettors && scorer.bettors.length === 0 && (
            <p className="mt-1 text-xs text-gray-300">Nenhum apostou neste jogador</p>
          )}
        </div>

        {/* Goals control */}
        <div className="shrink-0">
          <GoalsControl id={scorer.id} count={scorer.goals_count} onUpdate={onUpdate} />
        </div>
      </div>
    </div>
  )
}

function AddScorerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (s: TopScorerItem) => void
  onCancel: () => void
}) {
  const [playerName, setPlayerName] = useState('')
  const [team, setTeam] = useState('')
  const [goals, setGoals] = useState(0)
  const [error, setError] = useState('')
  const [, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = () => {
    if (!playerName.trim()) { setError('Nome do jogador é obrigatório'); return }
    setError('')
    startTransition(async () => {
      const r = await insertTopScorer(playerName, team, goals)
      if (r.error) { setError(r.error); return }
      onAdd({
        id: r.id!,
        player_name: playerName.trim(),
        team: team.trim(),
        goals_count: goals,
        bettors: [],
      })
    })
  }

  return (
    <div className="rounded-xl border border-azul-mid bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-bold text-gray-700">Inserir artilheiro</h3>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">Nome do Jogador *</label>
          <input
            ref={ref}
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            placeholder="Ex: Kylian Mbappé"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-azul-mid focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="sm:w-36">
          <label className="mb-1 block text-xs font-medium text-gray-500">Seleção</label>
          <input
            type="text"
            value={team}
            onChange={e => setTeam(e.target.value)}
            placeholder="Ex: França"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-azul-mid focus:outline-none"
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="sm:w-24">
          <label className="mb-1 block text-xs font-medium text-gray-500">Gols</label>
          <input
            type="number"
            min={0}
            value={goals}
            onChange={e => setGoals(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-azul-mid focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            className="rounded-lg bg-azul-mid px-4 py-2 text-sm font-semibold text-white transition hover:bg-azul-escuro"
          >
            Adicionar
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  )
}

export function ArtilhariaClient({ initialScorers, showBettors, showPositions }: Props) {
  const [scorers, setScorers] = useState<TopScorerItem[]>(initialScorers)
  const [showAddForm, setShowAddForm] = useState(false)

  const updateScorer = (id: string, newCount: number) => {
    setScorers(prev =>
      [...prev.map(s => s.id === id ? { ...s, goals_count: newCount } : s)]
        .sort((a, b) => b.goals_count - a.goals_count || a.player_name.localeCompare(b.player_name, 'pt-BR'))
    )
  }

  const addScorer = (s: TopScorerItem) => {
    setScorers(prev =>
      [...prev, s].sort((a, b) => b.goals_count - a.goals_count || a.player_name.localeCompare(b.player_name, 'pt-BR'))
    )
    setShowAddForm(false)
  }

  // Supabase Realtime — sincroniza gols entre todos os usuários conectados
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('artilharia-top-scorers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'top_scorers' },
        payload => {
          if (payload.eventType === 'UPDATE') {
            const row = payload.new as { id: string; goals_count: number; player_name: string; team: string }
            setScorers(prev =>
              [...prev.map(s => s.id === row.id
                ? { ...s, goals_count: row.goals_count, player_name: row.player_name, team: row.team }
                : s
              )].sort((a, b) => b.goals_count - a.goals_count || a.player_name.localeCompare(b.player_name, 'pt-BR'))
            )
          } else if (payload.eventType === 'INSERT') {
            const row = payload.new as { id: string; goals_count: number; player_name: string; team: string }
            setScorers(prev => {
              if (prev.find(s => s.id === row.id)) return prev
              return [...prev, { ...row, bettors: [] }]
                .sort((a, b) => b.goals_count - a.goals_count || a.player_name.localeCompare(b.player_name, 'pt-BR'))
            })
          }
        }
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Artilharia</h1>
          <p className="mt-1 text-sm text-gray-500">
            Artilheiros da Copa — atualizado em tempo real pela torcida
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="shrink-0 rounded-lg bg-azul-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-azul-mid"
          >
            + Inserir artilheiro
          </button>
        )}
      </div>

      {/* Formulário de inserção */}
      {showAddForm && (
        <div className="mb-4">
          <AddScorerForm onAdd={addScorer} onCancel={() => setShowAddForm(false)} />
        </div>
      )}

      {/* Anti-spoiler notice */}
      {!showBettors && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          🔒 As apostas de artilheiro ainda estão em sigilo. A lista de quem apostou em cada jogador será revelada após o encerramento dos prazos.
        </div>
      )}

      {/* Lista de artilheiros */}
      {scorers.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
          Nenhum artilheiro cadastrado ainda. Clique em &quot;Inserir artilheiro&quot; para começar.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {scorers.map((scorer, i) => (
            <ScorerCard
              key={scorer.id}
              scorer={scorer}
              rank={i + 1}
              showBettors={showBettors}
              showPositions={showPositions}
              onUpdate={updateScorer}
            />
          ))}
        </div>
      )}

      {scorers.length > 0 && (
        <p className="mt-4 text-right text-xs text-gray-400">
          {scorers.length} jogador{scorers.length !== 1 ? 'es' : ''} · atualizações em tempo real
        </p>
      )}
    </div>
  )
}
