'use client'

import {
  useState, useEffect, useRef, useCallback, useTransition, memo, useMemo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createClient } from '@/lib/supabase/client'
import { saveOfficialScore } from '@/app/acopa/actions'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import type { RuleMap } from '@/lib/scoring/engine'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MatchFull {
  id: string
  match_number: number
  phase: string
  group_name: string | null
  round: number | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  match_datetime: string
  city: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
  is_brazil: boolean
  betting_deadline: string
}

export interface Participant { id: string; apelido: string }

export interface BetRaw {
  participant_id: string
  match_id: string
  score_home: number
  score_away: number
  points: number | null
}

interface Props {
  initialMatches: MatchFull[]
  participants: Participant[]
  initialBets: BetRaw[]
  rules: RuleMap
  isAdmin: boolean
  activeParticipantId: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

const PHASE_FILTERS = [
  { value: 'group', label: 'Grupos',  phases: ['group'] },
  { value: 'r32',   label: '16avos',  phases: ['round_of_32'] },
  { value: 'r16',   label: 'Oitavas', phases: ['round_of_16'] },
  { value: 'qf',    label: 'Quartas', phases: ['quarterfinal'] },
  { value: 'sf',    label: 'Semis',   phases: ['semifinal'] },
  { value: 'final', label: 'Final',   phases: ['third_place', 'final'] },
] as const

const ROW_H = 44

// Frozen column pixel offsets
const COL_NUM_W      = 36
const COL_TEAMS_LEFT = COL_NUM_W                      // 36
const COL_TEAMS_W    = 148
const COL_SCORE_LEFT = COL_TEAMS_LEFT + COL_TEAMS_W   // 184
const COL_SCORE_W    = 96
const FROZEN_TOTAL   = COL_SCORE_LEFT + COL_SCORE_W   // 280

const PART_COL_W = 64

// ── Cell classification ────────────────────────────────────────────────────────

type CellKind = 'exact' | 'winner' | 'wrong' | 'pending' | 'no_bet'

function cellKind(
  bet: { score_home: number; score_away: number } | undefined,
  sh: number | null,
  sa: number | null,
): CellKind {
  if (!bet) return 'no_bet'
  if (sh === null || sa === null) return 'pending'
  if (bet.score_home === sh && bet.score_away === sa) return 'exact'
  if (getMatchResult(bet.score_home, bet.score_away) === getMatchResult(sh, sa)) return 'winner'
  return 'wrong'
}

const CELL_BG: Record<CellKind, string> = {
  exact:   'bg-emerald-100',
  winner:  'bg-sky-100',
  wrong:   'bg-rose-50',
  pending: 'bg-white',
  no_bet:  '',
}

// ── ScoreInput ─────────────────────────────────────────────────────────────────

interface ScoreInputProps {
  match: MatchFull
  canEdit: boolean
  onSaved: (sh: number, sa: number) => void
}

const ScoreInput = memo(function ScoreInput({ match, canEdit, onSaved }: ScoreInputProps) {
  const [home, setHome] = useState(match.score_home?.toString() ?? '')
  const [away, setAway] = useState(match.score_away?.toString() ?? '')
  const [pending, startTransition] = useTransition()
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const homeRef  = useRef(home)
  const awayRef  = useRef(away)

  useEffect(() => {
    const h = match.score_home?.toString() ?? ''
    const a = match.score_away?.toString() ?? ''
    setHome(h); homeRef.current = h
    setAway(a); awayRef.current = a
  }, [match.score_home, match.score_away])

  const triggerSave = useCallback((h: string, a: string) => {
    clearTimeout(timerRef.current)
    const hNum = parseInt(h, 10)
    const aNum = parseInt(a, 10)
    if (isNaN(hNum) || isNaN(aNum) || hNum < 0 || aNum < 0) return
    timerRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await saveOfficialScore(match.id, hNum, aNum)
        if (!res.error) onSaved(hNum, aNum)
      })
    }, 800)
  }, [match.id, onSaved])

  const hasScore = match.score_home !== null && match.score_away !== null

  if (!canEdit) {
    return hasScore ? (
      <span className="font-bold tabular-nums text-xs text-gray-700">
        {match.score_home}–{match.score_away}
      </span>
    ) : (
      <span className="text-gray-300 text-xs">–</span>
    )
  }

  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={home}
        onChange={e => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 2)
          setHome(v); homeRef.current = v
          triggerSave(v, awayRef.current)
        }}
        placeholder="–"
        className="w-7 rounded border border-gray-200 bg-white text-center text-xs font-bold py-0.5 focus:border-verde-400 focus:outline-none"
      />
      <span className="text-gray-300 text-[9px]">×</span>
      <input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={away}
        onChange={e => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 2)
          setAway(v); awayRef.current = v
          triggerSave(homeRef.current, v)
        }}
        placeholder="–"
        className="w-7 rounded border border-gray-200 bg-white text-center text-xs font-bold py-0.5 focus:border-verde-400 focus:outline-none"
      />
      {pending && <span className="text-[9px] text-gray-400 ml-0.5 shrink-0">…</span>}
    </div>
  )
})

