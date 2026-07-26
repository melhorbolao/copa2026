'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { updatePanela } from './actions'
import { getMatchResult } from '@/lib/scoring/engine'
import { Flag } from '@/components/ui/Flag'

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface Participant {
  id:      string
  apelido: string
}

interface RankedParticipant extends Participant {
  ptsTotal: number
  rank:     number
}

interface MatchInfo {
  id:            string
  teamHome:      string
  teamAway:      string
  flagHome:      string
  flagAway:      string
  matchDatetime: string
  scoreHome?:    number | null
  scoreAway?:    number | null
}

interface BetInfo {
  scoreHome: number
  scoreAway: number
  points:    number | null
}

interface Props {
  allParticipants:    Participant[]
  currentParticipantId: string
  initialPanelaIds:   string[]
  allRanked:          RankedParticipant[]
  snapshotByPid:      Record<string, { rank: number; pts_total: number }>
  recentMatches:      (MatchInfo & { scoreHome: number; scoreAway: number })[]
  upcomingMatches:    MatchInfo[]
  betsByParticipant:  Record<string, Record<string, BetInfo>>
}

const MAX_PANELA = 20

// ── Formatadores ──────────────────────────────────────────────────────────────

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Seletor de panela ─────────────────────────────────────────────────────────

function PanelaSelector({
  selectable, panelaIds, participantById, currentParticipantId,
  onAdd, onRemove, saving, max,
}: {
  selectable:           Participant[]
  panelaIds:            string[]
  participantById:      Record<string, string>
  currentParticipantId: string
  onAdd:    (id: string) => void
  onRemove: (id: string) => void
  saving:   boolean
  max:      number
}) {
  const [query,  setQuery]  = useState('')
  const [open,   setOpen]   = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return selectable.filter(p => p.apelido.toLowerCase().includes(q)).slice(0, 12)
  }, [selectable, query])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const atMax = panelaIds.length >= max

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          Sua panela
        </span>
        <span className={`text-xs font-semibold ${atMax ? 'text-amber-600' : 'text-gray-400'}`}>
          {panelaIds.length}/{max} amigos
          {saving && <span className="ml-2 text-gray-400">• salvando…</span>}
        </span>
      </div>

      {/* Chips dos membros selecionados */}
      <div className="flex flex-wrap gap-2 mb-3">
        {/* Chip do próprio usuário (fixo, não removível) */}
        <span className="inline-flex items-center gap-1 rounded-full bg-[#002776] px-3 py-1 text-xs font-bold text-white">
          {participantById[currentParticipantId] ?? 'Eu'}
          <span className="ml-1 opacity-60 text-[10px]">você</span>
        </span>

        {panelaIds.map(id => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800"
          >
            {participantById[id] ?? id}
            <button
              onClick={() => onRemove(id)}
              className="ml-1 text-blue-500 hover:text-blue-800 leading-none"
              aria-label={`Remover ${participantById[id]}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Input de busca */}
      {!atMax && (
        <div ref={containerRef} className="relative">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar participante para adicionar…"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#002776] focus:ring-1 focus:ring-[#002776]"
          />
          {open && filtered.length > 0 && (
            <ul className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
              {filtered.map(p => (
                <li key={p.id}>
                  <button
                    className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 font-medium text-gray-700"
                    onMouseDown={e => {
                      e.preventDefault()
                      onAdd(p.id)
                      setQuery('')
                      setOpen(false)
                    }}
                  >
                    {p.apelido}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && query.length > 0 && filtered.length === 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400 shadow-lg">
              Nenhum participante encontrado
            </div>
          )}
        </div>
      )}
      {atMax && (
        <p className="text-xs text-amber-600 font-semibold">
          Limite de {max} amigos atingido. Remova alguém para adicionar outro.
        </p>
      )}
    </div>
  )
}

// ── Seta de tendência ─────────────────────────────────────────────────────────

function TrendArrow({ delta }: { delta?: { deltaRank: number; deltaPts: number } }) {
  if (!delta) return <span className="text-[10px] text-gray-300">—</span>
  const { deltaRank } = delta
  if (deltaRank === 0) return <span className="font-mono text-[10px] text-gray-400">▬</span>
  if (deltaRank > 0) {
    return (
      <span className="inline-flex items-center gap-0 text-[11px] font-bold text-emerald-600">
        ▲<span className="tabular-nums">{deltaRank}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0 text-[11px] font-bold text-red-500">
      ▼<span className="tabular-nums">{Math.abs(deltaRank)}</span>
    </span>
  )
}

// ── Sub-aba 1: Classificação da panela ────────────────────────────────────────

function ClassificacaoPanela({
  panelaRanked, trendByPid, currentParticipantId, hasTrend,
}: {
  panelaRanked:         RankedParticipant[]
  trendByPid:           Record<string, { deltaRank: number; deltaPts: number }>
  currentParticipantId: string
  hasTrend:             boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
          <tr>
            <th className="px-3 py-2 text-center w-10">#Geral</th>
            <th className="px-3 py-2 text-left">Participante</th>
            <th className="px-3 py-2 text-right w-14">Pts</th>
            {hasTrend && <th className="px-3 py-2 text-center w-16">Tendência</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {panelaRanked.map((r, i) => {
            const isMe = r.id === currentParticipantId
            return (
              <tr
                key={r.id}
                className={`${i % 2 === 1 ? 'bg-gray-50/50' : ''} ${isMe ? 'bg-blue-50/60' : ''}`}
              >
                <td className="px-3 py-2.5 text-center">
                  <span className="inline-block min-w-[28px] rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-bold text-gray-600">
                    {r.rank}º
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`font-semibold ${isMe ? 'text-[#002776]' : 'text-gray-800'}`}>
                    {r.apelido}
                  </span>
                  {isMe && (
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-wide text-[#002776] opacity-60">
                      você
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-black text-gray-900 tabular-nums">
                  {r.ptsTotal}
                </td>
                {hasTrend && (
                  <td className="px-3 py-2.5 text-center">
                    <TrendArrow delta={trendByPid[r.id]} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {hasTrend && (
        <p className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100">
          Tendência em relação ao último snapshot diário
        </p>
      )}
    </div>
  )
}

// ── Aba 2: Realizados / Aba 3: Próximos ──────────────────────────────────────

function PalpiteCell({ bet }: { bet?: BetInfo }) {
  if (!bet) return <span className="text-gray-300 text-xs">—</span>
  return (
    <span className="font-bold text-xs tabular-nums whitespace-nowrap text-gray-700">
      {bet.scoreHome} × {bet.scoreAway}
    </span>
  )
}

function RecentMatchCard({
  match, panelaRanked, betsByParticipant,
}: {
  match:              MatchInfo & { scoreHome: number; scoreAway: number }
  panelaRanked:       RankedParticipant[]
  betsByParticipant:  Record<string, Record<string, BetInfo>>
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Placar oficial */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500">{fmtDatetime(match.matchDatetime)}</span>
        <span className="font-black text-sm text-gray-900 tracking-tight">
          <Flag code={match.flagHome} size="sm" /> {match.teamHome} {match.scoreHome} × {match.scoreAway} {match.teamAway} <Flag code={match.flagAway} size="sm" />
        </span>
      </div>

      {/* Grid de palpites com scroll horizontal no mobile */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[300px]">
          <thead className="bg-gray-50/60 text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-3 py-1.5 text-left z-10 min-w-[90px]">
                Participante
              </th>
              <th className="px-3 py-1.5 text-center">Palpite</th>
              <th className="px-3 py-1.5 text-center">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {panelaRanked.map((r, i) => {
              const bet = betsByParticipant[r.id]?.[match.id]
              const isExact = bet &&
                bet.scoreHome === match.scoreHome &&
                bet.scoreAway === match.scoreAway
              return (
                <tr key={r.id} className={i % 2 === 1 ? 'bg-gray-50/40' : ''}>
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-gray-700 z-10 whitespace-nowrap">
                    {r.apelido}
                  </td>
                  <td className={`px-3 py-2 text-center ${isExact ? 'font-black text-[#002776]' : ''}`}>
                    {bet
                      ? <>{bet.scoreHome} × {bet.scoreAway}{isExact && ' ✓'}</>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className={`px-3 py-2 text-center font-bold tabular-nums ${isExact ? 'text-[#002776]' : 'text-gray-600'}`}>
                    {bet
                      ? (bet.points != null ? bet.points : <span className="text-gray-400 text-xs">–</span>)
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function UpcomingMatchCard({
  match, panelaRanked, betsByParticipant,
}: {
  match:             MatchInfo
  panelaRanked:      RankedParticipant[]
  betsByParticipant: Record<string, Record<string, BetInfo>>
}) {
  // Detectar divergência: se nenhum resultado tem > 60% dos votos
  const counts = { H: 0, D: 0, A: 0 }
  let total = 0
  for (const r of panelaRanked) {
    const bet = betsByParticipant[r.id]?.[match.id]
    if (bet) {
      const res = getMatchResult(bet.scoreHome, bet.scoreAway)
      counts[res]++
      total++
    }
  }
  const isDivergent = total >= 2 && Math.max(counts.H, counts.D, counts.A) / total < 0.6

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Cabeçalho do jogo */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-500">{fmtDatetime(match.matchDatetime)}</span>
        <span className="font-black text-sm text-gray-900 tracking-tight">
          <Flag code={match.flagHome} size="sm" /> {match.teamHome} × {match.teamAway} <Flag code={match.flagAway} size="sm" />
        </span>
        {isDivergent && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 whitespace-nowrap">
            ⚔️ Campo de Batalha!
          </span>
        )}
      </div>

      {/* Grid de palpites com scroll horizontal no mobile */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[260px]">
          <thead className="bg-gray-50/60 text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="sticky left-0 bg-gray-50 px-3 py-1.5 text-left z-10 min-w-[90px]">
                Participante
              </th>
              <th className="px-3 py-1.5 text-center">Palpite</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {panelaRanked.map((r, i) => {
              const bet = betsByParticipant[r.id]?.[match.id]
              return (
                <tr key={r.id} className={i % 2 === 1 ? 'bg-gray-50/40' : ''}>
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-gray-700 z-10 whitespace-nowrap">
                    {r.apelido}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PalpiteCell bet={bet} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RealizadosTab({
  panelaRanked, recentMatches, betsByParticipant,
}: {
  panelaRanked:      RankedParticipant[]
  recentMatches:     (MatchInfo & { scoreHome: number; scoreAway: number })[]
  betsByParticipant: Record<string, Record<string, BetInfo>>
}) {
  if (recentMatches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center">
        <p className="text-3xl mb-2">⏳</p>
        <p className="font-bold text-gray-700">Nenhum jogo realizado ainda</p>
        <p className="mt-1 text-sm text-gray-400">
          As pontuações aparecem aqui após os jogos serem registrados.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {[...recentMatches].reverse().map(m => (
        <RecentMatchCard
          key={m.id}
          match={m}
          panelaRanked={panelaRanked}
          betsByParticipant={betsByParticipant}
        />
      ))}
    </div>
  )
}

function ProximosTab({
  panelaRanked, upcomingMatches, betsByParticipant,
}: {
  panelaRanked:      RankedParticipant[]
  upcomingMatches:   MatchInfo[]
  betsByParticipant: Record<string, Record<string, BetInfo>>
}) {
  if (upcomingMatches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center">
        <p className="text-3xl mb-2">🔒</p>
        <p className="font-bold text-gray-700">Nenhum palpite revelado ainda</p>
        <p className="mt-1 text-sm text-gray-400">
          Os palpites dos próximos jogos aparecem aqui após o prazo encerrar.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {upcomingMatches.map(m => (
        <UpcomingMatchCard
          key={m.id}
          match={m}
          panelaRanked={panelaRanked}
          betsByParticipant={betsByParticipant}
        />
      ))}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function PanelaClient({
  allParticipants, currentParticipantId, initialPanelaIds,
  allRanked, snapshotByPid, recentMatches, upcomingMatches, betsByParticipant,
}: Props) {
  const [panelaIds,  setPanelaIds]  = useState<string[]>(initialPanelaIds)
  const [activeTab,  setActiveTab]  = useState<'ranking' | 'realizados' | 'proximos'>('ranking')
  const [saving,     setSaving]     = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = useCallback((ids: string[]) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true)
      try { await updatePanela(currentParticipantId, ids) }
      finally { setSaving(false) }
    }, 800)
  }, [currentParticipantId])

  const addMember = useCallback((id: string) => {
    setPanelaIds(prev => {
      if (prev.includes(id) || id === currentParticipantId || prev.length >= MAX_PANELA) return prev
      const next = [...prev, id]
      scheduleSave(next)
      return next
    })
  }, [currentParticipantId, scheduleSave])

  const removeMember = useCallback((id: string) => {
    setPanelaIds(prev => {
      const next = prev.filter(i => i !== id)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const panelaSet = useMemo(() => new Set([currentParticipantId, ...panelaIds]), [currentParticipantId, panelaIds])

  const panelaRanked = useMemo(
    () => allRanked.filter(r => panelaSet.has(r.id)),
    [allRanked, panelaSet],
  )

  const trendByPid = useMemo(() => {
    const map: Record<string, { deltaRank: number; deltaPts: number }> = {}
    for (const r of allRanked) {
      const snap = snapshotByPid[r.id]
      if (snap) {
        map[r.id] = {
          deltaRank: snap.rank - r.rank,
          deltaPts:  r.ptsTotal - snap.pts_total,
        }
      }
    }
    return map
  }, [allRanked, snapshotByPid])

  const hasTrend = Object.keys(snapshotByPid).length > 0

  const participantById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of allParticipants) m[p.id] = p.apelido
    return m
  }, [allParticipants])

  const selectableParticipants = useMemo(() => (
    allParticipants.filter(p => p.id !== currentParticipantId && !panelaIds.includes(p.id))
  ), [allParticipants, currentParticipantId, panelaIds])

  const isEmpty = panelaRanked.length <= 1

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32">
      {/* Título */}
      <div className="mb-5">
        <h1 className="text-2xl font-black text-gray-900">🍳 Minha Panela</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Seu minigrupo privado — só você sabe quem está aqui.
        </p>
      </div>

      {/* Seletor */}
      <PanelaSelector
        selectable={selectableParticipants}
        panelaIds={panelaIds}
        participantById={participantById}
        currentParticipantId={currentParticipantId}
        onAdd={addMember}
        onRemove={removeMember}
        saving={saving}
        max={MAX_PANELA}
      />

      {/* Estado vazio */}
      {isEmpty ? (
        <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-white py-12 text-center">
          <p className="text-4xl mb-2">👥</p>
          <p className="font-bold text-gray-700">Sua panela está vazia</p>
          <p className="mt-1 text-sm text-gray-400">
            Adicione amigos no campo acima para acompanhar a disputa.
          </p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b border-gray-200 mt-6 mb-4">
            {(
              [
                ['ranking',    '🏆 Classificação'],
                ['realizados', '✅ Realizados'],
                ['proximos',   '⏳ Próximos'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-[#002776] text-[#002776]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'ranking' && (
            <ClassificacaoPanela
              panelaRanked={panelaRanked}
              trendByPid={trendByPid}
              currentParticipantId={currentParticipantId}
              hasTrend={hasTrend}
            />
          )}
          {activeTab === 'realizados' && (
            <RealizadosTab
              panelaRanked={panelaRanked}
              recentMatches={recentMatches}
              betsByParticipant={betsByParticipant}
            />
          )}
          {activeTab === 'proximos' && (
            <ProximosTab
              panelaRanked={panelaRanked}
              upcomingMatches={upcomingMatches}
              betsByParticipant={betsByParticipant}
            />
          )}
        </>
      )}
    </div>
  )
}
