'use client'

import {
  useState, useEffect, useRef, useCallback, useTransition, memo, useMemo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createClient } from '@/lib/supabase/client'
import { saveOfficialScore } from '@/app/acopa/actions'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { KnockoutTeamOverride } from '@/lib/bracket/engine'
import { useAdminView } from '@/contexts/AdminViewContext'
import { Flag } from '@/components/ui/Flag'
import type { RuleMap } from '@/lib/scoring/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'

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

export interface GroupBetRaw {
  participant_id: string
  group_name: string
  first_place: string
  second_place: string
  points: number | null
}

export interface ThirdBetRaw {
  participant_id: string
  group_name: string
  team: string
}

interface Props {
  initialMatches: MatchFull[]
  participants: Participant[]
  initialBets: BetRaw[]
  initialGroupBets: GroupBetRaw[]
  initialThirdBets: ThirdBetRaw[]
  participantTotals: Record<string, number>
  rules: RuleMap
  isAdmin: boolean
  activeParticipantId: string
  teamAbbrs: Record<string, string>
}

// ── Constants ──────────────────────────────────────────────────────────────────

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const PHASE_FILTERS = [
  { value: 'group', label: 'Grupos',  phases: ['group'] },
  { value: 'r32',   label: '16avos',  phases: ['round_of_32'] },
  { value: 'r16',   label: 'Oitavas', phases: ['round_of_16'] },
  { value: 'qf',    label: 'Quartas', phases: ['quarterfinal'] },
  { value: 'sf',    label: 'Semis',   phases: ['semifinal'] },
  { value: 'final', label: 'Final',   phases: ['third_place', 'final'] },
] as const

const ROW_H      = 44
const ROW_H_BONUS = 38
const ROW_H_SEC   = 26

// Frozen column pixel offsets (desktop)
const COL_DATE_DESKTOP  = 48
const COL_TEAMS_DESKTOP = 148
const COL_TEAMS_MOBILE  = 60
const COL_SCORE_W       = 96
const PART_COL_W        = 64

// ── Row types ──────────────────────────────────────────────────────────────────

type TableRow =
  | { kind: 'match';     match: MatchFull }
  | { kind: 'section';   label: string; color: string }
  | { kind: 'group_bet'; groupName: string }
  | { kind: 'third_bet'; groupName: string }

// ── Cell classification ────────────────────────────────────────────────────────

type CellKind = 'exact' | 'winner' | 'wrong' | 'pending' | 'no_bet'

const CELL_BG: Record<CellKind, string> = {
  exact:   'bg-emerald-100',
  winner:  'bg-sky-100',
  wrong:   'bg-rose-50',
  pending: 'bg-white',
  no_bet:  '',
}

// Hex equivalents used for sticky (frozen) cells that need an opaque inline background
const CELL_KIND_BG_HEX: Record<CellKind, string> = {
  exact:   '#d1fae5',
  winner:  '#e0f2fe',
  wrong:   '#fff1f2',
  pending: '#ffffff',
  no_bet:  '',      // caller must supply fallback row colour
}

function matchCellKind(
  bet: { score_home: number; score_away: number } | undefined,
  sh: number | null, sa: number | null,
): CellKind {
  if (!bet) return 'no_bet'
  if (sh === null || sa === null) return 'pending'
  if (bet.score_home === sh && bet.score_away === sa) return 'exact'
  if (getMatchResult(bet.score_home, bet.score_away) === getMatchResult(sh, sa)) return 'winner'
  return 'wrong'
}

function groupCellKind(
  bet: { first_place: string; second_place: string } | undefined,
  off1: string, off2: string,
): CellKind {
  if (!bet || !bet.first_place || !bet.second_place) return 'no_bet'
  if (!off1) return 'pending'
  if (bet.first_place === off1 && bet.second_place === off2) return 'exact'
  const betSet = new Set([bet.first_place, bet.second_place])
  if (betSet.has(off1) || betSet.has(off2)) return 'winner'
  return 'wrong'
}

function thirdCellKind(
  team: string | undefined, offTeam: string,
): CellKind {
  if (!team) return 'no_bet'
  if (!offTeam) return 'pending'
  return team === offTeam ? 'exact' : 'wrong'
}

// ── Abbreviate team name ───────────────────────────────────────────────────────

const abbr = (name: string, max = 7) =>
  name.length <= max ? name : name.slice(0, max - 1) + '…'

