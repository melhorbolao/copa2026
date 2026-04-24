'use client'

import {
  useState, useEffect, useRef, useCallback, useTransition, memo, useMemo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createClient } from '@/lib/supabase/client'
import { saveOfficialScore, saveOfficialTopScorer } from '@/app/acopa/actions'
import { scoreMatchBet, detectMatchZebra, getMatchResult, scoreTournamentBet } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { KnockoutTeamOverride } from '@/lib/bracket/engine'
import { useAdminView } from '@/contexts/AdminViewContext'
import { Flag } from '@/components/ui/Flag'
import type { RuleMap, TournamentResults } from '@/lib/scoring/engine'
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

export interface TournamentBetRaw {
  participant_id: string
  champion: string
  runner_up: string
  semi1: string
  semi2: string
  top_scorer: string
  points: number | null
}

interface Props {
  initialMatches: MatchFull[]
  participants: Participant[]
  initialBets: BetRaw[]
  initialGroupBets: GroupBetRaw[]
  initialThirdBets: ThirdBetRaw[]
  initialTournamentBets: TournamentBetRaw[]
  participantTotals: Record<string, number>
  rules: RuleMap
  isAdmin: boolean
  activeParticipantId: string
  teamAbbrs: Record<string, string>
  officialTopScorers: string[]
  scorerMapping: Record<string, string>
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

const ROW_H       = 44
const ROW_H_BONUS = 38
const ROW_H_G4    = 56
const ROW_H_SEC   = 26

// Frozen column pixel offsets (desktop)
const COL_DATE_DESKTOP  = 48
const COL_TEAMS_DESKTOP = 148
const COL_TEAMS_MOBILE  = 60
const COL_SCORE_W       = 96
const PART_COL_W        = 64
const STAT_COL_W        = 52  // 4 colunas de estatísticas × 52px = 208px

// ── Row types ──────────────────────────────────────────────────────────────────

type TableRow =
  | { kind: 'match';      match: MatchFull }
  | { kind: 'section';    label: string; color: string }
  | { kind: 'group_bet';  groupName: string }
  | { kind: 'third_bet';  groupName: string }
  | { kind: 'g4_row' }
  | { kind: 'scorer_row' }

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

// ── Per-event aggregate stats ──────────────────────────────────────────────────

interface EventStats { pontuaram: number; cravaram: number; media: number }

function matchEventStats(matchId: string, sh: number | null, sa: number | null, parts: Participant[], betMap: BetMap): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = betMap.get(`${p.id}:${matchId}`)
    if (!bet) continue
    const kind = matchCellKind(bet, sh, sa)
    const pts  = bet.livePoints !== undefined ? bet.livePoints : (bet.storedPoints ?? 0)
    if ((pts ?? 0) > 0) pontuaram++
    if (kind === 'exact') cravaram++
    total += pts ?? 0
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

function groupEventStats(g: string, of1: string, of2: string, parts: Participant[], groupBetMap: Map<string, { first_place: string; second_place: string; points: number | null }>): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = groupBetMap.get(`${p.id}:${g}`)
    const kind = groupCellKind(bet, of1, of2)
    const pts  = bet?.points ?? 0
    if ((pts ?? 0) > 0) pontuaram++
    if (kind === 'exact') cravaram++
    total += pts ?? 0
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

function thirdEventStats(g: string, ot: string, thirdPts: number, parts: Participant[], thirdBetMap: Map<string, { team: string }>): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet  = thirdBetMap.get(`${p.id}:${g}`)
    const kind = thirdCellKind(bet?.team, ot)
    const pts  = kind === 'exact' ? thirdPts : 0
    if (pts > 0) pontuaram++
    if (kind === 'exact') cravaram++
    total += pts
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

function g4EventStats(parts: Participant[], tournamentBetMap: Map<string, TournamentBetRaw>, knockoutResults: TournamentResults, rules: RuleMap, isZebraChampion: boolean, scorerMapping: Record<string, string>): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = tournamentBetMap.get(p.id)
    const pts = bet ? scoreTournamentBet({ ...bet, top_scorer: '' }, knockoutResults, rules, isZebraChampion, scorerMapping) : 0
    if (pts > 0) pontuaram++
    if (bet && knockoutResults.champion && bet.champion === knockoutResults.champion && knockoutResults.runnerUp && bet.runner_up === knockoutResults.runnerUp) cravaram++
    total += pts
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

function scorerEventStats(parts: Participant[], tournamentBetMap: Map<string, TournamentBetRaw>, localScorers: string[], artilhPts: number, scorerMapping: Record<string, string>): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = tournamentBetMap.get(p.id)
    if (!bet?.top_scorer) continue
    const norm      = (scorerMapping[bet.top_scorer] ?? bet.top_scorer).trim().toLowerCase()
    const isCorrect = localScorers.length > 0 && localScorers.some(s => s.trim().toLowerCase() === norm)
    const pts       = localScorers.length > 0 ? (isCorrect ? artilhPts : 0) : 0
    if (pts > 0) pontuaram++
    if (isCorrect) cravaram++
    total += pts
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

// ── Format match datetime (Brasília UTC-3) ─────────────────────────────────────

function fmtMatchDate(dt: string) {
  const d = new Date(dt)
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return { date, time }
}


// ── ScoreInput ─────────────────────────────────────────────────────────────────

const ScoreInput = memo(function ScoreInput({
  match, canEdit, possibleZebras, isActualZebra, onSaved,
}: {
  match: MatchFull
  canEdit: boolean
  possibleZebras?: { H: boolean; D: boolean; A: boolean }
  isActualZebra?: boolean
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
    if (!hasScore) {
      // Mostra indicadores de possível zebra mesmo em modo leitura
      const pz = possibleZebras
      if (!pz || (!pz.H && !pz.D && !pz.A)) return <span className="text-gray-300 text-xs">–</span>
      return (
        <div className="inline-flex items-center gap-0.5">
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] ${pz.H ? 'bg-gray-900' : 'bg-gray-100 border border-gray-200'}`} />
          <span className={`text-[9px] font-bold ${pz.D ? 'rounded bg-gray-900 text-white px-0.5' : 'text-gray-300'}`}>×</span>
          <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] ${pz.A ? 'bg-gray-900' : 'bg-gray-100 border border-gray-200'}`} />
        </div>
      )
    }
    const result = getMatchResult(match.score_home!, match.score_away!)
    return (
      <div className="inline-flex items-center gap-0.5">
        <span className={`inline-flex items-center justify-center min-w-[18px] rounded px-0.5 text-xs font-bold tabular-nums ${isActualZebra && result === 'H' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>
          {match.score_home}
        </span>
        <span className={`text-[9px] font-bold ${isActualZebra && result === 'D' ? 'rounded bg-gray-900 text-white px-0.5' : 'text-gray-300'}`}>×</span>
        <span className={`inline-flex items-center justify-center min-w-[18px] rounded px-0.5 text-xs font-bold tabular-nums ${isActualZebra && result === 'A' ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>
          {match.score_away}
        </span>
      </div>
    )
  }

  const currentH = parseInt(home, 10)
  const currentA = parseInt(away, 10)
  const currentResult = (!isNaN(currentH) && !isNaN(currentA)) ? getMatchResult(currentH, currentA) : null

  return (
    <div className="flex items-center justify-center gap-0.5">
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={home}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0,2); setHome(v); homeRef.current = v; triggerSave(v, awayRef.current) }}
        placeholder="–"
        className={`w-7 rounded border text-center text-xs font-bold py-0.5 focus:outline-none ${
          possibleZebras?.H || (isActualZebra && currentResult === 'H')
            ? 'border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:border-gray-600'
            : 'border-gray-200 bg-white focus:border-verde-400'
        }`}
      />
      <span className={`text-[9px] font-bold ${
        possibleZebras?.D || (isActualZebra && currentResult === 'D') ? 'rounded bg-gray-900 text-white px-0.5' : 'text-gray-300'
      }`}>×</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={away}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0,2); setAway(v); awayRef.current = v; triggerSave(homeRef.current, v) }}
        placeholder="–"
        className={`w-7 rounded border text-center text-xs font-bold py-0.5 focus:outline-none ${
          possibleZebras?.A || (isActualZebra && currentResult === 'A')
            ? 'border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:border-gray-600'
            : 'border-gray-200 bg-white focus:border-verde-400'
        }`}
      />
      {pending && <span className="text-[9px] text-gray-400 ml-0.5">…</span>}
    </div>
  )
})

