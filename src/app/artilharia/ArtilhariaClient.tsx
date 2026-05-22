'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateGoalsCount, insertTopScorer, setArtillaryPointsActive, deleteTopScorer } from './actions'

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
  isAdmin: boolean
  artillaryPointsActive: boolean
  artilheiroPoints: number
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
  ptsBadge,
}: {
  bettors: Bettor[]
  showPositions: boolean
  ptsBadge: number | null
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
          {ptsBadge !== null && (
            <span className="rounded bg-green-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white">
              +{ptsBadge} PTS
            </span>
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
  isAdmin,
  artillaryPointsActive,
  artilheiroPoints,
  onUpdate,
  onDelete,
}: {
  scorer: TopScorerItem
  rank: number
  showBettors: boolean
  showPositions: boolean
  isAdmin: boolean
  artillaryPointsActive: boolean
  artilheiroPoints: number
  onUpdate: (id: string, newCount: number) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, startDeleteTransition] = useTransition()
  const hasBettors = showBettors && scorer.bettors.length > 0
  const ptsBadge = artillaryPointsActive ? artilheiroPoints : null

  const handleDelete = () => {
    startDeleteTransition(async () => {
      const r = await deleteTopScorer(scorer.id)
      if (!r.error) onDelete(scorer.id)
    })
  }

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
                <BettorList bettors={scorer.bettors} showPositions={showPositions} ptsBadge={ptsBadge} />
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
                    <BettorList bettors={scorer.bettors} showPositions={showPositions} ptsBadge={ptsBadge} />
                  </div>
                )}
              </div>
            </>
          )}

          {showBettors && scorer.bettors.length === 0 && (
            <p className="mt-1 text-xs text-gray-300">Nenhum apostou neste jogador</p>
          )}
        </div>

        {/* Goals control + delete */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <GoalsControl id={scorer.id} count={scorer.goals_count} onUpdate={onUpdate} />
          {isAdmin && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] font-medium text-gray-300 transition hover:text-red-400"
              title="Excluir artilheiro"
            >
              excluir
            </button>
          )}
          {isAdmin && confirmDelete && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500">Excluir?</span>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? '…' : 'Sim'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 transition hover:bg-gray-50"
              >
                Não
              </button>
            </div>
          )}
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
  const [goals, setGoals] = useState(0)
  const [error, setError] = useState('')
  const [, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const submit = () => {
    if (!playerName.trim()) { setError('Nome do jogador é obrigatório'); return }
    setError('')
    startTransition(async () => {
      const r = await insertTopScorer(playerName, '', goals)
      if (r.error) { setError(r.error); return }
      onAdd({
        id: r.id!,
        player_name: playerName.trim(),
        team: '',
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

export function ArtilhariaClient({
  initialScorers, showBettors, showPositions,
  isAdmin, artillaryPointsActive: initActive, artilheiroPoints,
}: Props) {
  const [scorers, setScorers] = useState<TopScorerItem[]>(initialScorers)
  const [showAddForm, setShowAddForm] = useState(false)
  const [artillaryActive, setArtillaryActive] = useState(initActive)
  const [togglePending, startToggleTransition] = useTransition()
  const [toggleError, setToggleError] = useState('')

  const handleToggleArtillary = () => {
    const next = !artillaryActive
    setToggleError('')
    startToggleTransition(async () => {
      setArtillaryActive(next)
      const r = await setArtillaryPointsActive(next)
      if (r.error) {
        setToggleError(r.error)
        setArtillaryActive(!next)
      }
    })
  }

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

  const removeScorer = (id: string) => {
    setScorers(prev => prev.filter(s => s.id !== id))
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

      {/* Controle de pontos de artilharia */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">Contar pontos de artilharia no ranking geral?</p>
            {isAdmin ? (
              <p className="mt-0.5 text-xs text-gray-500">
                {artillaryActive
                  ? 'Ativado — pontos de artilheiro estão sendo somados no ranking.'
                  : 'Desativado — pontos de artilheiro não entram no total do ranking.'}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-gray-500">Configurado pelo administrador do bolão.</p>
            )}
            {toggleError && <p className="mt-1 text-xs text-red-500">{toggleError}</p>}
          </div>
          {isAdmin ? (
            <button
              onClick={handleToggleArtillary}
              disabled={togglePending}
              title={artillaryActive ? 'Clique para desativar' : 'Clique para ativar'}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${
                artillaryActive ? 'bg-verde-600' : 'bg-gray-300'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${artillaryActive ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          ) : (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              artillaryActive
                ? 'bg-green-100 text-green-800'
                : 'bg-amber-100 text-amber-800'
            }`}>
              {artillaryActive ? 'Pontos Computados' : 'Aguardando Validação'}
            </span>
          )}
        </div>
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
              isAdmin={isAdmin}
              artillaryPointsActive={artillaryActive}
              artilheiroPoints={artilheiroPoints}
              onUpdate={updateScorer}
              onDelete={removeScorer}
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