// ── Format match datetime (Brasília UTC-3) ─────────────────────────────────────

function fmtMatchDate(dt: string) {
  const d = new Date(dt)
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return { date, time }
}


// ── ScoreInput ─────────────────────────────────────────────────────────────────

const ScoreInput = memo(function ScoreInput({
  match, canEdit, onSaved,
}: {
  match: MatchFull
  canEdit: boolean
  onSaved: (sh: number, sa: number) => void
}) {
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
    ) : <span className="text-gray-300 text-xs">–</span>
  }

  return (
    <div className="flex items-center justify-center gap-0.5">
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={home}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0,2); setHome(v); homeRef.current = v; triggerSave(v, awayRef.current) }}
        placeholder="–"
        className="w-7 rounded border border-gray-200 bg-white text-center text-xs font-bold py-0.5 focus:border-verde-400 focus:outline-none"
      />
      <span className="text-gray-300 text-[9px]">×</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={away}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0,2); setAway(v); awayRef.current = v; triggerSave(homeRef.current, v) }}
        placeholder="–"
        className="w-7 rounded border border-gray-200 bg-white text-center text-xs font-bold py-0.5 focus:border-verde-400 focus:outline-none"
      />
      {pending && <span className="text-[9px] text-gray-400 ml-0.5">…</span>}
    </div>
  )
})

// ── Bet map helpers ────────────────────────────────────────────────────────────

type BetEntry = { score_home: number; score_away: number; storedPoints: number | null; livePoints?: number }
type BetMap = Map<string, BetEntry>