// ── Zebra helpers ──────────────────────────────────────────────────────────────

function collectMatchBets(matchId: string, participants: Participant[], betMap: BetMap) {
  const bets: Array<{ score_home: number; score_away: number }> = []
  for (const p of participants) {
    const bet = betMap.get(`${p.id}:${matchId}`)
    if (bet) bets.push(bet)
  }
  return bets
}

function detectPossibleZebras(
  matchId: string, participants: Participant[], betMap: BetMap, threshold: number,
): { H: boolean; D: boolean; A: boolean } | undefined {
  const bets = collectMatchBets(matchId, participants, betMap)
  if (bets.length === 0) return undefined
  return {
    H: detectMatchZebra(bets, 'H', threshold),
    D: detectMatchZebra(bets, 'D', threshold),
    A: detectMatchZebra(bets, 'A', threshold),
  }
}

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
  initialTournamentBets, participantTotals, rules, isAdmin, activeParticipantId,
  teamAbbrs, officialTopScorers, scorerMapping,
}: Props) {
  const [matches, setMatches] = useState<MatchFull[]>(initialMatches)
  const [betMap,  setBetMap]  = useState<BetMap>(() => buildBetMap(initialBets))
  const [phase,   setPhase]   = useState('group')
  const [now,     setNow]     = useState(Date.now())
  const [isMobile, setIsMobile] = useState(false)

  // Admin: gestão de artilheiros oficiais
  const [localScorers, setLocalScorers] = useState<string[]>(officialTopScorers)
  const [scorerInput,    setScorerInput]    = useState('')
  const [scorerSelectVal, setScorerSelectVal] = useState('')
  const [scorerPending, startScorerTransition] = useTransition()
  const [scorerError,  setScorerError]  = useState('')

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
      m.set(`${b.participant_id}:${b.group_name}`, { team: b.team })
    }
    return m
  }, [initialThirdBets])

  const tournamentBetMap = useMemo(() => {
    const m = new Map<string, TournamentBetRaw>()
    for (const b of initialTournamentBets) m.set(b.participant_id, b)
    return m
  }, [initialTournamentBets])

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

  // Tournament results derived from actual match scores
  const knockoutResults = useMemo((): TournamentResults => {
    const resolved = (m: MatchFull, side: 'home' | 'away') => {
      const ov = knockoutTeamMap.get(m.id)
      return side === 'home' ? (ov?.team_home ?? m.team_home) : (ov?.team_away ?? m.team_away)
    }
    const mWinner = (m: MatchFull): string | null => {
      if (m.score_home === null || m.score_away === null) return null
      const h = resolved(m, 'home'), a = resolved(m, 'away')
      if (m.score_home > m.score_away) return h
      if (m.score_away > m.score_home) return a
      return m.penalty_winner ?? null
    }
    const qf = matches.filter(m => m.phase === 'quarterfinal').sort((a, b) => a.match_number - b.match_number)
    const sf = matches.filter(m => m.phase === 'semifinal').sort((a, b) => a.match_number - b.match_number)
    const fin  = matches.find(m => m.phase === 'final')
    const thr  = matches.find(m => m.phase === 'third_place')
    const semifinalists = qf.map(mWinner).filter((t): t is string => !!t)
    const finalists     = sf.map(mWinner).filter((t): t is string => !!t)
    let champion: string | null = null, runnerUp: string | null = null
    if (fin) {
      champion = mWinner(fin)
      if (champion) runnerUp = resolved(fin, champion === resolved(fin, 'home') ? 'away' : 'home')
    }
    let third: string | null = null, fourth: string | null = null
    if (thr) {
      third = mWinner(thr)
      if (third) fourth = resolved(thr, third === resolved(thr, 'home') ? 'away' : 'home')
    }
    return { semifinalists, finalists, champion, runnerUp, third, fourth, officialScorers: officialTopScorers }
  }, [matches, knockoutTeamMap, officialTopScorers])

  const isZebraChampion = useMemo(() => {
    if (!knockoutResults.champion || tournamentBetMap.size === 0) return false
    const threshold = rules['percentual_zebra'] ?? 15
    const correct = [...tournamentBetMap.values()].filter(b => b.champion === knockoutResults.champion).length
    return (correct / tournamentBetMap.size) * 100 <= threshold
  }, [knockoutResults.champion, tournamentBetMap, rules])

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
    if (phase === 'final') {
      rows.push({ kind: 'section', label: 'G4 — Semifinalistas e Campeão', color: '#78350f' })
      rows.push({ kind: 'g4_row' })
      rows.push({ kind: 'section', label: 'Artilheiro', color: '#78350f' })
      rows.push({ kind: 'scorer_row' })
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
      if (r.kind === 'g4_row') return ROW_H_G4
      if (r.kind === 'scorer_row') return ROW_H_BONUS
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
  const frozenPartLeft = !isMobile && activePart ? frozenTotal + 4 * STAT_COL_W : null

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
      const tb = tournamentBetMap.get(p.id)
      if (tb) sum += scoreTournamentBet(tb, knockoutResults, rules, isZebraChampion, scorerMapping)
      totals[p.id] = sum
    }
    return totals
  }, [participants, matches, betMap, groupBetMap, thirdBetMap, officialThirds, rules, tournamentBetMap, knockoutResults, isZebraChampion, scorerMapping])

  const leaderId = useMemo(() => {
    let best = -Infinity, bestId = ''
    for (const p of participants) {
      const pts = computedTotals[p.id] ?? 0
      if (pts > best) { best = pts; bestId = p.id }
    }
    return bestId
  }, [participants, computedTotals])

  // Unique scorer names bet by participants (standardized), for the admin dropdown
  const betScorerOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    for (const b of tournamentBetMap.values()) {
      if (!b.top_scorer) continue
      const display = (scorerMapping[b.top_scorer] ?? b.top_scorer).trim()
      if (display && !seen.has(display.toLowerCase())) {
        seen.add(display.toLowerCase())
        opts.push(display)
      }
    }
    return opts.sort()
  }, [tournamentBetMap, scorerMapping])

  // Funções de save do artilheiro (admin)
  const handleScorerSave = useCallback((names: string[]) => {
    setLocalScorers(names)
    setScorerError('')
    startScorerTransition(async () => {
      const r = await saveOfficialTopScorer(JSON.stringify(names))
      if (r.error) setScorerError(r.error)
    })
  }, [])

  const handleScorerAddDirect = useCallback((name: string) => {
    if (!name || localScorers.some(s => s.trim().toLowerCase() === name.trim().toLowerCase())) return
    handleScorerSave([...localScorers, name])
    setScorerSelectVal('')
  }, [localScorers, handleScorerSave])

  const handleScorerAdd = useCallback(() => {
    const t = scorerInput.trim()
    if (!t || localScorers.some(s => s.trim().toLowerCase() === t.toLowerCase())) return
    handleScorerSave([...localScorers, t])
    setScorerInput('')
    setScorerSelectVal('')
  }, [scorerInput, localScorers, handleScorerSave])

  const vItems    = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const padTop    = vItems.length > 0 ? vItems[0].start : 0
  const padBot    = vItems.length > 0 ? totalSize - vItems[vItems.length - 1].end : 0
  const tableW    = frozenTotal + 4 * STAT_COL_W + participants.length * PART_COL_W

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
        {/* Botão de exportação Excel — apenas desktop */}
        <button
          className="hidden sm:inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition"
          onClick={async () => {
            const ExcelJS = (await import('exceljs')).default
            const wb = new ExcelJS.Workbook()
            const ws = wb.addWorksheet('TabelaMB')
            const artPts = rules['artilheiro'] ?? 18
            const thPts  = rules['terceiro_classificado'] ?? 3

            // Participants in alphabetical order — same for everyone
            const sortedParts = [...participants]

            ws.addRow(['Data', 'Jogo', 'Oficial', 'Pont.', 'Crav.', 'Méd.', ...sortedParts.map(p => p.apelido)])

            // Build all-phase rows regardless of current UI filter
            const C = '' // section color placeholder
            const exportRows: TableRow[] = []
            const gMatches  = matches.filter(m => m.phase === 'group')
            const r32       = matches.filter(m => m.phase === 'round_of_32')
            const r16       = matches.filter(m => m.phase === 'round_of_16')
            const qf        = matches.filter(m => m.phase === 'quarterfinal')
            const sf        = matches.filter(m => m.phase === 'semifinal')
            const fin       = matches.filter(m => m.phase === 'third_place' || m.phase === 'final')

            if (gMatches.length) {
              exportRows.push({ kind: 'section', label: 'Fase de Grupos', color: C })
              gMatches.forEach(m => exportRows.push({ kind: 'match', match: m }))
              exportRows.push({ kind: 'section', label: '1º e 2º Classificados por Grupo', color: C })
              GROUP_ORDER.forEach(g => exportRows.push({ kind: 'group_bet', groupName: g }))
              exportRows.push({ kind: 'section', label: 'Melhores Terceiros Classificados', color: C })
              GROUP_ORDER.forEach(g => exportRows.push({ kind: 'third_bet', groupName: g }))
            }
            exportRows.push({ kind: 'section', label: 'G4 e Artilheiro', color: C })
            exportRows.push({ kind: 'g4_row' })
            exportRows.push({ kind: 'scorer_row' })
            if (r32.length) { exportRows.push({ kind: 'section', label: '16 avos de Final', color: C }); r32.forEach(m => exportRows.push({ kind: 'match', match: m })) }
            if (r16.length) { exportRows.push({ kind: 'section', label: 'Oitavas de Final',  color: C }); r16.forEach(m => exportRows.push({ kind: 'match', match: m })) }
            if (qf.length)  { exportRows.push({ kind: 'section', label: 'Quartas de Final',  color: C }); qf.forEach(m  => exportRows.push({ kind: 'match', match: m })) }
            if (sf.length)  { exportRows.push({ kind: 'section', label: 'Semifinais',         color: C }); sf.forEach(m  => exportRows.push({ kind: 'match', match: m })) }
            if (fin.length) { exportRows.push({ kind: 'section', label: 'Final e 3º Lugar',   color: C }); fin.forEach(m => exportRows.push({ kind: 'match', match: m })) }

            for (const row of exportRows) {
              if (row.kind === 'section') { ws.addRow([row.label]); continue }
              if (row.kind === 'match') {
                const m = row.match
                const th = knockoutTeamMap.get(m.id)
                const { date, time } = fmtMatchDate(m.match_datetime)
                const s = matchEventStats(m.id, m.score_home, m.score_away, participants, betMap)
                ws.addRow([`${date} ${time}`, `${th?.team_home ?? m.team_home} x ${th?.team_away ?? m.team_away}`,
                  m.score_home !== null ? `${m.score_home}–${m.score_away}` : '–',
                  s.pontuaram, s.cravaram, s.media > 0 ? +s.media.toFixed(1) : '–',
                  ...sortedParts.map(p => { const b = betMap.get(`${p.id}:${m.id}`); const pts = getMatchPts(p.id, m.id); return b ? `${b.score_home}–${b.score_away}${pts !== null ? ` (${pts})` : ''}` : '–' })])
                continue
              }
              if (row.kind === 'group_bet') {
                const g = row.groupName; const of1 = offFirst(g); const of2 = offSecond(g)
                const s = groupEventStats(g, of1, of2, participants, groupBetMap)
                ws.addRow([`Grupo ${g}`, '1º e 2º', of1 ? `${of1}/${of2}` : '–',
                  s.pontuaram, s.cravaram, s.media > 0 ? +s.media.toFixed(1) : '–',
                  ...sortedParts.map(p => { const b = groupBetMap.get(`${p.id}:${g}`); return b?.first_place ? `${b.first_place}/${b.second_place}${b.points !== null ? ` (${b.points})` : ''}` : '–' })])
                continue
              }
              if (row.kind === 'third_bet') {
                const g = row.groupName; const ot = offThird(g)
                const s = thirdEventStats(g, ot, thPts, participants, thirdBetMap)
                ws.addRow([`3º Gr.${g}`, 'Melhor 3º', ot || '–',
                  s.pontuaram, s.cravaram, s.media > 0 ? +s.media.toFixed(1) : '–',
                  ...sortedParts.map(p => { const b = thirdBetMap.get(`${p.id}:${g}`); return b?.team ?? '–' })])
                continue
              }
              if (row.kind === 'g4_row') {
                const s = g4EventStats(participants, tournamentBetMap, knockoutResults, rules, isZebraChampion, scorerMapping)
                ws.addRow(['G4', 'Semi+Campeão', knockoutResults.champion ?? '–',
                  s.pontuaram, s.cravaram, s.media > 0 ? +s.media.toFixed(1) : '–',
                  ...sortedParts.map(p => { const b = tournamentBetMap.get(p.id); const pts = b ? scoreTournamentBet({ ...b, top_scorer: '' }, knockoutResults, rules, isZebraChampion, scorerMapping) : 0; return b ? `${b.champion}/${b.runner_up}${pts > 0 ? ` (+${pts})` : ''}` : '–' })])
                continue
              }
              if (row.kind === 'scorer_row') {
                const s = scorerEventStats(participants, tournamentBetMap, localScorers, artPts, scorerMapping)
                ws.addRow(['Artilheiro', 'Top scorer', localScorers.join(', ') || '–',
                  s.pontuaram, s.cravaram, s.media > 0 ? +s.media.toFixed(1) : '–',
                  ...sortedParts.map(p => { const b = tournamentBetMap.get(p.id); const raw = b?.top_scorer ?? ''; return raw ? (scorerMapping[raw] ?? raw) : '–' })])
              }
            }

            const buf = await wb.xlsx.writeBuffer()
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            const brNow = new Date(Date.now() - 3 * 60 * 60 * 1000)
            const stamp = `${String(brNow.getUTCMonth()+1).padStart(2,'0')}${String(brNow.getUTCDate()).padStart(2,'0')}${String(brNow.getUTCHours()).padStart(2,'0')}${String(brNow.getUTCMinutes()).padStart(2,'0')}`
            a.href = url; a.download = `TabelaMB_${stamp}.xlsx`; a.click(); URL.revokeObjectURL(url)
          }}
        >⬇ Excel</button>
      </div>

      {/* Admin: gestão de artilheiro oficial — só na fase Final */}
      {effectiveIsAdmin && phase === 'final' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 shrink-0">
          <span className="text-[11px] font-bold text-amber-700">⚽ Artilheiro oficial:</span>
          {localScorers.map(n => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {n}
              <button onClick={() => handleScorerSave(localScorers.filter(x => x !== n))} className="text-amber-500 hover:text-red-500 leading-none">×</button>
            </span>
          ))}
          <select
            value={scorerSelectVal}
            onChange={e => {
              const v = e.target.value
              setScorerSelectVal(v)
              if (v && v !== 'outro') handleScorerAddDirect(v)
            }}
            className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] focus:outline-none focus:border-amber-400"
          >
            <option value="">Adicionar…</option>
            {betScorerOptions
              .filter(n => !localScorers.some(s => s.trim().toLowerCase() === n.trim().toLowerCase()))
              .map(n => <option key={n} value={n}>{n}</option>)
            }
            <option value="outro">Outro…</option>
          </select>
          {scorerSelectVal === 'outro' && (
            <>
              <input
                type="text" value={scorerInput} onChange={e => setScorerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScorerAdd()}
                placeholder="Nome do artilheiro"
                autoFocus
                className="rounded border border-amber-200 bg-white px-2 py-0.5 text-[11px] focus:outline-none focus:border-amber-400 w-36"
              />
              <button onClick={handleScorerAdd} disabled={!scorerInput.trim() || scorerPending}
                className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-600 disabled:opacity-40 transition">
                +
              </button>
            </>
          )}
          {scorerError && <span className="text-[10px] text-red-500">{scorerError}</span>}
          {scorerPending && <span className="text-[10px] text-gray-400">Salvando…</span>}
        </div>
      )}

      {/* Matrix */}
      <div ref={containerRef} className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: 'touch' as const }}>
        <table className="border-collapse" style={{ width: tableW, tableLayout: 'fixed', fontSize: 11 }}>
          <colgroup>
            <col style={{ width: colDateW }} />
            <col style={{ width: colTeamsW }} />
            <col style={{ width: COL_SCORE_W }} />
            <col style={{ width: STAT_COL_W }} />
            <col style={{ width: STAT_COL_W }} />
            <col style={{ width: STAT_COL_W }} />
            <col style={{ width: STAT_COL_W }} />
            {orderedParts.map(p => <col key={p.id} style={{ width: PART_COL_W }} />)}
          </colgroup>

          {/* Header */}
          <thead>
            <tr style={{ height: 48, background: '#1f2937' }}>
              <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-gray-300 font-semibold text-[10px]">Data</th>
              <th style={{ position: 'sticky', top: 0, left: colTeamsLeft, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-left px-1.5 text-gray-300 font-semibold">Jogo</th>
              <th style={{ position: 'sticky', top: 0, left: colScoreLeft, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-gray-200 font-semibold">Oficial</th>
              {/* Colunas de estatísticas */}
              <th title="Pontuaram — acertaram ao menos o vencedor do evento" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Pont.</th>
              <th title="Cravaram — acertaram o placar exato" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Crav.</th>
              <th title="Média de pontos dos participantes" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + 2 * STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Méd.</th>
              <th style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + 3 * STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '2px solid #6b7280' }}
                className="text-center px-0.5">
                <div className="flex items-center justify-center gap-0.5">
                  <span className="text-[9px] leading-none">🥇</span>
                  <span className="truncate font-semibold text-[9px] text-gray-300" style={{ maxWidth: STAT_COL_W - 18 }}>
                    {participants.find(p => p.id === leaderId)?.apelido ?? 'Líder'}
                  </span>
                </div>
                <span className="block text-[11px] font-semibold text-gray-500">
                  {leaderId && (computedTotals[leaderId] ?? 0) > 0 ? computedTotals[leaderId] : '–'}
                </span>
              </th>
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
                    <div className="flex items-center justify-center gap-0.5">
                      {p.id === leaderId && <span className="text-[9px] leading-none">🥇</span>}
                      <span className="truncate font-semibold" style={{ maxWidth: PART_COL_W - (p.id === leaderId ? 16 : 4) }}>{p.apelido}</span>
                    </div>
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
            {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={7 + participants.length} /></tr>}

            {vItems.map(vRow => {
              const row = allRows[vRow.index]
              const odd = vRow.index % 2 === 1
              const bg  = odd ? '#f9fafb' : '#ffffff'

              // ── Section header ──────────────────────────────────────────────
              if (row.kind === 'section') {
                const sectionBg = row.color === '#1e3a5f' ? '#dbeafe' : row.color === '#78350f' ? '#fef3c7' : '#ede9fe'
                const textCls   = row.color === '#1e3a5f' ? 'text-blue-700' : row.color === '#78350f' ? 'text-amber-800' : 'text-violet-700'
                const borderClr = row.color === '#1e3a5f' ? '#93c5fd' : row.color === '#78350f' ? '#fde68a' : '#c4b5fd'
                return (
                  <tr key={`sec-${row.label}`} style={{ height: ROW_H_SEC }}>
                    <td colSpan={7 + participants.length}
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
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                      className="text-center text-[10px] font-semibold text-blue-800">
                      {of1 ? `Gr. ${g}` : <span className="text-gray-300">–</span>}
                    </td>
                    {/* Colunas de stats */}
                    {(() => {
                      const stats  = groupEventStats(g, of1, of2, participants, groupBetMap)
                      const lb     = groupBetMap.get(`${leaderId}:${g}`)
                      const lbKind = groupCellKind(lb, of1, of2)
                      const lbBg   = CELL_KIND_BG_HEX[lbKind] || '#eff6ff'
                      const media  = stats.media > 0 ? stats.media.toFixed(1) : '—'
                      const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#eff6ff' } : {}
                      return (<>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-blue-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-blue-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #93c5fd' } : {}) }} className="border-r border-blue-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                          className={`border-r border-blue-50 text-center ${isMobile ? CELL_BG[lbKind] : ''}`}>
                          {lb?.first_place ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className="text-[9px] text-gray-600 truncate font-medium" style={{ maxWidth: STAT_COL_W - 4 }}>
                                {(teamAbbrs[lb.first_place] ?? abbr(lb.first_place, 4))}/{(teamAbbrs[lb.second_place] ?? abbr(lb.second_place, 4))}
                              </span>
                              {lb.points !== null && (
                                <span className={`text-[10px] font-bold ${lb.points > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {lb.points > 0 ? `+${lb.points}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      </>)
                    })()}
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
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#faf5ff', borderRight: '1px solid #e9d5ff' }}
                      className="text-center text-[10px] text-violet-600 font-semibold">
                      {ot ? `Gr. ${g}` : <span className="text-gray-300">–</span>}
                    </td>
                    {/* Colunas de stats */}
                    {(() => {
                      const thirdPts = rules['terceiro_classificado'] ?? 3
                      const stats    = thirdEventStats(g, ot, thirdPts, participants, thirdBetMap)
                      const lb       = thirdBetMap.get(`${leaderId}:${g}`)
                      const lbKind   = thirdCellKind(lb?.team, ot)
                      const lbPts    = lbKind === 'exact' ? thirdPts : lbKind === 'wrong' ? 0 : null
                      const lbBg     = CELL_KIND_BG_HEX[lbKind] || '#faf5ff'
                      const media    = stats.media > 0 ? stats.media.toFixed(1) : '—'
                      const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#faf5ff' } : {}
                      return (<>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-violet-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-violet-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #c4b5fd' } : {}) }} className="border-r border-violet-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                          className={`border-r border-violet-50 text-center ${isMobile ? CELL_BG[lbKind] : ''}`}>
                          {lb?.team ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className="text-[9px] text-gray-600 truncate font-medium" style={{ maxWidth: STAT_COL_W - 4 }}>
                                {teamAbbrs[lb.team] ?? abbr(lb.team)}
                              </span>
                              {lbPts !== null && (
                                <span className={`text-[10px] font-bold ${lbPts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {lbPts > 0 ? `+${lbPts}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      </>)
                    })()}
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

              // ── G4 row ─────────────────────────────────────────────────────
              if (row.kind === 'g4_row') {
                const a = (name: string) => teamAbbrs[name] ?? abbr(name, 4)
                const kr = knockoutResults
                return (
                  <tr key="g4_row" style={{ height: ROW_H_G4, background: '#fffbeb' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="text-center text-[9px] font-bold text-amber-700">G4</td>
                    <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="px-1.5 text-[9px] text-amber-800">
                      <div className="leading-snug">
                        {kr.champion  && <div>🏆 {a(kr.champion)}</div>}
                        {kr.runnerUp  && <div>🥈 {a(kr.runnerUp)}</div>}
                        {kr.third     && <div>3º {a(kr.third)}</div>}
                        {kr.fourth    && <div>4º {a(kr.fourth)}</div>}
                        {!kr.champion && <span className="text-gray-300">–</span>}
                      </div>
                    </td>
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="text-center text-[9px] text-amber-600 font-semibold">G4</td>
                    {/* Colunas de stats */}
                    {(() => {
                      const stats  = g4EventStats(participants, tournamentBetMap, knockoutResults, rules, isZebraChampion, scorerMapping)
                      const lb     = tournamentBetMap.get(leaderId)
                      const lbG4Pts = lb ? scoreTournamentBet({ ...lb, top_scorer: '' }, knockoutResults, rules, isZebraChampion, scorerMapping) : null
                      const media  = stats.media > 0 ? stats.media.toFixed(1) : '—'
                      const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#fffbeb' } : {}
                      return (<>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #fde68a' } : {}) }} className="border-r border-amber-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W } : {}) }} className="border-r border-amber-50 text-center">
                          {lb ? (
                            <div className="flex flex-col items-center leading-none gap-px py-0.5">
                              <span className="text-[8px] text-gray-700 truncate font-medium" style={{ maxWidth: STAT_COL_W - 4 }}>🏆{a(lb.champion)}</span>
                              <span className="text-[8px] text-gray-700 truncate font-medium" style={{ maxWidth: STAT_COL_W - 4 }}>🥈{a(lb.runner_up)}</span>
                              {lbG4Pts !== null && (
                                <span className={`text-[10px] font-bold ${lbG4Pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {lbG4Pts > 0 ? `+${lbG4Pts}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      </>)
                    })()}
                    {orderedParts.map((p, idx) => {
                      const bet  = tournamentBetMap.get(p.id)
                      const isMe = p.id === activeParticipantId
                      const isFrozen = frozenPartLeft !== null && idx === 0
                      const g4pts = bet
                        ? scoreTournamentBet({ ...bet, top_scorer: '' }, knockoutResults, rules, isZebraChampion, scorerMapping)
                        : null
                      const hasPts = g4pts !== null && g4pts > 0
                      return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: '#fffbeb', borderLeft: '2px solid #fde68a' } : undefined}
                          className={`border-r border-amber-50 text-center ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          {bet ? (
                            <div className="flex flex-col items-center leading-none gap-px py-0.5">
                              <span className="text-[8px] text-gray-700 truncate font-medium" style={{ maxWidth: PART_COL_W - 4 }}>🏆{a(bet.champion)}</span>
                              <span className="text-[8px] text-gray-700 truncate font-medium" style={{ maxWidth: PART_COL_W - 4 }}>🥈{a(bet.runner_up)}</span>
                              <span className="text-[8px] text-gray-500 truncate" style={{ maxWidth: PART_COL_W - 4 }}>{a(bet.semi1)}·{a(bet.semi2)}</span>
                              {g4pts !== null && (
                                <span className={`text-[10px] font-bold ${hasPts ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {hasPts ? `+${g4pts}` : '0'}
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

              // ── Scorer row ──────────────────────────────────────────────────
              if (row.kind === 'scorer_row') {
                const artilhPts = rules['artilheiro'] ?? 18
                const officialNames = localScorers.join(', ')
                return (
                  <tr key="scorer_row" style={{ height: ROW_H_BONUS, background: '#fffbeb' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="text-center text-[8px] font-bold text-amber-700">⚽<br/>Art.</td>
                    <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="px-1.5 text-[10px] text-amber-800 font-semibold">
                      <span className="block truncate" style={{ maxWidth: colTeamsW - 8 }}>
                        {officialNames || <span className="text-gray-300">–</span>}
                      </span>
                    </td>
                    <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                      className="text-center text-[9px] text-amber-600 font-semibold">Art.</td>
                    {/* Colunas de stats */}
                    {(() => {
                      const stats     = scorerEventStats(participants, tournamentBetMap, localScorers, artilhPts, scorerMapping)
                      const lb        = tournamentBetMap.get(leaderId)
                      const rawLb     = lb?.top_scorer ?? ''
                      const lbDisplay = rawLb ? (scorerMapping[rawLb] ?? rawLb) : ''
                      const lbCorrect = lbDisplay.length > 0 && localScorers.length > 0
                        && localScorers.some(s => s.trim().toLowerCase() === lbDisplay.trim().toLowerCase())
                      const lbPts     = localScorers.length > 0 && lbDisplay ? (lbCorrect ? artilhPts : 0) : null
                      const lbBg      = lbCorrect ? '#d1fae5' : (lbPts !== null ? '#fff1f2' : '#fffbeb')
                      const media     = stats.media > 0 ? stats.media.toFixed(1) : '—'
                      const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#fffbeb' } : {}
                      return (<>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #fde68a' } : {}) }} className="border-r border-amber-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                        <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                          className={`border-r border-amber-50 text-center ${isMobile ? (lbCorrect ? 'bg-emerald-100' : lbPts !== null ? 'bg-rose-50' : '') : ''}`}>
                          {lbDisplay ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className="text-[9px] text-gray-700 truncate font-medium" style={{ maxWidth: STAT_COL_W - 4 }}>{lbDisplay}</span>
                              {lbPts !== null && (
                                <span className={`text-[10px] font-bold ${lbCorrect ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {lbCorrect ? `+${lbPts}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : <span className="text-gray-200">—</span>}
                        </td>
                      </>)
                    })()}
                    {orderedParts.map((p, idx) => {
                      const bet  = tournamentBetMap.get(p.id)
                      const isMe = p.id === activeParticipantId
                      const isFrozen = frozenPartLeft !== null && idx === 0
                      if (!bet?.top_scorer) return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: '#fffbeb', borderLeft: '2px solid #fde68a' } : undefined}
                          className={`border-r border-amber-50 text-center ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          <span className="text-gray-200">—</span>
                        </td>
                      )
                      const displayName = scorerMapping[bet.top_scorer] ?? bet.top_scorer
                      const norm      = displayName.trim().toLowerCase()
                      const isCorrect = localScorers.length > 0 && localScorers.some(s => s.trim().toLowerCase() === norm)
                      const pts       = localScorers.length > 0 ? (isCorrect ? artilhPts : 0) : null
                      return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenPartLeft!, zIndex: 20, background: isCorrect ? '#d1fae5' : pts !== null ? '#fff1f2' : '#fffbeb', borderLeft: '2px solid #fde68a' } : undefined}
                          className={`border-r border-amber-50 text-center ${isCorrect ? 'bg-emerald-100' : pts !== null ? 'bg-rose-50' : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          <div className="flex flex-col items-center leading-none gap-px">
                            <span className="text-[9px] text-gray-700 truncate font-medium" style={{ maxWidth: PART_COL_W - 4 }}>
                              {displayName}
                            </span>
                            {pts !== null && (
                              <span className={`text-[10px] font-bold ${isCorrect ? 'text-emerald-600' : 'text-gray-300'}`}>
                                {isCorrect ? `+${pts}` : '0'}
                              </span>
                            )}
                          </div>
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
              const zebraThreshold = rules['percentual_zebra'] ?? 15
              const hasResult      = match.score_home !== null && match.score_away !== null
              const matchBetsList  = collectMatchBets(match.id, participants, betMap)
              const possibleZebras = !hasResult ? detectPossibleZebras(match.id, participants, betMap, zebraThreshold) : undefined
              const isActualZebra  = hasResult && matchBetsList.length > 0
                ? detectMatchZebra(matchBetsList, getMatchResult(match.score_home!, match.score_away!), zebraThreshold)
                : false
              const zebraImgW = isMobile ? 18 : 24
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
                      <div className="flex flex-col leading-none gap-0.5 min-w-0">
                        <div className="flex items-center gap-1">
                          <Flag code={flagHome} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                          <span className="font-bold text-[10px] text-gray-800 tracking-tight">{abbrHome}</span>
                          {match.is_brazil && <span className="shrink-0 text-[7px] font-black text-verde-700 bg-verde-100 rounded-sm px-0.5">×2</span>}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1">
                            <Flag code={flagAway} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                            <span className="font-bold text-[10px] text-gray-800 tracking-tight">{abbrAway}</span>
                          </div>
                          {isActualZebra && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src="/zebra.png" alt="🦓" width={zebraImgW} height={zebraImgW} className="shrink-0 object-contain" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <div className="flex flex-col leading-none gap-px min-w-0 flex-1">
                          <div className="flex items-center gap-0.5 min-w-0">
                            <span className="truncate font-semibold text-gray-800" style={{ maxWidth: colTeamsW - (isActualZebra ? 40 : 16) }}>{teamHome}</span>
                            {match.is_brazil && <span className="shrink-0 text-[7px] font-black text-verde-700 bg-verde-100 rounded-sm px-0.5">×2</span>}
                          </div>
                          <span className="text-[8px] text-gray-300">vs</span>
                          <span className="truncate font-semibold text-gray-800" style={{ maxWidth: colTeamsW - (isActualZebra ? 40 : 8) }}>{teamAway}</span>
                        </div>
                        {isActualZebra && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src="/zebra.png" alt="🦓" width={zebraImgW} height={zebraImgW} className="shrink-0 object-contain" />
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: bg, borderRight: '1px solid #f3f4f6' }}
                    className="text-center">
                    <ScoreInput match={match} canEdit={canEdit(match)}
                      possibleZebras={possibleZebras}
                      isActualZebra={isActualZebra}
                      onSaved={(sh, sa) => {
                        setMatches(prev => prev.map(m => m.id === match.id ? { ...m, score_home: sh, score_away: sa } : m))
                        recomputeForMatch(match.id, sh, sa, match.is_brazil)
                      }}
                    />
                  </td>
                  {/* Colunas de stats */}
                  {(() => {
                    const stats  = matchEventStats(match.id, match.score_home, match.score_away, participants, betMap)
                    const lb     = betMap.get(`${leaderId}:${match.id}`)
                    const lbKind = matchCellKind(lb, match.score_home, match.score_away)
                    const lbPts  = getMatchPts(leaderId, match.id)
                    const lbBg   = CELL_KIND_BG_HEX[lbKind] || bg
                    const media  = stats.media > 0 ? stats.media.toFixed(1) : '—'
                    const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: bg } : {}
                    return (<>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-gray-100 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-gray-100 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #d1d5db' } : {}) }} className="border-r border-gray-100 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                        className={`border-r border-gray-100 text-center ${isMobile ? CELL_BG[lbKind] : ''}`}>
                        {lb ? (
                          <div className="flex flex-col items-center leading-none gap-px">
                            <span className="tabular-nums font-semibold text-[9px] text-gray-700">{lb.score_home}–{lb.score_away}</span>
                            {lbPts !== null && (
                              <span className={`tabular-nums font-bold text-[10px] ${lbPts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                {lbPts > 0 ? `+${lbPts}` : '0'}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                    </>)
                  })()}
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

            {padBot > 0 && <tr style={{ height: padBot }}><td colSpan={7 + participants.length} /></tr>}
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