// ── Bet state ──────────────────────────────────────────────────────────────────

type BetEntry = {
  score_home: number
  score_away: number
  storedPoints: number | null
  livePoints?: number
}
type BetMap = Map<string, BetEntry>

function buildBetMap(bets: BetRaw[]): BetMap {
  const m = new Map<string, BetEntry>()
  for (const b of bets) {
    m.set(`${b.participant_id}:${b.match_id}`, {
      score_home: b.score_home,
      score_away: b.score_away,
      storedPoints: b.points,
    })
  }
  return m
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TabelaMBClient({
  initialMatches,
  participants,
  initialBets,
  rules,
  isAdmin,
  activeParticipantId,
}: Props) {
  const [matches, setMatches] = useState<MatchFull[]>(initialMatches)
  const [betMap,  setBetMap]  = useState<BetMap>(() => buildBetMap(initialBets))
  const [phase,   setPhase]   = useState('group')
  const [now,     setNow]     = useState(Date.now())

  const containerRef = useRef<HTMLDivElement>(null)

  // Clock — refresh canEdit every 30 s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Supabase Realtime — matches table
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel('tabela_mb_rt')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload: any) => {
        const upd = payload.new as Partial<MatchFull> & { id: string }
        setMatches(prev => prev.map(m => m.id === upd.id ? { ...m, ...upd } : m))
        if (upd.score_home != null && upd.score_away != null && upd.is_brazil != null) {
          recomputeForMatch(upd.id, upd.score_home, upd.score_away, upd.is_brazil)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute points for all bets on a match when its score changes
  const recomputeForMatch = useCallback((matchId: string, sh: number, sa: number, isBrazil: boolean) => {
    setBetMap(prev => {
      const allBets: Array<{ score_home: number; score_away: number }> = []
      for (const [key, bet] of prev) {
        if (key.endsWith(`:${matchId}`)) allBets.push(bet)
      }
      const isZebra = detectMatchZebra(allBets, getMatchResult(sh, sa), rules['percentual_zebra'] ?? 15)
      const next = new Map(prev)
      for (const p of participants) {
        const key = `${p.id}:${matchId}`
        const bet = prev.get(key)
        if (bet) {
          next.set(key, {
            ...bet,
            livePoints: scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, isBrazil, rules),
          })
        }
      }
      return next
    })
  }, [participants, rules])

  // canEdit per match
  const canEdit = useCallback((match: MatchFull): boolean => {
    if (isAdmin) return true
    const start = new Date(match.match_datetime).getTime()
    return now >= start && now <= start + EDIT_WINDOW_MS
  }, [isAdmin, now])

  // Filtered matches by phase
  const phaseConfig = PHASE_FILTERS.find(f => f.value === phase) ?? PHASE_FILTERS[0]
  const filteredMatches = useMemo(
    () => matches.filter(m => (phaseConfig.phases as readonly string[]).includes(m.phase)),
    [matches, phaseConfig],
  )

  // Row virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredMatches.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  })
  const vItems    = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const padTop    = vItems.length > 0 ? vItems[0].start : 0
  const padBot    = vItems.length > 0 ? totalSize - vItems[vItems.length - 1].end : 0

  const tableW = FROZEN_TOTAL + participants.length * PART_COL_W

  const getPoints = (pid: string, mid: string): number | null => {
    const e = betMap.get(`${pid}:${mid}`)
    if (!e) return null
    return e.livePoints !== undefined ? e.livePoints : e.storedPoints
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>

      {/* Phase filter bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2 shrink-0">
        <span className="text-[11px] font-semibold text-gray-400">Fase:</span>
        {PHASE_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setPhase(f.value)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
              phase === f.value
                ? 'bg-verde-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-gray-400">
          {filteredMatches.length} jogos · {participants.length} part.
        </span>
      </div>

      {/* Scrollable matrix */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ WebkitOverflowScrolling: 'touch' as const }}
      >
        <table
          className="border-collapse"
          style={{ width: tableW, tableLayout: 'fixed', fontSize: 11 }}
        >
          <colgroup>
            <col style={{ width: COL_NUM_W }} />
            <col style={{ width: COL_TEAMS_W }} />
            <col style={{ width: COL_SCORE_W }} />
            {participants.map(p => <col key={p.id} style={{ width: PART_COL_W }} />)}
          </colgroup>

          {/* Header */}
          <thead>
            <tr style={{ height: ROW_H, background: '#1f2937' }}>
              <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-gray-300 font-semibold">#</th>
              <th style={{ position: 'sticky', top: 0, left: COL_TEAMS_LEFT, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-left px-1.5 text-gray-300 font-semibold">Jogo</th>
              <th style={{ position: 'sticky', top: 0, left: COL_SCORE_LEFT, zIndex: 50, background: '#1f2937', borderRight: '2px solid #6b7280' }}
                className="text-center text-gray-200 font-semibold">Oficial</th>
              {participants.map(p => {
                const isMe = p.id === activeParticipantId
                return (
                  <th
                    key={p.id}
                    title={p.apelido}
                    style={{ position: 'sticky', top: 0, zIndex: 40, background: isMe ? '#14532d' : '#1f2937', borderRight: '1px solid #374151' }}
                    className={`text-center font-semibold px-0.5 ${isMe ? 'text-verde-200' : 'text-gray-300'}`}
                  >
                    <span className="block truncate" style={{ maxWidth: PART_COL_W - 4 }}>
                      {p.apelido}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={3 + participants.length} /></tr>}

            {vItems.map(vRow => {
              const match = filteredMatches[vRow.index]
              const odd   = vRow.index % 2 === 1
              const bg    = odd ? '#f9fafb' : '#ffffff'

              return (
                <tr key={match.id} style={{ height: ROW_H }}>
                  {/* # */}
                  <td
                    style={{ position: 'sticky', left: 0, zIndex: 30, background: bg, borderRight: '1px solid #f3f4f6' }}
                    className="text-center text-gray-500"
                  >
                    <div className="flex flex-col items-center leading-none gap-0.5">
                      <span className="font-mono text-[10px]">{match.match_number}</span>
                      {match.is_brazil && (
                        <span className="text-[7px] font-black text-verde-700 bg-verde-100 rounded-sm px-0.5 leading-tight">×2</span>
                      )}
                    </div>
                  </td>

                  {/* Teams */}
                  <td
                    style={{ position: 'sticky', left: COL_TEAMS_LEFT, zIndex: 30, background: bg, borderRight: '1px solid #f3f4f6' }}
                    className="px-1.5"
                  >
                    <div className="flex flex-col leading-none gap-px">
                      <span className="truncate font-semibold text-gray-800" style={{ maxWidth: COL_TEAMS_W - 8 }}>
                        {match.team_home}
                      </span>
                      <span className="text-[8px] text-gray-300">vs</span>
                      <span className="truncate font-semibold text-gray-800" style={{ maxWidth: COL_TEAMS_W - 8 }}>
                        {match.team_away}
                      </span>
                    </div>
                  </td>

                  {/* Official score */}
                  <td
                    style={{ position: 'sticky', left: COL_SCORE_LEFT, zIndex: 30, background: bg, borderRight: '2px solid #d1d5db' }}
                    className="text-center"
                  >
                    <ScoreInput
                      match={match}
                      canEdit={canEdit(match)}
                      onSaved={(sh, sa) => {
                        setMatches(prev => prev.map(m => m.id === match.id ? { ...m, score_home: sh, score_away: sa } : m))
                        recomputeForMatch(match.id, sh, sa, match.is_brazil)
                      }}
                    />
                  </td>

                  {/* Bet cells */}
                  {participants.map(p => {
                    const key  = `${p.id}:${match.id}`
                    const bet  = betMap.get(key)
                    const kind = cellKind(bet, match.score_home, match.score_away)
                    const pts  = getPoints(p.id, match.id)
                    const isMe = p.id === activeParticipantId

                    return (
                      <td
                        key={p.id}
                        className={`text-center border-r border-gray-100 ${CELL_BG[kind]} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}
                      >
                        {bet ? (
                          <div className="flex flex-col items-center leading-none gap-px">
                            <span className="tabular-nums font-semibold text-gray-700">
                              {bet.score_home}–{bet.score_away}
                            </span>
                            {pts !== null && (
                              <span className={`tabular-nums font-bold ${pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                {pts > 0 ? `+${pts}` : '0'}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}

            {padBot > 0 && <tr style={{ height: padBot }}><td colSpan={3 + participants.length} /></tr>}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 border-t border-gray-100 bg-white px-3 py-1.5 text-[10px] text-gray-400 shrink-0">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" /> Cravada</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-sky-100" /> Vencedor</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-50 border border-rose-200" /> Errou</span>
      </div>
    </div>
  )
}