function buildBetMap(bets: BetRaw[]): BetMap {
  const m = new Map<string, BetEntry>()
  for (const b of bets) {
    m.set(`${b.participant_id}:${b.match_id}`, {
      score_home: b.score_home, score_away: b.score_away, storedPoints: b.points,
    })
  }
  return m
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TabelaMBClient({
  initialMatches, participants, initialBets, initialGroupBets, initialThirdBets,
  participantTotals, rules, isAdmin, activeParticipantId, teamAbbrs,
}: Props) {
  const [matches, setMatches] = useState<MatchFull[]>(initialMatches)
  const [betMap,  setBetMap]  = useState<BetMap>(() => buildBetMap(initialBets))
  const [phase,   setPhase]   = useState('group')
  const [now,     setNow]     = useState(Date.now())
  const [isMobile, setIsMobile] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Group / third bet maps (static — refreshed on page load)
  const groupBetMap = useMemo(() => {
    const m = new Map<string, { first_place: string; second_place: string; points: number | null }>()
    for (const b of initialGroupBets) {
      m.set(`${b.participant_id}:${b.group_name}`, { first_place: b.first_place, second_place: b.second_place, points: b.points })
    }
    return m
  }, [initialGroupBets])

  const thirdBetMap = useMemo(() => {
    const m = new Map<string, { team: string }>()
    for (const b of initialThirdBets) {
      m.set(`${b.participant_id}:${b.group_name}`, { team: b.team, points: b.points })
    }
    return m
  }, [initialThirdBets])

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Mobile breakpoint (< 640px)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Supabase Realtime
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel('tabela_mb_rt')
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
          next.set(key, { ...bet, livePoints: scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, isBrazil, rules) })
        }
      }
      return next
    })
  }, [participants, rules])

  // Official group standings (computed from match scores via bracket engine)
  const officialStandings = useMemo(() => {
    const gms = matches.filter(m => m.phase === 'group')
    const scoreMap = new Map<string, BetSlim>()
    for (const m of gms) {
      if (m.score_home !== null && m.score_away !== null) {
        scoreMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
      }
    }
    const slim: MatchSlim[] = gms.map(m => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away,
      flag_home: m.flag_home, flag_away: m.flag_away,
    }))
    return calcGroupStandings(slim, scoreMap)
  }, [matches])

  const officialThirds = useMemo(() => rankThirds(officialStandings), [officialStandings])

  const knockoutTeamMap = useMemo(() => {
    const thirdSlots = resolveThirdSlots(officialThirds)
    if (!thirdSlots) return new Map<string, KnockoutTeamOverride>()
    const r32Slots = buildR32Teams(officialStandings, officialThirds, thirdSlots)
    const knockoutMatches = matches.filter(m => m.phase !== 'group')
    return buildKnockoutTeamMap(r32Slots, knockoutMatches)
  }, [officialStandings, officialThirds, matches])

  const offFirst  = useCallback((g: string) => officialStandings.find(s => s.group === g)?.teams[0]?.team ?? '', [officialStandings])
  const offSecond = useCallback((g: string) => officialStandings.find(s => s.group === g)?.teams[1]?.team ?? '', [officialStandings])
  const offThird  = useCallback((g: string) => officialThirds.find(t => t.group === g && t.advances)?.team ?? '', [officialThirds])

  const teamFlagMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const match of matches) {
      if (match.flag_home) m.set(match.team_home, match.flag_home)
      if (match.flag_away) m.set(match.team_away, match.flag_away)
    }
    return m
  }, [matches])

  const { viewMode } = useAdminView()
  const effectiveIsAdmin = isAdmin && viewMode === 'admin'

  const canEdit = useCallback((match: MatchFull) => {
    if (effectiveIsAdmin) return true
    const start = new Date(match.match_datetime).getTime()
    return now >= start && now <= start + EDIT_WINDOW_MS
  }, [effectiveIsAdmin, now])

  const phaseConfig = PHASE_FILTERS.find(f => f.value === phase) ?? PHASE_FILTERS[0]
  const filteredMatches = useMemo(
    () => matches.filter(m => (phaseConfig.phases as readonly string[]).includes(m.phase)),
    [matches, phaseConfig],
  )

  // Build unified row list
  const allRows = useMemo((): TableRow[] => {
    const rows: TableRow[] = filteredMatches.map(m => ({ kind: 'match', match: m }))
    if (phase === 'group') {
      rows.push({ kind: 'section', label: '1º e 2º Classificados por Grupo', color: '#1e3a5f' })
      GROUP_ORDER.forEach(g => rows.push({ kind: 'group_bet', groupName: g }))
      rows.push({ kind: 'section', label: 'Melhores Terceiros Classificados', color: '#3b0764' })
      GROUP_ORDER.forEach(g => rows.push({ kind: 'third_bet', groupName: g }))
    }
    return rows
  }, [phase, filteredMatches])

  // Virtualizer with variable row heights
  const rowVirtualizer = useVirtualizer({
    count: allRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: i => {
      const r = allRows[i]
      if (r.kind === 'section') return ROW_H_SEC
      if (r.kind === 'group_bet' || r.kind === 'third_bet') return ROW_H_BONUS
      return ROW_H
    },
    overscan: 8,
  })

  const colDateW     = isMobile ? 0 : COL_DATE_DESKTOP
  const colTeamsW    = isMobile ? COL_TEAMS_MOBILE : COL_TEAMS_DESKTOP
  const colTeamsLeft = colDateW
  const colScoreLeft = colTeamsLeft + colTeamsW
  const frozenTotal  = colScoreLeft + COL_SCORE_W

  // On desktop, the active participant's column is frozen right after Oficial
  const activePart   = participants.find(p => p.id === activeParticipantId)
  const otherParts   = participants.filter(p => p.id !== activeParticipantId)
  const orderedParts = activePart ? [activePart, ...otherParts] : participants
  const frozenPartLeft = !isMobile && activePart ? frozenTotal : null

  // Compute totals client-side so match livePoints + group + third bets are all included.
  // Third-place points are computed live (DB only stores them after all 72 group matches finish).
  const computedTotals = useMemo(() => {
    const thirdPts = rules['terceiro_classificado'] ?? 3
    const totals: Record<string, number> = {}
    for (const p of participants) {
      let sum = 0
      for (const m of matches) {
        const e = betMap.get(`${p.id}:${m.id}`)
        if (e) {
          const pts = e.livePoints !== undefined ? e.livePoints : e.storedPoints
          if (pts) sum += pts
        }
      }
      GROUP_ORDER.forEach(g => {
        const gb = groupBetMap.get(`${p.id}:${g}`)
        if (gb?.points) sum += gb.points
        const tb = thirdBetMap.get(`${p.id}:${g}`)
        if (tb?.team) {
          const actualThird = officialThirds.find(t => t.group === g && t.advances)?.team ?? ''
          if (actualThird && tb.team === actualThird) sum += thirdPts
        }
      })
      totals[p.id] = sum
    }
    return totals
  }, [participants, matches, betMap, groupBetMap, thirdBetMap, officialThirds, rules])

  const vItems    = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const padTop    = vItems.length > 0 ? vItems[0].start : 0
  const padBot    = vItems.length > 0 ? totalSize - vItems[vItems.length - 1].end : 0
  const tableW    = frozenTotal + participants.length * PART_COL_W

  const getMatchPts = (pid: string, mid: string) => {
    const e = betMap.get(`${pid}:${mid}`)
    if (!e) return null
    return e.livePoints !== undefined ? e.livePoints : e.storedPoints
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2 shrink-0">
        <span className="text-[11px] font-semibold text-gray-400">Fase:</span>
        {PHASE_FILTERS.map(f => (
          <button key={f.value} onClick={() => setPhase(f.value)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
              phase === f.value ? 'bg-verde-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >{f.label}</button>
        ))}
        <span className="ml-auto text-[10px] text-gray-400">
          {filteredMatches.length} jogos · {participants.length} part.
        </span>
      </div>

      {/* Matrix */}
      <div ref={containerRef} className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: 'touch' as const }}>
        <table className="border-collapse" style={{ width: tableW, tableLayout: 'fixed', fontSize: 11 }}>
          <colgroup>
            <col style={{ width: colDateW }} />
            <col style={{ width: colTeamsW }} />
            <col style={{ width: COL_SCORE_W }} />
            {orderedParts.map(p => <col key={p.id} style={{ width: PART_COL_W }} />)}
          </colgroup>

          {/* Header */}
          <thead>
            <tr style={{ height: 48, background: '#1f2937' }}>
              <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-gray-300 font-semibold text-[10px]">Data</th>
              <th style={{ position: 'sticky', top: 0, left: colTeamsLeft, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-left px-1.5 text-gray-300 font-semibold">Jogo</th>
              <th style={{ position: 'sticky', top: 0, left: colScoreLeft, zIndex: 50, background: '#1f2937', borderRight: '2px solid #6b7280' }}
                className="text-center text-gray-200 font-semibold">Oficial</th>
              {orderedParts.map((p, idx) => {
                const isMe = p.id === activeParticipantId
                const isFrozen = frozenPartLeft !== null && idx === 0
                const total = computedTotals[p.id] ?? 0
                return (
                  <th key={p.id} title={p.apelido}
                    style={{
                      position: 'sticky', top: 0,
                      ...(isFrozen ? { left: frozenPartLeft, borderLeft: '2px solid #6b7280' } : {}),
                      zIndex: isFrozen ? 50 : 40,
                      background: isMe ? '#14532d' : '#1f2937',
                      borderRight: '1px solid #374151',
                    }}
                    className={`text-center px-0.5 ${isMe ? 'text-verde-200' : 'text-gray-300'}`}
                  >
                    <span className="block truncate font-semibold" style={{ maxWidth: PART_COL_W - 4 }}>{p.apelido}</span>
                    <span className={`block text-[11px] font-semibold ${isMe ? 'text-verde-300' : 'text-gray-500'}`}>
                      {total > 0 ? total : '–'}
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
              const row = allRows[vRow.index]
              const odd = vRow.index % 2 === 1
              const bg  = odd ? '#f9fafb' : '#ffffff'

              // ── Section header ──────────────────────────────────────────────
              if (row.kind === 'section') {
                const sectionBg = row.color === '#1e3a5f' ? '#dbeafe' : '#ede9fe'
                const textCls   = row.color === '#1e3a5f' ? 'text-blue-700'  : 'text-violet-700'
                const borderClr = row.color === '#1e3a5f' ? '#93c5fd'        : '#c4b5fd'
                return (
                  <tr key={`sec-${row.label}`} style={{ height: ROW_H_SEC }}>
                    <td colSpan={3 + participants.length}
                      style={{ position: 'sticky', left: 0, zIndex: 30, background: sectionBg, borderTop: `2px solid ${borderClr}`, borderBottom: `1px solid ${borderClr}` }}
                      className={`px-3 text-[10px] font-bold uppercase tracking-widest ${textCls}`}
                    >{row.label}</td>
                  </tr>
                )
              }

              // ── Group bet row ───────────────────────────────────────────────
              if (row.kind === 'group_bet') {
                const g    = row.groupName
                const of1  = offFirst(g)
                const of2  = offSecond(g)
                return (
                  <tr key={`gb-${g}`} style={{ height: ROW_H_BONUS, background: '#eff6ff' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                      className="text-center font-bold text-blue-700 text-xs">{g}</td>
                    <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                      className="px-1.5 text-[10px] font-semibold text-blue-600">
                      {isMobile ? (
                        <div className="leading-none flex flex-col gap-0.5">
                          {of1 ? (
                            <div className="flex items-center gap-1">
                              <Flag code={teamFlagMap.get(of1) ?? ''} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                              <span className="font-bold text-[10px]">{teamAbbrs[of1] ?? abbr(of1, 4)}</span>
                            </div>
                          ) : <span className="text-gray-300">–</span>}
                          {of2 ? (
                            <div className="flex items-center gap-1">
                              <Flag code={teamFlagMap.get(of2) ?? ''} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                              <span className="font-bold text-[10px]">{teamAbbrs[of2] ?? abbr(of2, 4)}</span>
                            </div>
                          ) : <span className="text-gray-300">–</span>}
                        </div>
                      ) : (
                        <div className="leading-none">
                          <span className="block truncate" style={{ maxWidth: colTeamsW - 8 }}>🥇 {of1 || '–'}</span>
                          <span className="block truncate" style={{ maxWidth: colTeamsW - 8 }}>🥈 {of2 || '–'}</span>
                        </div>
                      )}
                    </td>
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#eff6ff', borderRight: '2px solid #93c5fd' }}
                      className="text-center text-[10px] font-semibold text-blue-800">
                      {of1 ? `Gr. ${g}` : <span className="text-gray-300">–</span>}
                    </td>
                    {orderedParts.map((p, idx) => {
                      const bet  = groupBetMap.get(`${p.id}:${g}`)
                      const kind = groupCellKind(bet, of1, of2)
                      const isMe = p.id === activeParticipantId
                      const isFrozen = frozenPartLeft !== null && idx === 0
                      const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || '#eff6ff') : undefined
                      return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: frozenBg, borderLeft: '2px solid #bfdbfe' } : undefined}
                          className={`border-r border-blue-50 text-center ${!isFrozen ? CELL_BG[kind] : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          {bet?.first_place ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className="text-[9px] text-gray-600 truncate font-medium" style={{ maxWidth: PART_COL_W - 4 }}>
                                {(teamAbbrs[bet.first_place] ?? abbr(bet.first_place, 5))}/{(teamAbbrs[bet.second_place] ?? abbr(bet.second_place, 5))}
                              </span>
                              {bet.points !== null && (
                                <span className={`text-[10px] font-bold ${bet.points > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {bet.points > 0 ? `+${bet.points}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              }

              // ── Third bet row ───────────────────────────────────────────────
              if (row.kind === 'third_bet') {
                const g  = row.groupName
                const ot = offThird(g)
                return (
                  <tr key={`tb-${g}`} style={{ height: ROW_H_BONUS, background: '#faf5ff' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#faf5ff', borderRight: '1px solid #e9d5ff' }}
                      className="text-center text-[9px] font-bold text-violet-600">3º<br/><span className="text-violet-400">{g}</span></td>
                    <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#faf5ff', borderRight: '1px solid #e9d5ff' }}
                      className="px-1.5 text-[10px] font-semibold text-violet-700">
                      {isMobile ? (
                        ot ? (
                          <div className="flex items-center gap-1">
                            <Flag code={teamFlagMap.get(ot) ?? ''} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                            <span className="font-bold text-[10px]">{teamAbbrs[ot] ?? abbr(ot, 4)}</span>
                          </div>
                        ) : <span className="text-gray-300">–</span>
                      ) : (
                        <span className="block truncate" style={{ maxWidth: colTeamsW - 8 }}>
                          {ot || <span className="text-gray-300">–</span>}
                        </span>
                      )}
                    </td>
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#faf5ff', borderRight: '2px solid #c4b5fd' }}
                      className="text-center text-[10px] text-violet-600 font-semibold">
                      {ot ? `Gr. ${g}` : <span className="text-gray-300">–</span>}
                    </td>
                    {orderedParts.map((p, idx) => {
                      const bet  = thirdBetMap.get(`${p.id}:${g}`)
                      const kind = thirdCellKind(bet?.team, ot)
                      const isMe = p.id === activeParticipantId
                      const isFrozen = frozenPartLeft !== null && idx === 0
                      const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || '#faf5ff') : undefined
                      return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: frozenBg, borderLeft: '2px solid #e9d5ff' } : undefined}
                          className={`border-r border-violet-50 text-center ${!isFrozen ? CELL_BG[kind] : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          {bet?.team ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className="text-[9px] text-gray-600 truncate font-medium" style={{ maxWidth: PART_COL_W - 4 }}>
                                {teamAbbrs[bet.team] ?? abbr(bet.team)}
                              </span>
                              {kind !== 'pending' && kind !== 'no_bet' && (
                                <span className={`text-[10px] font-bold ${kind === 'exact' ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {kind === 'exact' ? `+${rules['terceiro_classificado'] ?? 3}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                )
              }

              // ── Match row ───────────────────────────────────────────────────
              const match = row.match
              const ktOverride = knockoutTeamMap.get(match.id)
              const teamHome = ktOverride?.team_home ?? match.team_home
              const teamAway = ktOverride?.team_away ?? match.team_away
              const flagHome = ktOverride?.flag_home ?? match.flag_home
              const flagAway = ktOverride?.flag_away ?? match.flag_away
              const abbrHome = teamAbbrs[teamHome] ?? teamHome.slice(0, 3).toUpperCase()
              const abbrAway = teamAbbrs[teamAway] ?? teamAway.slice(0, 3).toUpperCase()
              const { date: mDate, time: mTime } = fmtMatchDate(match.match_datetime)
              return (
                <tr key={match.id} style={{ height: ROW_H }}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 30, background: bg, borderRight: '1px solid #f3f4f6', overflow: 'hidden' }}
                    className="text-center text-gray-500">
                    {!isMobile && (
                      <div className="flex flex-col items-center leading-none gap-0.5">
                        <span className="text-[9px] text-gray-600">{mDate}</span>
                        <span className="text-[9px] font-semibold text-gray-800">{mTime}</span>
                      </div>
                    )}
                  </td>
                  <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: bg, borderRight: '1px solid #f3f4f6' }}
                    className="px-1">
                    {isMobile ? (
                      <div className="flex flex-col leading-none gap-0.5">
                        <div className="flex items-center gap-1">
                          <Flag code={flagHome} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                          <span className="font-bold text-[10px] text-gray-800 tracking-tight">{abbrHome}</span>
                          {match.is_brazil && <span className="shrink-0 text-[7px] font-black text-verde-700 bg-verde-100 rounded-sm px-0.5">×2</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Flag code={flagAway} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                          <span className="font-bold text-[10px] text-gray-800 tracking-tight">{abbrAway}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col leading-none gap-px">
                        <div className="flex items-center gap-0.5">
                          <span className="truncate font-semibold text-gray-800" style={{ maxWidth: colTeamsW - 16 }}>{teamHome}</span>
                          {match.is_brazil && <span className="shrink-0 text-[7px] font-black text-verde-700 bg-verde-100 rounded-sm px-0.5">×2</span>}
                        </div>
                        <span className="text-[8px] text-gray-300">vs</span>
                        <span className="truncate font-semibold text-gray-800" style={{ maxWidth: colTeamsW - 8 }}>{teamAway}</span>
                      </div>
                    )}
                  </td>
                  <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: bg, borderRight: '2px solid #d1d5db' }}
                    className="text-center">
                    <ScoreInput match={match} canEdit={canEdit(match)}
                      onSaved={(sh, sa) => {
                        setMatches(prev => prev.map(m => m.id === match.id ? { ...m, score_home: sh, score_away: sa } : m))
                        recomputeForMatch(match.id, sh, sa, match.is_brazil)
                      }}
                    />
                  </td>
                  {orderedParts.map((p, idx) => {
                    const key  = `${p.id}:${match.id}`
                    const bet  = betMap.get(key)
                    const kind = matchCellKind(bet, match.score_home, match.score_away)
                    const pts  = getMatchPts(p.id, match.id)
                    const isMe = p.id === activeParticipantId
                    const isFrozen = frozenPartLeft !== null && idx === 0
                    const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || bg) : undefined
                    return (
                      <td key={p.id}
                        style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: frozenBg, borderLeft: '2px solid #d1d5db' } : undefined}
                        className={`border-r border-gray-100 text-center ${!isFrozen ? CELL_BG[kind] : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                        {bet ? (
                          <div className="flex flex-col items-center leading-none gap-px">
                            <span className="tabular-nums font-semibold text-gray-700">{bet.score_home}–{bet.score_away}</span>
                            {pts !== null && (
                              <span className={`tabular-nums font-bold ${pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                {pts > 0 ? `+${pts}` : '0'}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-gray-200">—</span>}
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
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" />Cravada</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-sky-100" />Vencedor/Parcial</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-50 border border-rose-200" />Errou</span>
      </div>
    </div>
  )
}
