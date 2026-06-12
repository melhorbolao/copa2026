'use client'

import {
  useState, useEffect, useRef, useCallback, useTransition, memo, useMemo,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { createClient } from '@/lib/supabase/client'
import { scoreMatchBet, scoreGroupBet, detectMatchZebra, detectGroupZebra, getMatchResult, scoreTournamentBet } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap, computeGroupCompletion } from '@/lib/bracket/engine'
import type { KnockoutTeamOverride } from '@/lib/bracket/engine'
import { Flag } from '@/components/ui/Flag'
import type { RuleMap, TournamentResults, MatchResult } from '@/lib/scoring/engine'
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
  lockedMatchIds?: string[]
  bonusIsLocked?: boolean
  existingSimulations: { match_id: string; score_home: number | null; score_away: number | null }[]
  userId: string
  existingGroupSims: { group_name: string; first_place: string | null; second_place: string | null }[]
  existingThirdSims: { group_name: string; team: string | null }[]
  existingTournamentSim: { champion: string | null; runner_up: string | null; semi1: string | null; semi2: string | null; top_scorer: string | null } | null
  prizeSpots?: number
  premioSpots?: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const PHASE_FILTERS = [
  { value: 'all',   label: 'Todos',   phases: ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'] },
  { value: 'group', label: 'Grupos',  phases: ['group'] },
  { value: 'r32',   label: '16avos',  phases: ['round_of_32'] },
  { value: 'r16',   label: 'Oitavas', phases: ['round_of_16'] },
  { value: 'qf',    label: 'Quartas', phases: ['quarterfinal'] },
  { value: 'sf',    label: 'Semis',   phases: ['semifinal'] },
  { value: 'final', label: 'Final',   phases: ['third_place', 'final'] },
] as const

const ROW_H        = 44
const ROW_H_BONUS  = 38
const ROW_H_SCORER = 120
const ROW_H_SEC    = 26

// Frozen column pixel offsets (desktop)
const COL_DATE_DESKTOP  = 48
const COL_TEAMS_DESKTOP = 148
const COL_TEAMS_MOBILE  = 60
const COL_SCORE_W       = 96
const PART_COL_W        = 80
const STAT_COL_W        = 52

// ── Row types ──────────────────────────────────────────────────────────────────

type TableRow =
  | { kind: 'match';      match: MatchFull }
  | { kind: 'section';    label: string; color: string }
  | { kind: 'group_bet';  groupName: string }
  | { kind: 'third_bet';  groupName: string }
  | { kind: 'g4_field'; field: 'champion' | 'runner_up' | 'semi1' | 'semi2' }
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

const CELL_KIND_BG_HEX: Record<CellKind, string> = {
  exact:   '#d1fae5',
  winner:  '#e0f2fe',
  wrong:   '#fff1f2',
  pending: '#ffffff',
  no_bet:  '',
}

// ── Zonas da classificação simulada ────────────────────────────────────────────

type SimZone = 'premio' | 'corte2' | 'corte1' | 'out' | 'last'

const SIM_ZONE_ROW: Record<SimZone, string> = {
  premio: 'bg-green-50', corte2: 'bg-sky-50', corte1: 'bg-amber-50',
  out: 'bg-white', last: 'bg-red-500',
}
const SIM_ZONE_TEXT: Record<SimZone, string> = {
  premio: 'text-green-800 font-semibold', corte2: 'text-sky-700 font-medium',
  corte1: 'text-amber-700', out: 'text-gray-400', last: 'text-white font-bold',
}
const SIM_ZONE_DOT: Record<SimZone, string> = {
  premio: 'bg-green-300', corte2: 'bg-sky-300', corte1: 'bg-amber-300',
  out: 'bg-gray-200', last: 'bg-red-400',
}

function calcSimCuts(n: number): { cut1: number; cut2: number } {
  const cut1 = Math.min(Math.ceil((n * 0.5) / 10) * 10, n)
  const cut2 = Math.min(Math.ceil((cut1 * 0.5) / 10) * 10, cut1)
  return { cut1, cut2 }
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

function groupEventStats(
  g: string, of1: string, of2: string,
  parts: Participant[],
  groupBetMap: Map<string, { first_place: string; second_place: string; points: number | null }>,
  isZebra1: boolean,
  rules: RuleMap,
): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = groupBetMap.get(`${p.id}:${g}`)
    if (!bet?.first_place) continue
    const kind = groupCellKind(bet, of1, of2)
    // Usa pontos do DB se disponíveis (grupo oficial completo); senão computa live (simulado)
    const pts = bet.points !== null
      ? bet.points
      : scoreGroupBet(bet.first_place, bet.second_place, of1, of2, isZebra1, rules)
    if (pts > 0) pontuaram++
    if (kind === 'exact') cravaram++
    total += pts
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

function scoreG4FieldBet(
  field: 'champion' | 'runner_up' | 'semi1' | 'semi2',
  betValue: string,
  results: TournamentResults,
  rules: RuleMap,
  isZebraChampion: boolean,
): number {
  if (!betValue) return 0
  const r = {
    semis:    rules['semifinalista']   ?? 4,
    finalist: rules['bonus_finalista'] ?? 8,
    campeao:  rules['bonus_campeao']   ?? 12,
    vice:     rules['bonus_vice']      ?? 8,
    terceiro: rules['bonus_terceiro']  ?? 6,
    quarto:   rules['bonus_quarto']    ?? 4,
    zebraG4:  rules['bonus_zebra_g4']  ?? 0,
  }
  let pts = 0
  if (field === 'champion') {
    if (results.semifinalists.includes(betValue)) pts += r.semis
    if (results.finalists.includes(betValue))     pts += r.finalist
    if (results.champion === betValue) { pts += r.campeao; if (isZebraChampion) pts += r.zebraG4 }
  } else if (field === 'runner_up') {
    if (results.semifinalists.includes(betValue)) pts += r.semis
    if (results.finalists.includes(betValue))     pts += r.finalist
    if (results.runnerUp === betValue)            pts += r.vice
  } else if (field === 'semi1') {
    if (results.semifinalists.includes(betValue)) pts += r.semis
    if (results.third === betValue)               pts += r.terceiro
  } else {
    if (results.semifinalists.includes(betValue)) pts += r.semis
    if (results.fourth === betValue)              pts += r.quarto
  }
  return pts
}

function g4FieldStats(
  field: 'champion' | 'runner_up' | 'semi1' | 'semi2',
  parts: Participant[],
  tournamentBetMap: Map<string, TournamentBetRaw>,
  results: TournamentResults,
  rules: RuleMap,
  isZebraChampion: boolean,
): EventStats {
  const official = field === 'champion' ? results.champion : field === 'runner_up' ? results.runnerUp : field === 'semi1' ? results.third : results.fourth
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = tournamentBetMap.get(p.id)
    const val = bet?.[field] ?? ''
    const pts = scoreG4FieldBet(field, val, results, rules, isZebraChampion)
    if (pts > 0) pontuaram++
    if (val && official && val === official) cravaram++
    total += pts
  }
  return { pontuaram, cravaram, media: parts.length > 0 ? total / parts.length : 0 }
}

function scorerEventStats(parts: Participant[], tournamentBetMap: Map<string, TournamentBetRaw>, localScorers: string[], artilhPts: number, scorerMapping: Record<string, string>): EventStats {
  let pontuaram = 0, cravaram = 0, total = 0
  for (const p of parts) {
    const bet = tournamentBetMap.get(p.id)
    if (!bet?.top_scorer) continue
    const norm      = (scorerMapping[bet.top_scorer.toLowerCase().trim()] ?? bet.top_scorer).trim().toLowerCase()
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

// ── SimScoreInput ──────────────────────────────────────────────────────────────

const SimScoreInput = memo(function SimScoreInput({
  match, canEdit, possibleZebras, isActualZebra, isActualZebraBet, simScore, onSaved,
}: {
  match: MatchFull
  canEdit: boolean
  possibleZebras?: { H: ZebraOutcome; D: ZebraOutcome; A: ZebraOutcome }
  isActualZebra?: boolean
  isActualZebraBet?: boolean
  simScore?: { score_home: number; score_away: number }
  onSaved: (sh: number | null, sa: number | null) => void
}) {
  const [home, setHome] = useState(simScore?.score_home?.toString() ?? '')
  const [away, setAway] = useState(simScore?.score_away?.toString() ?? '')
  const homeRef  = useRef(home)
  const awayRef  = useRef(away)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [, startTransition] = useTransition()

  useEffect(() => {
    const h = simScore?.score_home?.toString() ?? ''
    const a = simScore?.score_away?.toString() ?? ''
    setHome(h); homeRef.current = h
    setAway(a); awayRef.current = a
  }, [simScore?.score_home, simScore?.score_away])

  const triggerSave = useCallback((h: string, a: string) => {
    clearTimeout(timerRef.current)
    const hNum = parseInt(h, 10)
    const aNum = parseInt(a, 10)
    if (isNaN(hNum) || isNaN(aNum) || hNum < 0 || aNum < 0) return
    timerRef.current = setTimeout(() => {
      startTransition(() => { onSaved(hNum, aNum) })
    }, 800)
  }, [onSaved]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasSim = simScore !== undefined

  if (!canEdit) {
    // Placar oficial: read-only (jogo já encerrado ou fora da janela de 4h)
    if (match.score_home !== null && match.score_away !== null) {
      const result = getMatchResult(match.score_home, match.score_away)
      const zebraScoreCls = isActualZebraBet ? 'bg-gray-900 text-white' : 'bg-gray-500 text-white'
      const zebraDrawCls  = isActualZebraBet ? 'rounded bg-gray-900 text-white px-0.5' : 'rounded bg-gray-500 text-white px-0.5'
      return (
        <div className="inline-flex items-center gap-0.5">
          <span className={`inline-flex items-center justify-center min-w-[18px] rounded px-0.5 text-xs font-bold tabular-nums ${isActualZebra && result === 'H' ? zebraScoreCls : 'text-gray-700'}`}>
            {match.score_home}
          </span>
          <span className={`text-[9px] font-bold ${isActualZebra && result === 'D' ? zebraDrawCls : 'text-gray-300'}`}>×</span>
          <span className={`inline-flex items-center justify-center min-w-[18px] rounded px-0.5 text-xs font-bold tabular-nums ${isActualZebra && result === 'A' ? zebraScoreCls : 'text-gray-700'}`}>
            {match.score_away}
          </span>
        </div>
      )
    }
    const pz = possibleZebras
    if (!pz || (!pz.H && !pz.D && !pz.A)) return <span className="text-gray-300 text-xs">–</span>
    return (
      <div className="inline-flex items-center gap-0.5">
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] ${pz.H === 'apostada' ? 'bg-gray-900' : pz.H === 'sem_aposta' ? 'bg-gray-500' : 'bg-gray-100 border border-gray-200'}`} />
        <span className={`text-[9px] font-bold ${pz.D === 'apostada' ? 'rounded bg-gray-900 text-white px-0.5' : pz.D === 'sem_aposta' ? 'rounded bg-gray-500 text-white px-0.5' : 'text-gray-300'}`}>×</span>
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[9px] ${pz.A === 'apostada' ? 'bg-gray-900' : pz.A === 'sem_aposta' ? 'bg-gray-500' : 'bg-gray-100 border border-gray-200'}`} />
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
          possibleZebras?.H === 'apostada' || (isActualZebra && isActualZebraBet && currentResult === 'H')
            ? 'border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:border-gray-600'
            : possibleZebras?.H === 'sem_aposta' || (isActualZebra && !isActualZebraBet && currentResult === 'H')
              ? 'border-gray-500 bg-gray-500 text-white placeholder-gray-300 focus:border-gray-400'
              : 'border-amber-200 bg-amber-50 focus:border-amber-400'
        }`}
      />
      <span className={`text-[9px] font-bold ${
        possibleZebras?.D === 'apostada' || (isActualZebra && isActualZebraBet && currentResult === 'D') ? 'rounded bg-gray-900 text-white px-0.5'
        : possibleZebras?.D === 'sem_aposta' || (isActualZebra && !isActualZebraBet && currentResult === 'D') ? 'rounded bg-gray-500 text-white px-0.5'
        : 'text-gray-300'
      }`}>×</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" value={away}
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0,2); setAway(v); awayRef.current = v; triggerSave(homeRef.current, v) }}
        placeholder="–"
        className={`w-7 rounded border text-center text-xs font-bold py-0.5 focus:outline-none ${
          possibleZebras?.A === 'apostada' || (isActualZebra && isActualZebraBet && currentResult === 'A')
            ? 'border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:border-gray-600'
            : possibleZebras?.A === 'sem_aposta' || (isActualZebra && !isActualZebraBet && currentResult === 'A')
              ? 'border-gray-500 bg-gray-500 text-white placeholder-gray-300 focus:border-gray-400'
              : 'border-amber-200 bg-amber-50 focus:border-amber-400'
        }`}
      />
      {hasSim && (
        <button
          onClick={() => {
            setHome(''); homeRef.current = ''
            setAway(''); awayRef.current = ''
            clearTimeout(timerRef.current)
            onSaved(null, null)
          }}
          className="text-[9px] text-gray-400 hover:text-red-400 leading-none ml-0.5"
        >×</button>
      )}
    </div>
  )
})

// ── Classificação Simulada Resumida ────────────────────────────────────────────

const SimCompactRanking = memo(function SimCompactRanking({
  ranked, premioSpots, isUniqueLast, activeParticipantId,
}: {
  ranked: { id: string; apelido: string; pts: number; rank: number }[]
  premioSpots: number
  isUniqueLast: boolean
  activeParticipantId: string
}) {
  const n = ranked.length
  if (n === 0) return null
  const { cut1, cut2 } = calcSimCuts(n)
  const premioLine = ranked[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line   = cut2 > premioSpots ? (ranked[cut2 - 1]?.pts ?? null) : null
  const cut1Line   = cut1 > cut2        ? (ranked[cut1 - 1]?.pts ?? null) : null
  const lastRank   = ranked[n - 1].rank

  function zoneOf(r: { rank: number; pts: number }): SimZone {
    if (isUniqueLast && r.rank === lastRank) return 'last'
    if (r.pts >= premioLine) return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line) return 'corte2'
    if (cut1Line !== null && r.pts >= cut1Line) return 'corte1'
    return 'out'
  }

  const blockSize = Math.ceil(n / 7)
  const blocks = [0, 1, 2, 3, 4, 5, 6]
    .map(i => ranked.slice(i * blockSize, (i + 1) * blockSize))
    .filter(b => b.length > 0)

  const legendItems: { zone: SimZone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(cut2 > premioSpots ? [{ zone: 'corte2' as SimZone, label: `2º corte (top ${cut2})` }] : []),
    ...(cut1 > cut2        ? [{ zone: 'corte1' as SimZone, label: `1º corte (top ${cut1})` }] : []),
    ...(isUniqueLast ? [{ zone: 'last' as SimZone, label: 'Lanterna' }] : []),
  ]

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-white shadow-sm">
      <div className="border-b border-amber-100 px-4 py-2.5">
        <p className="text-base font-black text-gray-800">Classificação Simulada Resumida</p>
        <p className="text-xs text-gray-400 mt-0.5">Pontuação total: oficial + simulada</p>
      </div>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 divide-x divide-gray-100" style={{ minWidth: '1200px' }}>
          {blocks.map((block, bi) => (
            <div key={bi}>
              <div className="grid grid-cols-[1.5rem_1fr_2rem] border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                <span className="text-right pr-0.5">#</span>
                <span className="pl-1">Participante</span>
                <span className="text-right">PTS</span>
              </div>
              {block.map((r, ri) => {
                const z = zoneOf(r)
                const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z
                const isMe = r.id === activeParticipantId
                return (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1.5rem_1fr_2rem] px-2 py-[3px] text-[12px] ${SIM_ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''} ${isMe ? 'ring-inset ring-1 ring-amber-400' : ''}`}
                  >
                    <span className={`text-right pr-0.5 tabular-nums ${SIM_ZONE_TEXT[z]}`}>{r.rank}</span>
                    <span className={`pl-1 line-clamp-2 break-words ${SIM_ZONE_TEXT[z]}`} title={r.apelido}>
                      {r.apelido}{z === 'last' && ' 🔦'}
                      {isMe && <span className="ml-1 text-[10px] text-amber-600">◀</span>}
                    </span>
                    <span className={`text-right tabular-nums font-bold ${SIM_ZONE_TEXT[z]}`}>{r.pts}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2">
        {legendItems.map(({ zone: z, label }) => (
          <span key={z} className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SIM_ZONE_DOT[z]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
})

// ── Zebra helpers ──────────────────────────────────────────────────────────────

type ZebraOutcome = 'apostada' | 'sem_aposta' | false

function zebraOutcome(
  betsList: Array<{ score_home: number; score_away: number }>,
  result: MatchResult,
  threshold: number,
): ZebraOutcome {
  if (!detectMatchZebra(betsList, result, threshold)) return false
  const count = betsList.filter(b => getMatchResult(b.score_home, b.score_away) === result).length
  return count > 0 ? 'apostada' : 'sem_aposta'
}

function collectMatchBets(matchId: string, participants: Participant[], betMap: BetMap) {
  const bets: Array<{ score_home: number; score_away: number }> = []
  for (const p of participants) {
    const bet = betMap.get(`${p.id}:${matchId}`)
    if (bet) bets.push(bet)
  }
  return bets
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

export function SimuladorClient({
  initialMatches, participants, initialBets, initialGroupBets, initialThirdBets,
  initialTournamentBets, participantTotals, rules, isAdmin: _isAdmin, activeParticipantId,
  teamAbbrs, officialTopScorers, scorerMapping,
  lockedMatchIds, bonusIsLocked = false,
  existingSimulations, userId,
  existingGroupSims, existingThirdSims, existingTournamentSim,
  prizeSpots: _prizeSpots = 8, premioSpots = 10,
}: Props) {
  const [matches, setMatches] = useState<MatchFull[]>(initialMatches)
  const [betMap,  setBetMap]  = useState<BetMap>(() => buildBetMap(initialBets))
  const [phase,   setPhase]   = useState('all')
  const [isMobile, setIsMobile] = useState(false)
  const [tab, setTab] = useState<'tabela' | 'classificacao'>('tabela')
  const [isGabaritando, setIsGabaritando] = useState(false)
  const [isLimpando,    setIsLimpando]    = useState(false)
  const [watchParticipantId, setWatchParticipantId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(`sim_watch_${userId}`) || null
  })
  const [showWatchSelector,   setShowWatchSelector]   = useState(false)
  const [watchQuery,           setWatchQuery]           = useState('')

  useEffect(() => {
    const key = `sim_watch_${userId}`
    const handler = (e: StorageEvent) => {
      if (e.key === key) setWatchParticipantId(e.newValue || null)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [userId])
  const [showGabaritarDe,     setShowGabaritarDe]     = useState(false)
  const [gabaritarDeQuery,    setGabaritarDeQuery]    = useState('')
  const [gabaritarDeSelected, setGabaritarDeSelected] = useState<string | null>(null)
  const [isGabaritandoDe,     setIsGabaritandoDe]     = useState(false)

  // simMap: simulações pessoais do usuário — match_id → {score_home, score_away}
  const [simMap, setSimMap] = useState<Map<string, { score_home: number; score_away: number }>>(() => {
    const m = new Map<string, { score_home: number; score_away: number }>()
    for (const s of existingSimulations) {
      if (s.score_home !== null && s.score_away !== null) {
        m.set(s.match_id, { score_home: s.score_home, score_away: s.score_away })
      }
    }
    return m
  })

  const [simGroupMap, setSimGroupMap] = useState<Map<string, { first: string; second: string }>>(() => {
    const m = new Map<string, { first: string; second: string }>()
    for (const s of existingGroupSims) {
      if (s.first_place) m.set(s.group_name, { first: s.first_place, second: s.second_place ?? '' })
    }
    return m
  })

  const [simThirdMap, setSimThirdMap] = useState<Map<string, { team: string }>>(() => {
    const m = new Map<string, { team: string }>()
    for (const s of existingThirdSims) {
      if (s.team) m.set(s.group_name, { team: s.team })
    }
    return m
  })

  const [simTournament, setSimTournament] = useState<{ champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }>(() => ({
    champion:   existingTournamentSim?.champion   ?? '',
    runner_up:  existingTournamentSim?.runner_up  ?? '',
    semi1:      existingTournamentSim?.semi1      ?? '',
    semi2:      existingTournamentSim?.semi2      ?? '',
    top_scorer: existingTournamentSim?.top_scorer ?? '',
  }))

  const containerRef = useRef<HTMLDivElement>(null)
  const supabase = useRef(createClient())

  const watchPart = watchParticipantId ? participants.find(p => p.id === watchParticipantId) : null
  const saveWatchPart = useCallback((id: string | null) => {
    setWatchParticipantId(id)
    const key = `sim_watch_${userId}`
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: id ?? null }))
  }, [userId])

  // Conjunto de match IDs com prazo aberto (palpites ocultos)
  const lockedSet = useMemo(() => new Set(lockedMatchIds ?? []), [lockedMatchIds])

  const teamsByGroup = useMemo(() => {
    const m = new Map<string, { name: string; flag: string }[]>()
    for (const match of matches) {
      if (!match.group_name || match.phase !== 'group') continue
      const g = match.group_name
      if (!m.has(g)) m.set(g, [])
      const list = m.get(g)!
      for (const [team, flag] of [[match.team_home, match.flag_home], [match.team_away, match.flag_away]] as [string, string][]) {
        if (!list.find(x => x.name === team)) list.push({ name: team, flag })
      }
    }
    for (const g of GROUP_ORDER) {
      const list = m.get(g)
      if (list) list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    }
    return m
  }, [matches])

  const allTeams = useMemo(() => {
    const seen = new Set<string>()
    const teams: { name: string; flag: string }[] = []
    for (const match of matches) {
      if (match.phase !== 'group') continue
      for (const [team, flag] of [[match.team_home, match.flag_home], [match.team_away, match.flag_away]] as [string, string][]) {
        if (!seen.has(team)) { seen.add(team); teams.push({ name: team, flag }) }
      }
    }
    return teams.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [matches])

  // Group / third bet maps (static)
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

  const allBettedScorers = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const bet of tournamentBetMap.values()) {
      if (!bet.top_scorer) continue
      const norm = scorerMapping[bet.top_scorer.toLowerCase().trim()] ?? bet.top_scorer
      if (!seen.has(norm)) { seen.add(norm); result.push(norm) }
    }
    return result.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [tournamentBetMap, scorerMapping])

  // Mobile breakpoint (< 640px)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Supabase Realtime — monitora resultado oficial
  useEffect(() => {
    const sb = supabase.current
    const ch = sb.channel('simulador_rt')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload: any) => {
        const upd = payload.new as Partial<MatchFull> & { id: string }
        setMatches(prev => prev.map(m => m.id === upd.id ? { ...m, ...upd } : m))
        if (upd.score_home != null && upd.score_away != null && upd.is_brazil != null) {
          recomputeForMatch(upd.id, upd.score_home, upd.score_away, upd.is_brazil)
        }
      })
      .subscribe()
    return () => { sb.removeChannel(ch) }
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

  const resetLivePointsForMatch = useCallback((matchId: string) => {
    setBetMap(prev => {
      const next = new Map(prev)
      for (const p of participants) {
        const key = `${p.id}:${matchId}`
        const bet = prev.get(key)
        if (bet) next.set(key, { ...bet, livePoints: undefined })
      }
      return next
    })
  }, [participants])

  // Bulk-recompute livePoints on initial mount (usa effective scores com sim)
  useEffect(() => {
    setBetMap(prev => {
      let changed = false
      const next = new Map(prev)
      for (const m of matches) {
        const sh = m.score_home ?? simMap.get(m.id)?.score_home ?? null
        const sa = m.score_away ?? simMap.get(m.id)?.score_away ?? null
        if (sh === null || sa === null) continue
        const allBetsForMatch: Array<{ score_home: number; score_away: number }> = []
        for (const [key, bet] of prev) {
          if (key.endsWith(`:${m.id}`)) allBetsForMatch.push(bet)
        }
        const isZebra = detectMatchZebra(allBetsForMatch, getMatchResult(sh, sa), rules['percentual_zebra'] ?? 15)
        for (const p of participants) {
          const key = `${p.id}:${m.id}`
          const bet = prev.get(key)
          if (bet) {
            next.set(key, { ...bet, livePoints: scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, m.is_brazil, rules) })
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist simulation score ───────────────────────────────────────────────

  const persistSimScore = useCallback(async (matchId: string, sh: number | null, sa: number | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase.current as any
    if (sh === null) {
      await sb.from('user_simulations').delete().eq('user_id', userId).eq('match_id', matchId)
    } else {
      await sb.from('user_simulations').upsert(
        { user_id: userId, match_id: matchId, score_home: sh, score_away: sa, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,match_id' },
      )
    }
  }, [userId])

  // ── canEdit ────────────────────────────────────────────────────────────────

  const canEdit = useCallback((match: MatchFull) => {
    const now = Date.now()
    const matchStart = new Date(match.match_datetime).getTime()
    // Dentro da janela de 4h após o início: sempre editável (mesmo com placar oficial)
    if (now >= matchStart && now < matchStart + 4 * 3600_000) return true
    if (match.score_home !== null) return false
    if (lockedSet.has(match.id)) return false
    return true
  }, [lockedSet])

  const phaseConfig = PHASE_FILTERS.find(f => f.value === phase) ?? PHASE_FILTERS[0]
  const filteredMatches = useMemo(
    () => matches
      .filter(m => (phaseConfig.phases as readonly string[]).includes(m.phase))
      .filter(m => !lockedSet.has(m.id))
      .sort((a, b) => new Date(a.match_datetime).getTime() - new Date(b.match_datetime).getTime()),
    [matches, phaseConfig, lockedSet],
  )

  // Build unified row list
  const allRows = useMemo((): TableRow[] => {
    const rows: TableRow[] = filteredMatches.map(m => ({ kind: 'match', match: m }))
    if (phase === 'group' || phase === 'all') {
      rows.push({ kind: 'section', label: '1º e 2º Classificados por Grupo', color: '#1e3a5f' })
      GROUP_ORDER.forEach(g => rows.push({ kind: 'group_bet', groupName: g }))
      rows.push({ kind: 'section', label: 'Melhores Terceiros Classificados', color: '#3b0764' })
      GROUP_ORDER.forEach(g => rows.push({ kind: 'third_bet', groupName: g }))
    }
    if (phase === 'final' || phase === 'all') {
      rows.push({ kind: 'section', label: 'G4 — Bônus por Posição', color: '#78350f' })
      rows.push({ kind: 'g4_field', field: 'champion' })
      rows.push({ kind: 'g4_field', field: 'runner_up' })
      rows.push({ kind: 'g4_field', field: 'semi1' })
      rows.push({ kind: 'g4_field', field: 'semi2' })
      rows.push({ kind: 'section', label: 'Artilheiro', color: '#78350f' })
      rows.push({ kind: 'scorer_row' })
    }
    return rows
  }, [phase, filteredMatches])

  // Virtualizer
  const rowVirtualizer = useVirtualizer({
    count: allRows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: i => {
      const r = allRows[i]
      if (r.kind === 'section') return ROW_H_SEC
      if (r.kind === 'scorer_row') return ROW_H_SCORER
      if (r.kind === 'group_bet' || r.kind === 'third_bet' || r.kind === 'g4_field') return ROW_H_BONUS
      return ROW_H
    },
    overscan: 8,
  })

  const colDateW     = isMobile ? 0 : COL_DATE_DESKTOP
  const colTeamsW    = isMobile ? COL_TEAMS_MOBILE : COL_TEAMS_DESKTOP
  const colTeamsLeft = colDateW
  const colScoreLeft = colTeamsLeft + colTeamsW
  const frozenTotal  = colScoreLeft + COL_SCORE_W

  const activePart   = participants.find(p => p.id === activeParticipantId)
  const otherParts   = participants.filter(p => p.id !== activeParticipantId)
  const frozenPartLeft = !isMobile && activePart ? frozenTotal + 3 * STAT_COL_W + PART_COL_W : null

  // Official group standings (computed from official match scores only)
  const officialContext = useMemo(() => {
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
    const standings = calcGroupStandings(slim, scoreMap)
    const completion = computeGroupCompletion(slim, scoreMap)
    return { standings, completion }
  }, [matches])

  const officialStandings = officialContext.standings
  const officialThirds = useMemo(() => rankThirds(officialStandings), [officialStandings])
  const completeGroupsSet = officialContext.completion.completeGroups
  const allGroupsComplete = officialContext.completion.allGroupsComplete

  const knockoutTeamMap = useMemo(() => {
    const thirdSlots = resolveThirdSlots(officialThirds)
    if (!thirdSlots) return new Map<string, KnockoutTeamOverride>()
    const r32Slots = buildR32Teams(
      officialStandings, officialThirds, thirdSlots, undefined,
      officialContext.completion.completeGroups,
      officialContext.completion.allGroupsComplete,
    )
    const knockoutMatches = matches.filter(m => m.phase !== 'group')
    return buildKnockoutTeamMap(r32Slots, knockoutMatches)
  }, [officialStandings, officialThirds, matches, officialContext.completion])

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

  const effectiveKnockoutResults = useMemo((): TournamentResults => {
    const kr = knockoutResults
    const effChampion = kr.champion  ?? (simTournament.champion   || null)
    const effRunnerUp = kr.runnerUp  ?? (simTournament.runner_up  || null)
    const effThird    = kr.third     ?? (simTournament.semi1      || null)
    const effFourth   = kr.fourth    ?? (simTournament.semi2      || null)
    const effFinalists = kr.finalists.length > 0
      ? kr.finalists
      : [effChampion, effRunnerUp].filter((t): t is string => !!t)
    const effSemis = kr.semifinalists.length > 0
      ? kr.semifinalists
      : [...new Set([effChampion, effRunnerUp, effThird, effFourth].filter((t): t is string => !!t))]
    const effScorers = kr.officialScorers.length > 0
      ? kr.officialScorers
      : simTournament.top_scorer.length > 0 ? simTournament.top_scorer.split('|').filter(Boolean) : []
    return { semifinalists: effSemis, finalists: effFinalists, champion: effChampion, runnerUp: effRunnerUp, third: effThird, fourth: effFourth, officialScorers: effScorers }
  }, [knockoutResults, simTournament])

  const isZebraChampion = useMemo(() => {
    if (!effectiveKnockoutResults.champion || tournamentBetMap.size === 0) return false
    const threshold = rules['percentual_zebra'] ?? 15
    const correct = [...tournamentBetMap.values()].filter(b => b.champion === effectiveKnockoutResults.champion).length
    return (correct / tournamentBetMap.size) * 100 <= threshold
  }, [effectiveKnockoutResults.champion, tournamentBetMap, rules])

  const potentialZebraChampions = useMemo(() => {
    const threshold = rules['percentual_zebra'] ?? 15
    const allPicks = participants.map(p => tournamentBetMap.get(p.id)?.champion).filter((x): x is string => !!x)
    if (!allPicks.length) return new Set<string>()
    const result = new Set<string>()
    for (const team of new Set(allPicks)) {
      if (detectGroupZebra(allPicks.map(fp => ({ first_place: fp })), team, threshold)) result.add(team)
    }
    return result
  }, [rules, participants, tournamentBetMap])

  const groupPotentialZebraTeams = useMemo(() => {
    const threshold = rules['percentual_zebra'] ?? 15
    const result = new Map<string, Set<string>>()
    for (const g of GROUP_ORDER) {
      const allPicks = participants.map(p => groupBetMap.get(`${p.id}:${g}`)?.first_place).filter((x): x is string => !!x)
      const zebraTeams = new Set<string>()
      if (allPicks.length) {
        for (const team of new Set(allPicks)) {
          if (detectGroupZebra(allPicks.map(fp => ({ first_place: fp })), team, threshold)) zebraTeams.add(team)
        }
      }
      result.set(g, zebraTeams)
    }
    return result
  }, [rules, participants, groupBetMap])

  const groupActualZebras = useMemo(() => {
    const threshold = rules['percentual_zebra'] ?? 15
    const result = new Set<string>()
    for (const g of GROUP_ORDER) {
      const of1 = officialStandings.find(s => s.group === g)?.teams[0]?.team ?? ''
      if (!of1) continue
      const allPicks = participants.map(p => groupBetMap.get(`${p.id}:${g}`)?.first_place).filter((x): x is string => !!x)
      if (allPicks.length && detectGroupZebra(allPicks.map(fp => ({ first_place: fp })), of1, threshold)) result.add(g)
    }
    return result
  }, [rules, participants, groupBetMap, officialStandings])

  const offFirstMap  = useMemo(() => new Map(GROUP_ORDER.map(g => [g, completeGroupsSet.has(g) ? (officialStandings.find(s => s.group === g)?.teams[0]?.team ?? '') : ''])), [officialStandings, completeGroupsSet])
  const offSecondMap = useMemo(() => new Map(GROUP_ORDER.map(g => [g, completeGroupsSet.has(g) ? (officialStandings.find(s => s.group === g)?.teams[1]?.team ?? '') : ''])), [officialStandings, completeGroupsSet])
  const offThirdMap  = useMemo(() => new Map(GROUP_ORDER.map(g => [g, allGroupsComplete ? (officialThirds.find(t => t.group === g && t.advances)?.team ?? '') : ''])), [officialThirds, allGroupsComplete])

  // Effective maps: oficial se disponível, sim como fallback
  const effFirstMap  = useMemo(() => new Map(GROUP_ORDER.map(g => [g, offFirstMap.get(g)  || simGroupMap.get(g)?.first  || ''])), [offFirstMap,  simGroupMap])
  const effSecondMap = useMemo(() => new Map(GROUP_ORDER.map(g => [g, offSecondMap.get(g) || simGroupMap.get(g)?.second || ''])), [offSecondMap, simGroupMap])
  const effThirdMap  = useMemo(() => new Map(GROUP_ORDER.map(g => [g, offThirdMap.get(g)  || simThirdMap.get(g)?.team   || ''])), [offThirdMap,  simThirdMap])

  const persistGroupSim = useCallback(async (g: string, first: string, second: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase.current as any
    if (!first && !second) {
      await sb.from('user_group_simulations').delete().eq('user_id', userId).eq('group_name', g)
    } else {
      await sb.from('user_group_simulations').upsert(
        { user_id: userId, group_name: g, first_place: first || null, second_place: second || null },
        { onConflict: 'user_id,group_name' },
      )
    }
  }, [userId])

  const persistThirdSim = useCallback(async (g: string, team: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase.current as any
    if (!team) {
      await sb.from('user_third_simulations').delete().eq('user_id', userId).eq('group_name', g)
    } else {
      await sb.from('user_third_simulations').upsert(
        { user_id: userId, group_name: g, team },
        { onConflict: 'user_id,group_name' },
      )
    }
  }, [userId])

  const persistTournamentSim = useCallback(async (update: Partial<{ champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase.current as any
    const merged = { ...simTournament, ...update }
    const hasAny = Object.values(merged).some(v => !!v)
    if (!hasAny) {
      await sb.from('user_tournament_simulations').delete().eq('user_id', userId)
    } else {
      await sb.from('user_tournament_simulations').upsert(
        { user_id: userId, ...merged },
        { onConflict: 'user_id' },
      )
    }
  }, [userId, simTournament])

  // ── Gabaritar: preenche simMap com bets de um participante fonte ──────────

  const runGabaritar = useCallback(async (sourceId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase.current as any

    const entries: Array<{ matchId: string; sh: number; sa: number; isBrazil: boolean }> = []
    for (const m of matches) {
      if (m.score_home !== null) continue
      if (lockedSet.has(m.id)) continue
      const bet = betMap.get(`${sourceId}:${m.id}`)
      if (!bet) continue
      entries.push({ matchId: m.id, sh: bet.score_home, sa: bet.score_away, isBrazil: m.is_brazil })
    }
    if (entries.length) {
      setSimMap(prev => {
        const next = new Map(prev)
        for (const e of entries) next.set(e.matchId, { score_home: e.sh, score_away: e.sa })
        return next
      })
      for (const e of entries) recomputeForMatch(e.matchId, e.sh, e.sa, e.isBrazil)
      await sb.from('user_simulations').upsert(
        entries.map(e => ({ user_id: userId, match_id: e.matchId, score_home: e.sh, score_away: e.sa, updated_at: new Date().toISOString() })),
        { onConflict: 'user_id,match_id' },
      )
    }

    if (bonusIsLocked) return

    const groupEntries: Array<{ g: string; f: string; s: string }> = []
    for (const g of GROUP_ORDER) {
      if (offFirstMap.get(g)) continue
      const gb = groupBetMap.get(`${sourceId}:${g}`)
      if (!gb?.first_place) continue
      groupEntries.push({ g, f: gb.first_place, s: gb.second_place ?? '' })
    }
    if (groupEntries.length) {
      setSimGroupMap(prev => {
        const next = new Map(prev)
        for (const { g, f, s } of groupEntries) next.set(g, { first: f, second: s })
        return next
      })
      await sb.from('user_group_simulations').upsert(
        groupEntries.map(({ g, f, s }) => ({ user_id: userId, group_name: g, first_place: f || null, second_place: s || null })),
        { onConflict: 'user_id,group_name' },
      )
    }

    const thirdEntries: Array<{ g: string; team: string }> = []
    for (const g of GROUP_ORDER) {
      if (offThirdMap.get(g)) continue
      const tb = thirdBetMap.get(`${sourceId}:${g}`)
      if (!tb?.team) continue
      thirdEntries.push({ g, team: tb.team })
    }
    if (thirdEntries.length) {
      setSimThirdMap(prev => {
        const next = new Map(prev)
        for (const { g, team } of thirdEntries) next.set(g, { team })
        return next
      })
      await sb.from('user_third_simulations').upsert(
        thirdEntries.map(({ g, team }) => ({ user_id: userId, group_name: g, team })),
        { onConflict: 'user_id,group_name' },
      )
    }

    const srcTBet = tournamentBetMap.get(sourceId)
    if (srcTBet) {
      const cur = simTournament
      const eff = effectiveKnockoutResults
      const update = {
        champion:   eff.champion    !== null ? cur.champion   : (srcTBet.champion   ?? ''),
        runner_up:  eff.runnerUp    !== null ? cur.runner_up  : (srcTBet.runner_up  ?? ''),
        semi1:      eff.third       !== null ? cur.semi1      : (srcTBet.semi1      ?? ''),
        semi2:      eff.fourth      !== null ? cur.semi2      : (srcTBet.semi2      ?? ''),
        top_scorer: eff.officialScorers.length > 0 ? cur.top_scorer : (srcTBet.top_scorer ? (scorerMapping[srcTBet.top_scorer.toLowerCase().trim()] ?? srcTBet.top_scorer) : ''),
      }
      setSimTournament(update)
      await persistTournamentSim(update)
    }
  }, [matches, lockedSet, betMap, recomputeForMatch, userId,
      bonusIsLocked, groupBetMap, thirdBetMap, tournamentBetMap,
      offFirstMap, offThirdMap, simTournament, effectiveKnockoutResults, scorerMapping,
      persistTournamentSim])

  const handleGabaritar = useCallback(async () => {
    setIsGabaritando(true)
    try { await runGabaritar(activeParticipantId) }
    finally { setIsGabaritando(false) }
  }, [runGabaritar, activeParticipantId])

  const handleGabaritarDe = useCallback(async (sourceId: string) => {
    setIsGabaritandoDe(true)
    try { await runGabaritar(sourceId) }
    finally { setIsGabaritandoDe(false) }
  }, [runGabaritar])

  // ── Limpar: remove simulações de partidas sem resultado oficial ───────────

  const handleLimpar = useCallback(async () => {
    setIsLimpando(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase.current as any
      const matchIds: string[] = []
      for (const m of matches) {
        if (m.score_home !== null) continue
        if (simMap.has(m.id)) matchIds.push(m.id)
      }
      if (matchIds.length) {
        setSimMap(prev => {
          const next = new Map(prev)
          for (const mid of matchIds) next.delete(mid)
          return next
        })
        for (const mid of matchIds) resetLivePointsForMatch(mid)
        await sb.from('user_simulations').delete().eq('user_id', userId)
      }
      if (!bonusIsLocked) {
        setSimGroupMap(new Map())
        setSimThirdMap(new Map())
        setSimTournament({ champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '' })
        await Promise.all([
          sb.from('user_group_simulations').delete().eq('user_id', userId),
          sb.from('user_third_simulations').delete().eq('user_id', userId),
          sb.from('user_tournament_simulations').delete().eq('user_id', userId),
        ])
      }
    } finally {
      setIsLimpando(false)
    }
  }, [matches, simMap, userId, resetLivePointsForMatch, bonusIsLocked])

  const teamFlagMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const match of matches) {
      if (match.flag_home) m.set(match.team_home, match.flag_home)
      if (match.flag_away) m.set(match.team_away, match.flag_away)
    }
    return m
  }, [matches])

  // Computed totals (inclui livePoints de simulação)
  const computedTotals = useMemo(() => {
    const thirdPts  = rules['terceiro_classificado'] ?? 3
    const threshold = rules['percentual_zebra'] ?? 15

    // Zebra de primeiro lugar por grupo, baseado no resultado efetivo (oficial ou simulado)
    const groupEffZebras = new Set<string>()
    for (const g of GROUP_ORDER) {
      const ef1 = effFirstMap.get(g) ?? ''
      if (!ef1) continue
      const allPicks = participants
        .map(p => groupBetMap.get(`${p.id}:${g}`)?.first_place)
        .filter((x): x is string => !!x)
      if (allPicks.length > 0 && detectGroupZebra(allPicks.map(fp => ({ first_place: fp })), ef1, threshold))
        groupEffZebras.add(g)
    }

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
        if (gb?.first_place) {
          const e1 = effFirstMap.get(g) ?? ''
          const e2 = effSecondMap.get(g) ?? ''
          if (e1) {
            sum += scoreGroupBet(gb.first_place, gb.second_place, e1, e2, groupEffZebras.has(g), rules)
          }
        }
        const tb = thirdBetMap.get(`${p.id}:${g}`)
        if (tb?.team) {
          const effT = effThirdMap.get(g) ?? ''
          if (effT && tb.team === effT) sum += thirdPts
        }
      })
      const tb = tournamentBetMap.get(p.id)
      if (tb) sum += scoreTournamentBet(tb, effectiveKnockoutResults, rules, isZebraChampion, scorerMapping)
      totals[p.id] = sum
    }
    return totals
  }, [participants, matches, betMap, groupBetMap, thirdBetMap, rules, tournamentBetMap, effectiveKnockoutResults, isZebraChampion, scorerMapping, effFirstMap, effSecondMap, effThirdMap])

  const leaderId = useMemo(() => {
    let best = -Infinity, bestId = ''
    for (const p of participants) {
      const pts = computedTotals[p.id] ?? 0
      if (pts > best) { best = pts; bestId = p.id }
    }
    return bestId
  }, [participants, computedTotals])

  const hasAnyResult = useMemo(() =>
    matches.some(m => m.score_home !== null) || Object.values(computedTotals).some(v => v > 0),
  [matches, computedTotals])
  const effectiveLeaderId = hasAnyResult ? leaderId : ''

  const isActiveLeader = !!activeParticipantId && activeParticipantId === leaderId

  // Sentinel: watch column is always visible regardless of whether a participant is selected
  const WATCH_ID = '__watch__'
  const watchSentinel: Participant = { id: WATCH_ID, apelido: watchPart?.apelido ?? '' }

  const scrollable = otherParts.filter(p => p.id !== watchParticipantId)
  const displayParts: Participant[] = isActiveLeader
    ? [watchSentinel, ...scrollable]
    : (activePart ? [activePart, watchSentinel, ...scrollable] : [watchSentinel, ...scrollable])

  const displayFrozenLeft = isActiveLeader
    ? (!isMobile ? frozenTotal + 3 * STAT_COL_W + PART_COL_W : null)
    : frozenPartLeft
  const frozenWatchLeft = !isActiveLeader && frozenPartLeft !== null
    ? frozenPartLeft + PART_COL_W : null

  // ── Pre-computed stats Maps — usa effective scores (oficial ?? sim) ──────────

  const matchStatsMap = useMemo(() => {
    const m = new Map<string, EventStats>()
    for (const match of matches) {
      const effH = match.score_home ?? simMap.get(match.id)?.score_home ?? null
      const effA = match.score_away ?? simMap.get(match.id)?.score_away ?? null
      m.set(match.id, matchEventStats(match.id, effH, effA, participants, betMap))
    }
    return m
  }, [matches, betMap, participants, simMap])

  const groupIsZebraMap = useMemo(() => {
    const threshold = rules['percentual_zebra'] ?? 15
    const m = new Map<string, boolean>()
    for (const g of GROUP_ORDER) {
      const ef1 = effFirstMap.get(g) ?? ''
      const allPicks = participants.map(p => groupBetMap.get(`${p.id}:${g}`)?.first_place).filter((x): x is string => !!x)
      m.set(g, ef1.length > 0 && allPicks.length > 0 && detectGroupZebra(allPicks.map(fp => ({ first_place: fp })), ef1, threshold))
    }
    return m
  }, [effFirstMap, participants, groupBetMap, rules])

  const groupStatsMap = useMemo(() => {
    const m = new Map<string, EventStats>()
    for (const g of GROUP_ORDER) {
      const ef1 = effFirstMap.get(g) ?? ''
      const ef2 = effSecondMap.get(g) ?? ''
      m.set(g, groupEventStats(g, ef1, ef2, participants, groupBetMap, groupIsZebraMap.get(g) ?? false, rules))
    }
    return m
  }, [effFirstMap, effSecondMap, participants, groupBetMap, groupIsZebraMap, rules])

  const thirdStatsMap = useMemo(() => {
    const thirdPts = rules['terceiro_classificado'] ?? 3
    const m = new Map<string, EventStats>()
    for (const g of GROUP_ORDER)
      m.set(g, thirdEventStats(g, effThirdMap.get(g) ?? '', thirdPts, participants, thirdBetMap))
    return m
  }, [effThirdMap, participants, thirdBetMap, rules])

  const matchZebraMap = useMemo(() => {
    const threshold = rules['percentual_zebra'] ?? 15
    const possible  = new Map<string, { H: ZebraOutcome; D: ZebraOutcome; A: ZebraOutcome } | undefined>()
    const actual    = new Map<string, boolean>()
    const actualBet = new Map<string, boolean>()
    for (const m of matches) {
      const effH = m.score_home ?? simMap.get(m.id)?.score_home ?? null
      const effA = m.score_away ?? simMap.get(m.id)?.score_away ?? null
      const betsList  = collectMatchBets(m.id, participants, betMap)
      const hasResult = effH !== null && effA !== null
      possible.set(m.id, betsList.length > 0 ? {
        H: zebraOutcome(betsList, 'H', threshold),
        D: zebraOutcome(betsList, 'D', threshold),
        A: zebraOutcome(betsList, 'A', threshold),
      } : undefined)
      const isZebra = hasResult && betsList.length > 0
        ? detectMatchZebra(betsList, getMatchResult(effH!, effA!), threshold)
        : false
      actual.set(m.id, isZebra)
      if (isZebra && hasResult) {
        const res = getMatchResult(effH!, effA!)
        const countOnResult = betsList.filter(b => getMatchResult(b.score_home, b.score_away) === res).length
        actualBet.set(m.id, countOnResult > 0)
      } else {
        actualBet.set(m.id, false)
      }
    }
    return { possible, actual, actualBet }
  }, [matches, betMap, participants, rules, simMap])

  const vItems    = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const padTop    = vItems.length > 0 ? vItems[0].start : 0
  const padBot    = vItems.length > 0 ? totalSize - vItems[vItems.length - 1].end : 0
  const tableW    = frozenTotal + 3 * STAT_COL_W + (displayParts.length + 1) * PART_COL_W

  const getMatchPts = (pid: string, mid: string) => {
    const e = betMap.get(`${pid}:${mid}`)
    if (!e) return null
    return e.livePoints !== undefined ? e.livePoints : e.storedPoints
  }

  // ── Classificação simulada ─────────────────────────────────────────────────

  const classificationSorted = useMemo(() => {
    return [...participants].sort((a, b) => {
      const pa = computedTotals[a.id] ?? 0
      const pb = computedTotals[b.id] ?? 0
      if (pb !== pa) return pb - pa
      return a.apelido.localeCompare(b.apelido)
    })
  }, [participants, computedTotals])

  const officialRanking = useMemo(() => {
    if (!activeParticipantId) return 0
    const sorted = [...participants].sort((a, b) => {
      const diff = (participantTotals[b.id] ?? 0) - (participantTotals[a.id] ?? 0)
      return diff !== 0 ? diff : a.apelido.localeCompare(b.apelido)
    })
    return sorted.findIndex(p => p.id === activeParticipantId) + 1
  }, [participants, participantTotals, activeParticipantId])

  const simRanking = useMemo(() => {
    if (!activeParticipantId) return 0
    return classificationSorted.findIndex(p => p.id === activeParticipantId) + 1
  }, [classificationSorted, activeParticipantId])

  const simRanked = useMemo(() => {
    const result = classificationSorted.map((p, i) => ({
      id: p.id, apelido: p.apelido, pts: computedTotals[p.id] ?? 0, rank: i + 1,
    }))
    for (let i = 1; i < result.length; i++) {
      if (result[i].pts === result[i - 1].pts) result[i].rank = result[i - 1].rank
    }
    return result
  }, [classificationSorted, computedTotals])

  const simIsUniqueLast = useMemo(() => {
    if (simRanked.length === 0) return false
    const lastRank = simRanked[simRanked.length - 1].rank
    return simRanked.filter(r => r.rank === lastRank).length === 1
  }, [simRanked])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>

      {/* Linha 1: tabs + botões */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-white px-3 py-2 shrink-0">
        <button onClick={() => setTab('tabela')}
          className={`rounded-full px-3 py-0.5 text-[11px] font-semibold transition ${
            tab === 'tabela' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >Tabela Simulada</button>
        <button onClick={() => setTab('classificacao')}
          className={`rounded-full px-3 py-0.5 text-[11px] font-semibold transition ${
            tab === 'classificacao' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >Classificação Simulada</button>

        <div className="ml-auto flex items-center gap-1.5">
          {tab === 'tabela' && (
            <>
              <button onClick={handleGabaritar} disabled={isGabaritando || isGabaritandoDe || isLimpando}
                className="inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-60 disabled:cursor-not-allowed transition">
                {isGabaritando ? (
                  <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                ) : null}
                {isGabaritando ? 'Salvando…' : 'Gabaritar'}
              </button>
              <button onClick={() => { setGabaritarDeSelected(watchParticipantId); setGabaritarDeQuery(''); setShowGabaritarDe(true) }}
                disabled={isGabaritando || isGabaritandoDe || isLimpando}
                className="inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] font-semibold bg-violet-100 text-violet-800 hover:bg-violet-200 disabled:opacity-60 disabled:cursor-not-allowed transition">
                {isGabaritandoDe ? (
                  <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                ) : null}
                {isGabaritandoDe ? 'Salvando…' : 'Gabaritar de…'}
              </button>
              <button onClick={handleLimpar} disabled={isGabaritando || isGabaritandoDe || isLimpando}
                className="inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-60 disabled:cursor-not-allowed transition">
                {isLimpando ? (
                  <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                  </svg>
                ) : null}
                {isLimpando ? 'Limpando…' : 'Limpar'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Linha 2: filtro de fase (só na aba Tabela) */}
      {tab === 'tabela' && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 bg-white px-3 py-1.5 shrink-0">
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
      )}

      {/* Indicador modo simulação */}
      <div className="shrink-0 border-b border-amber-100 bg-amber-50 px-3 py-1 text-center text-[10px] font-medium text-amber-700">
        🎮 Modo Simulação — placares editáveis · oficiais preenchidos automaticamente
      </div>

      {/* Destaque da pontuação/classificação do participante logado */}
      {activeParticipantId && (
        <div className="shrink-0 border-b border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 px-3 py-2">
          <div className="flex items-center justify-center gap-2 sm:gap-6">
            {/* Resultado oficial */}
            <div className="flex flex-col items-center min-w-[80px]">
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Resultado Oficial</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                {officialRanking > 0 && (
                  <span className="text-[15px] font-black text-gray-500">#{officialRanking}</span>
                )}
                <span className="text-[15px] font-black text-gray-700">
                  {participantTotals[activeParticipantId] ?? 0}
                  <span className="text-[10px] font-semibold text-gray-400 ml-0.5">pts</span>
                </span>
              </div>
            </div>

            <span className="text-gray-300 text-xl font-light select-none">→</span>

            {/* Com simulação */}
            <div className="flex flex-col items-center min-w-[80px]">
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">Com Simulação</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                {simRanking > 0 && (() => {
                  const up   = simRanking < officialRanking
                  const down = simRanking > officialRanking
                  return (
                    <span className={`text-[15px] font-black ${up ? 'text-emerald-600' : down ? 'text-rose-500' : 'text-amber-700'}`}>
                      #{simRanking}{up ? ' ↑' : down ? ' ↓' : ''}
                    </span>
                  )
                })()}
                <span className="text-[15px] font-black text-amber-800">
                  {computedTotals[activeParticipantId] ?? 0}
                  <span className="text-[10px] font-semibold text-amber-500 ml-0.5">pts</span>
                </span>
                {(() => {
                  const diff = (computedTotals[activeParticipantId] ?? 0) - (participantTotals[activeParticipantId] ?? 0)
                  if (!diff) return null
                  return (
                    <span className={`text-[11px] font-semibold rounded px-1 py-px ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Aba Classificação ──────────────────────────────────────────────── */}
      {tab === 'classificacao' && (
        <div className="flex-1 overflow-auto p-4">
          <SimCompactRanking
            ranked={simRanked}
            premioSpots={premioSpots}
            isUniqueLast={simIsUniqueLast}
            activeParticipantId={activeParticipantId}
          />

          <div className="mb-3">
            <p className="text-base font-black text-gray-800">Classificação Simulada</p>
            <p className="text-xs text-gray-400">Detalhamento por parcela de pontos</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-x-auto mb-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ background: '#1f2937' }}>
                  <th className="text-center px-2 py-2 text-[11px] font-semibold text-gray-300 w-8">#</th>
                  <th className="text-left px-2 py-2 text-[11px] font-semibold text-gray-300">Participante</th>
                  <th className="text-center px-2 py-2 text-[11px] font-semibold text-gray-300">PTS Oficial</th>
                  <th className="text-center px-2 py-2 text-[11px] font-semibold text-amber-300">+ Sim</th>
                  <th className="text-center px-2 py-2 text-[11px] font-semibold text-gray-200">= Total</th>
                </tr>
              </thead>
              <tbody>
                {classificationSorted.map((p, idx) => {
                  const ptsOfficial = participantTotals[p.id] ?? 0
                  const ptsTotal    = computedTotals[p.id] ?? 0
                  const ptsSim      = ptsTotal - ptsOfficial
                  const isMe        = p.id === activeParticipantId
                  return (
                    <tr key={p.id} className={isMe ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="text-center px-2 py-2 text-[11px] text-gray-400">{idx + 1}</td>
                      <td className={`text-left px-2 py-2 text-[11px] font-semibold ${isMe ? 'text-amber-800' : 'text-gray-800'}`}>{p.apelido}</td>
                      <td className="text-center px-2 py-2 text-[11px] text-gray-600">{ptsOfficial > 0 ? ptsOfficial : '–'}</td>
                      <td className={`text-center px-2 py-2 text-[11px] font-bold ${ptsSim > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {ptsSim > 0 ? `+${ptsSim}` : ptsSim === 0 ? '–' : ptsSim}
                      </td>
                      <td className={`text-center px-2 py-2 text-[11px] font-bold ${ptsTotal > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {ptsTotal > 0 ? ptsTotal : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Aba Tabela (Matrix) ────────────────────────────────────────────── */}
      {tab === 'tabela' && (
        <div ref={containerRef} className="flex-1 overflow-auto" style={{ WebkitOverflowScrolling: 'touch' as const }}>
          <table className="border-collapse" style={{ width: tableW, tableLayout: 'fixed', fontSize: 11 }}>
            <colgroup>
              <col style={{ width: colDateW }} />
              <col style={{ width: colTeamsW }} />
              <col style={{ width: COL_SCORE_W }} />
              <col style={{ width: STAT_COL_W }} />
              <col style={{ width: STAT_COL_W }} />
              <col style={{ width: STAT_COL_W }} />
              <col style={{ width: PART_COL_W }} />
              {displayParts.map(p => <col key={p.id} style={{ width: PART_COL_W }} />)}
            </colgroup>

            {/* Header */}
            <thead>
              <tr style={{ height: 48, background: '#1f2937' }}>
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-center text-gray-300 font-semibold text-[10px]">Data</th>
                <th style={{ position: 'sticky', top: 0, left: colTeamsLeft, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-left px-1.5 text-gray-300 font-semibold">Jogo</th>
                <th style={{ position: 'sticky', top: 0, left: colScoreLeft, zIndex: 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-center text-amber-300 font-semibold">Sim.</th>
                <th title="Pontuaram — acertaram ao menos o vencedor do evento" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Pontuou</th>
                <th title="Cravaram — acertaram o placar exato" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Cravou</th>
                <th title="Média de pontos dos participantes" style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + 2 * STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '1px solid #374151' }}
                  className="text-center text-[9px] font-semibold text-gray-400 px-0.5">Méd.</th>
                <th style={{ position: 'sticky', top: 0, ...(isMobile ? {} : { left: frozenTotal + 3 * STAT_COL_W }), zIndex: isMobile ? 40 : 50, background: '#1f2937', borderRight: '2px solid #6b7280' }}
                  className="text-center px-0.5">
                  <div className="flex items-center justify-center gap-0.5">
                    <span className="text-[9px] leading-none">🥇</span>
                    <span className="line-clamp-2 break-words font-semibold text-[9px] text-gray-300" style={{ maxWidth: PART_COL_W - 18 }}>
                      {participants.find(p => p.id === effectiveLeaderId)?.apelido ?? 'Líder'}
                    </span>
                  </div>
                  <span className="block text-[11px] font-semibold text-gray-500">
                    {effectiveLeaderId && (computedTotals[effectiveLeaderId] ?? 0) > 0 ? computedTotals[effectiveLeaderId] : '–'}
                  </span>
                </th>
                {displayParts.map((p, idx) => {
                  const isMe = p.id === activeParticipantId
                  const isWatch = p.id === WATCH_ID
                  const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                  const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                  const isFrozen = isActiveFrozen || isWatchFrozen
                  const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                  const displayId = isWatch ? (watchPart?.id ?? null) : p.id
                  const total = displayId ? (computedTotals[displayId] ?? 0) : 0
                  if (isWatch) {
                    return (
                      <th key={p.id}
                        title={watchPart ? `Acompanhando: ${watchPart.apelido} — clique para alterar` : 'Clique para acompanhar'}
                        style={{
                          position: 'sticky', top: 0,
                          left: isFrozen ? frozenLeft : undefined, borderLeft: isFrozen ? '2px solid #7c3aed' : undefined,
                          zIndex: 50, background: '#2e1065',
                          borderRight: '1px solid #374151', cursor: 'pointer',
                        }}
                        className="text-center px-0.5 text-violet-200"
                        onClick={() => { setWatchQuery(''); setShowWatchSelector(true) }}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          <span className="text-[9px] leading-none">👁</span>
                          <span className="line-clamp-2 break-words font-semibold text-[9px]" style={{ maxWidth: PART_COL_W - 14 }}>
                            {watchPart?.apelido ?? 'Acomp.'}
                          </span>
                        </div>
                        <span className="block text-[11px] font-semibold text-violet-400">
                          {total > 0 ? total : '–'}
                        </span>
                      </th>
                    )
                  }
                  return (
                    <th key={p.id} title={p.apelido}
                      style={{
                        position: 'sticky', top: 0,
                        ...(isFrozen ? { left: frozenLeft, borderLeft: '2px solid #6b7280' } : {}),
                        zIndex: isFrozen ? 50 : 40,
                        background: isMe ? '#14532d' : '#1f2937',
                        borderRight: '1px solid #374151',
                      }}
                      className={`text-center px-0.5 ${isMe ? 'text-verde-200' : 'text-gray-300'}`}
                    >
                      <div className="flex items-center justify-center gap-0.5">
                        {p.id === effectiveLeaderId && <span className="text-[9px] leading-none">🥇</span>}
                        <span className="line-clamp-2 break-words font-semibold" style={{ maxWidth: PART_COL_W - (p.id === effectiveLeaderId ? 16 : 4) }}>{p.apelido}</span>
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
                const bg  = odd ? '#e5e7eb' : '#ffffff'

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
                  const of1  = offFirstMap.get(g) ?? ''
                  const of2  = offSecondMap.get(g) ?? ''
                  const ef1  = effFirstMap.get(g)  ?? ''
                  const ef2  = effSecondMap.get(g) ?? ''
                  return (
                    <tr key={`gb-${g}`} style={{ height: ROW_H_BONUS, background: '#eff6ff' }}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                        className="text-center font-bold text-blue-700 text-xs">{g}</td>
                      <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                        className="px-1.5 text-[10px] font-semibold text-blue-600">
                        {isMobile ? (
                          <div className="leading-none flex flex-col gap-0.5">
                            {of1 ? (
                              <div className="flex items-center gap-1 w-full">
                                <Flag code={teamFlagMap.get(of1) ?? ''} size="sm" className="shrink-0 w-4 h-3 rounded-[1px]" />
                                <span className="font-bold text-[10px]">{teamAbbrs[of1] ?? abbr(of1, 4)}</span>
                                {groupActualZebras.has(g) && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src="/zebra.png" alt="🦓" width={18} height={18} className="shrink-0 object-contain ml-auto" />
                                )}
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
                            <div className="flex items-center gap-1 w-full" style={{ maxWidth: colTeamsW - 8 }}>
                              <span className="truncate">🥇 {of1 || '–'}</span>
                              {groupActualZebras.has(g) && of1 && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src="/zebra.png" alt="🦓" width={24} height={24} className="shrink-0 object-contain ml-auto" />
                              )}
                            </div>
                            <span className="block truncate" style={{ maxWidth: colTeamsW - 8 }}>🥈 {of2 || '–'}</span>
                          </div>
                        )}
                      </td>
                      <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#eff6ff', borderRight: '1px solid #bfdbfe' }}
                        className="text-center px-0.5">
                        {of1 ? (
                          <span className="text-[10px] font-semibold text-blue-800">{`Gr. ${g}`}</span>
                        ) : !bonusIsLocked ? (
                          <div className="flex flex-col gap-0.5">
                            <select value={simGroupMap.get(g)?.first ?? ''}
                              onChange={e => { const v = e.target.value; setSimGroupMap(prev => new Map(prev).set(g, { first: v, second: simGroupMap.get(g)?.second ?? '' })); persistGroupSim(g, v, simGroupMap.get(g)?.second ?? '') }}
                              className="w-full rounded border border-amber-200 bg-amber-50 text-[9px] px-0.5 py-px text-gray-700 focus:outline-none">
                              <option value="">1º?</option>
                              {(teamsByGroup.get(g) ?? []).map(t => <option key={t.name} value={t.name}>{teamAbbrs[t.name] ?? abbr(t.name, 5)}</option>)}
                            </select>
                            <select value={simGroupMap.get(g)?.second ?? ''}
                              onChange={e => { const v = e.target.value; setSimGroupMap(prev => new Map(prev).set(g, { first: simGroupMap.get(g)?.first ?? '', second: v })); persistGroupSim(g, simGroupMap.get(g)?.first ?? '', v) }}
                              className="w-full rounded border border-amber-200 bg-amber-50 text-[9px] px-0.5 py-px text-gray-700 focus:outline-none">
                              <option value="">2º?</option>
                              {(teamsByGroup.get(g) ?? []).map(t => <option key={t.name} value={t.name}>{teamAbbrs[t.name] ?? abbr(t.name, 5)}</option>)}
                            </select>
                          </div>
                        ) : (
                          <span className="text-gray-300 text-[10px]">–</span>
                        )}
                      </td>
                      {/* Colunas de stats */}
                      {(() => {
                        const stats  = groupStatsMap.get(g) ?? { pontuaram: 0, cravaram: 0, media: 0 }
                        const lb     = groupBetMap.get(`${effectiveLeaderId}:${g}`)
                        const lbKind = groupCellKind(lb, ef1, ef2)
                        const lbBg   = CELL_KIND_BG_HEX[lbKind] || '#eff6ff'
                        const media  = stats.media > 0 ? stats.media.toFixed(1) : '—'
                        const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#eff6ff' } : {}
                        return (<>
                          <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-blue-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                          <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-blue-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                          <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #93c5fd' } : {}) }} className="border-r border-blue-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                          <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                            className={`border-r border-blue-50 text-center ${isMobile ? CELL_BG[lbKind] : ''}`}>
                            {lb?.first_place ? (() => {
                              const isZebra1 = groupIsZebraMap.get(g) ?? false
                              const lbPts = lb.points !== null
                                ? lb.points
                                : ef1 ? scoreGroupBet(lb.first_place, lb.second_place, ef1, ef2, isZebra1, rules) : null
                              return (
                                <div className="flex flex-col items-center leading-none gap-px">
                                  <div className="flex items-center gap-px overflow-hidden" style={{ maxWidth: STAT_COL_W - 4 }}>
                                    <span className={`text-[9px] font-medium shrink-0 ${groupPotentialZebraTeams.get(g)?.has(lb.first_place) ? 'bg-gray-900 text-white rounded px-0.5' : 'text-gray-600'}`}>
                                      {teamAbbrs[lb.first_place] ?? abbr(lb.first_place, 4)}
                                    </span>
                                    <span className="text-[9px] text-gray-400 shrink-0">/</span>
                                    <span className="text-[9px] text-gray-600 truncate font-medium">
                                      {teamAbbrs[lb.second_place] ?? abbr(lb.second_place, 4)}
                                    </span>
                                  </div>
                                  {lbPts !== null && (
                                    <span className={`text-[10px] font-bold ${lbPts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                      {lbPts > 0 ? `+${lbPts}` : '0'}
                                    </span>
                                  )}
                                </div>
                              )
                            })() : <span className="text-gray-200">—</span>}
                          </td>
                        </>)
                      })()}
                      {displayParts.map((p, idx) => {
                        const isWatch = p.id === WATCH_ID
                        const dataId = isWatch ? watchPart?.id ?? null : p.id
                        const isMe = p.id === activeParticipantId
                        const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                        const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                        const isFrozen = isActiveFrozen || isWatchFrozen
                        const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                        if (isWatch && !dataId) return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: '#eff6ff', borderLeft: '2px solid #7c3aed' } : undefined}
                            className="border-r border-violet-100 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        const bet  = groupBetMap.get(`${dataId!}:${g}`)
                        const kind = groupCellKind(bet, ef1, ef2)
                        const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || '#eff6ff') : undefined
                        return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: frozenBg, borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #bfdbfe' } : undefined}
                            className={`border-r border-blue-50 text-center ${!isFrozen ? CELL_BG[kind] : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                            {bet?.first_place ? (() => {
                              const isZebra1 = groupIsZebraMap.get(g) ?? false
                              const pts = bet.points !== null
                                ? bet.points
                                : ef1 ? scoreGroupBet(bet.first_place, bet.second_place, ef1, ef2, isZebra1, rules) : null
                              return (
                                <div className="flex flex-col items-center leading-none gap-px">
                                  <div className="flex items-center gap-px overflow-hidden" style={{ maxWidth: PART_COL_W - 4 }}>
                                    <span className={`text-[9px] font-medium shrink-0 ${groupPotentialZebraTeams.get(g)?.has(bet.first_place) ? 'bg-gray-900 text-white rounded px-0.5' : 'text-gray-600'}`}>
                                      {teamAbbrs[bet.first_place] ?? abbr(bet.first_place, 5)}
                                    </span>
                                    <span className="text-[9px] text-gray-400 shrink-0">/</span>
                                    <span className="text-[9px] text-gray-600 truncate font-medium">
                                      {teamAbbrs[bet.second_place] ?? abbr(bet.second_place, 5)}
                                    </span>
                                  </div>
                                  {pts !== null && (
                                    <span className={`text-[10px] font-bold ${pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                      {pts > 0 ? `+${pts}` : '0'}
                                    </span>
                                  )}
                                </div>
                              )
                            })() : bonusIsLocked && p.id !== activeParticipantId
                              ? <span className="text-gray-300 text-[10px]" title="Prazo em aberto">🔒</span>
                              : <span className="text-gray-200">—</span>
                            }
                          </td>
                        )
                      })}
                    </tr>
                  )
                }

                // ── Third bet row ───────────────────────────────────────────────
                if (row.kind === 'third_bet') {
                  const g  = row.groupName
                  const ot = offThirdMap.get(g) ?? ''
                  const et = effThirdMap.get(g) ?? ''
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
                        className="text-center px-0.5">
                        {ot ? (
                          <span className="text-[10px] text-violet-600 font-semibold">{`Gr. ${g}`}</span>
                        ) : !bonusIsLocked ? (
                          <select value={simThirdMap.get(g)?.team ?? ''}
                            onChange={e => { const v = e.target.value; setSimThirdMap(prev => new Map(prev).set(g, { team: v })); persistThirdSim(g, v) }}
                            className="w-full rounded border border-amber-200 bg-amber-50 text-[9px] px-0.5 py-px text-gray-700 focus:outline-none">
                            <option value="">3º?</option>
                            {(teamsByGroup.get(g) ?? []).map(t => <option key={t.name} value={t.name}>{teamAbbrs[t.name] ?? abbr(t.name, 5)}</option>)}
                          </select>
                        ) : (
                          <span className="text-gray-300 text-[10px]">–</span>
                        )}
                      </td>
                      {/* Colunas de stats */}
                      {(() => {
                        const thirdPts = rules['terceiro_classificado'] ?? 3
                        const stats    = thirdStatsMap.get(g) ?? { pontuaram: 0, cravaram: 0, media: 0 }
                        const lb       = thirdBetMap.get(`${effectiveLeaderId}:${g}`)
                        const lbKind   = thirdCellKind(lb?.team, et)
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
                      {displayParts.map((p, idx) => {
                        const isWatch = p.id === WATCH_ID
                        const dataId = isWatch ? watchPart?.id ?? null : p.id
                        const isMe = p.id === activeParticipantId
                        const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                        const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                        const isFrozen = isActiveFrozen || isWatchFrozen
                        const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                        if (isWatch && !dataId) return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: '#faf5ff', borderLeft: '2px solid #7c3aed' } : undefined}
                            className="border-r border-violet-100 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        const bet  = thirdBetMap.get(`${dataId!}:${g}`)
                        const kind = thirdCellKind(bet?.team, et)
                        const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || '#faf5ff') : undefined
                        return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: frozenBg, borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #e9d5ff' } : undefined}
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
                            ) : bonusIsLocked && dataId !== activeParticipantId
                              ? <span className="text-gray-300 text-[10px]" title="Prazo em aberto">🔒</span>
                              : <span className="text-gray-200">—</span>
                            }
                          </td>
                        )
                      })}
                    </tr>
                  )
                }

                // ── G4 field rows ───────────────────────────────────────────────
                if (row.kind === 'g4_field') {
                  const field = row.field
                  const a = (name: string) => teamAbbrs[name] ?? abbr(name, 4)
                  const LABELS: Record<typeof field, string> = { champion: '🏆', runner_up: '🥈', semi1: '3º', semi2: '4º' }
                  const FULL:   Record<typeof field, string> = { champion: '🏆 Campeão', runner_up: '🥈 Vice', semi1: '3º Lugar', semi2: '4º Lugar' }
                  const official = field === 'champion' ? effectiveKnockoutResults.champion : field === 'runner_up' ? effectiveKnockoutResults.runnerUp : field === 'semi1' ? effectiveKnockoutResults.third : effectiveKnockoutResults.fourth
                  const officialIsReal = field === 'champion' ? knockoutResults.champion !== null : field === 'runner_up' ? knockoutResults.runnerUp !== null : field === 'semi1' ? knockoutResults.third !== null : knockoutResults.fourth !== null
                  const stats = g4FieldStats(field, participants, tournamentBetMap, effectiveKnockoutResults, rules, isZebraChampion)
                  const lb = tournamentBetMap.get(effectiveLeaderId)
                  const lbVal = lb?.[field] ?? ''
                  const lbPts = lbVal ? scoreG4FieldBet(field, lbVal, effectiveKnockoutResults, rules, isZebraChampion) : null
                  const lbBg  = lbPts !== null ? (lbPts > 0 ? '#d1fae5' : '#fff1f2') : '#fffbeb'
                  const media = stats.media > 0 ? stats.media.toFixed(1) : '—'
                  const s0 = !isMobile ? { position: 'sticky' as const, zIndex: 20, background: '#fffbeb' } : {}
                  return (
                    <tr key={`g4_field_${field}`} style={{ height: ROW_H_BONUS, background: '#fffbeb' }}>
                      <td style={{ position: 'sticky', left: 0, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                        className="text-center text-[10px] font-bold text-amber-700">{LABELS[field]}</td>
                      <td style={{ position: 'sticky', left: colTeamsLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                        className="px-1.5 text-[10px] text-amber-800 font-semibold">
                        <div className="flex items-center gap-1 overflow-hidden w-full" style={{ maxWidth: colTeamsW - 8 }}>
                          {official ? (
                            <>
                              <span className="truncate">{a(official)}</span>
                              {field === 'champion' && isZebraChampion && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src="/zebra.png" alt="🦓" width={isMobile ? 18 : 24} height={isMobile ? 18 : 24} className="shrink-0 object-contain ml-auto" />
                              )}
                            </>
                          ) : <span className="text-gray-300">–</span>}
                        </div>
                      </td>
                      <td style={{ position: 'sticky', left: colScoreLeft, zIndex: 30, background: '#fffbeb', borderRight: '1px solid #fde68a' }}
                        className="text-center text-[9px] text-amber-600 font-semibold px-0.5 leading-tight">
                        {officialIsReal ? (
                          <span>{FULL[field].replace(/^[^\s]+ /, '')}</span>
                        ) : !bonusIsLocked ? (
                          <select
                            value={simTournament[field === 'champion' ? 'champion' : field === 'runner_up' ? 'runner_up' : field === 'semi1' ? 'semi1' : 'semi2']}
                            onChange={e => {
                              const v = e.target.value
                              const key = field === 'champion' ? 'champion' : field === 'runner_up' ? 'runner_up' : field === 'semi1' ? 'semi1' : 'semi2'
                              const update = { ...simTournament, [key]: v }
                              setSimTournament(update)
                              persistTournamentSim({ [key]: v })
                            }}
                            className="w-full rounded border border-amber-200 bg-amber-50 text-[9px] px-0.5 py-px text-gray-700 focus:outline-none">
                            <option value="">?</option>
                            {allTeams.map(t => <option key={t.name} value={t.name}>{teamAbbrs[t.name] ?? abbr(t.name, 5)}</option>)}
                          </select>
                        ) : (
                          <span className="text-gray-300">–</span>
                        )}
                      </td>
                      {/* Stats */}
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.pontuaram > 0 ? <span className="font-bold text-gray-700">{stats.pontuaram}</span> : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + STAT_COL_W } : {}) }} className="border-r border-amber-50 text-center text-[10px]">{stats.cravaram > 0 ? <span className="font-bold text-emerald-600">{stats.cravaram}</span> : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 2 * STAT_COL_W, borderRight: '2px solid #fde68a' } : {}) }} className="border-r border-amber-50 text-center text-[10px] text-gray-500">{stats.media > 0 ? media : <span className="text-gray-300">–</span>}</td>
                      <td style={{ ...s0, ...(!isMobile ? { left: frozenTotal + 3 * STAT_COL_W, background: lbBg } : {}) }}
                        className={`border-r border-amber-50 text-center ${isMobile ? (lbPts !== null ? (lbPts > 0 ? 'bg-emerald-100' : 'bg-rose-50') : '') : ''}`}>
                        {lbVal ? (
                          <div className="flex flex-col items-center leading-none gap-px">
                            <span className={`text-[9px] font-medium truncate ${field === 'champion' && potentialZebraChampions.has(lbVal) ? 'bg-gray-900 text-white rounded px-0.5' : 'text-gray-700'}`} style={{ maxWidth: STAT_COL_W - 4 }}>{a(lbVal)}</span>
                            {lbPts !== null && <span className={`text-[10px] font-bold ${lbPts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{lbPts > 0 ? `+${lbPts}` : '0'}</span>}
                          </div>
                        ) : <span className="text-gray-200">—</span>}
                      </td>
                      {/* Participant cells */}
                      {displayParts.map((p, idx) => {
                        const isWatch = p.id === WATCH_ID
                        const dataId = isWatch ? watchPart?.id ?? null : p.id
                        const isMe = p.id === activeParticipantId
                        const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                        const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                        const isFrozen = isActiveFrozen || isWatchFrozen
                        const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                        if (isWatch && !dataId) return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: '#fffbeb', borderLeft: '2px solid #7c3aed' } : { background: '#fffbeb' }}
                            className="border-r border-amber-50 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        const bet = tournamentBetMap.get(dataId!)
                        const betVal = bet?.[field] ?? ''
                        const pts = betVal ? scoreG4FieldBet(field, betVal, effectiveKnockoutResults, rules, isZebraChampion) : null
                        const isExact = !!betVal && !!official && betVal === official
                        const isPartial = pts !== null && pts > 0 && !isExact
                        const isWrong = pts !== null && pts === 0
                        const cellBg = !isMobile ? '#fffbeb' : undefined
                        const frozenBg = isExact ? '#d1fae5' : isPartial ? '#e0f2fe' : isWrong ? '#fff1f2' : '#fffbeb'
                        return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: frozenBg, borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #fde68a' } : { background: cellBg }}
                            className={`border-r border-amber-50 text-center ${isExact ? 'bg-emerald-100' : isPartial ? 'bg-sky-100' : isWrong ? 'bg-rose-50' : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                            {betVal ? (
                              <div className="flex flex-col items-center leading-none gap-px">
                                <span className={`text-[9px] font-medium truncate ${field === 'champion' && potentialZebraChampions.has(betVal) ? 'bg-gray-900 text-white rounded px-0.5' : 'text-gray-700'}`} style={{ maxWidth: PART_COL_W - 4 }}>{a(betVal)}</span>
                                {pts !== null && <span className={`text-[10px] font-bold ${pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{pts > 0 ? `+${pts}` : '0'}</span>}
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
                  const artilhPts  = rules['artilheiro'] ?? 18
                  const effectiveScorers = effectiveKnockoutResults.officialScorers
                  const officialNames = officialTopScorers.join(', ')
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
                        className="text-center px-0.5 text-[9px] text-amber-600 font-semibold">
                        {officialTopScorers.length > 0 ? (
                          <span>Art.</span>
                        ) : !bonusIsLocked ? (
                          allBettedScorers.length > 0 ? (
                            <select multiple size={5}
                              value={simTournament.top_scorer ? simTournament.top_scorer.split('|').filter(Boolean) : []}
                              onChange={e => {
                                const selected = Array.from(e.target.selectedOptions).map(o => o.value)
                                const v = selected.join('|')
                                setSimTournament(prev => ({ ...prev, top_scorer: v }))
                                persistTournamentSim({ top_scorer: v })
                              }}
                              className="w-full rounded border border-amber-200 bg-amber-50 text-[8px] text-gray-700 focus:outline-none"
                            >
                              {allBettedScorers.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <span className="text-[8px] text-gray-400">sem apostas</span>
                          )
                        ) : (
                          <span className="text-gray-300">–</span>
                        )}
                      </td>
                      {/* Colunas de stats */}
                      {(() => {
                        const stats     = scorerEventStats(participants, tournamentBetMap, effectiveScorers, artilhPts, scorerMapping)
                        const lb        = tournamentBetMap.get(effectiveLeaderId)
                        const rawLb     = lb?.top_scorer ?? ''
                        const lbDisplay = rawLb ? (scorerMapping[rawLb.toLowerCase().trim()] ?? rawLb) : ''
                        const lbCorrect = lbDisplay.length > 0 && effectiveScorers.length > 0
                          && effectiveScorers.some(s => s.trim().toLowerCase() === lbDisplay.trim().toLowerCase())
                        const lbPts     = effectiveScorers.length > 0 && lbDisplay ? (lbCorrect ? artilhPts : 0) : null
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
                      {displayParts.map((p, idx) => {
                        const isWatch = p.id === WATCH_ID
                        const dataId = isWatch ? watchPart?.id ?? null : p.id
                        const isMe = p.id === activeParticipantId
                        const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                        const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                        const isFrozen = isActiveFrozen || isWatchFrozen
                        const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                        if (isWatch && !dataId) return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: '#fffbeb', borderLeft: '2px solid #7c3aed' } : undefined}
                            className="border-r border-amber-50 text-center">
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        const bet  = tournamentBetMap.get(dataId!)
                        if (!bet?.top_scorer) return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: '#fffbeb', borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #fde68a' } : undefined}
                            className={`border-r border-amber-50 text-center ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                            <span className="text-gray-200">—</span>
                          </td>
                        )
                        const displayName = scorerMapping[bet.top_scorer.toLowerCase().trim()] ?? bet.top_scorer
                        const norm      = displayName.trim().toLowerCase()
                        const isCorrect = effectiveScorers.length > 0 && effectiveScorers.some(s => s.trim().toLowerCase() === norm)
                        const pts       = effectiveScorers.length > 0 ? (isCorrect ? artilhPts : 0) : null
                        return (
                          <td key={p.id}
                            style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: isCorrect ? '#d1fae5' : pts !== null ? '#fff1f2' : '#fffbeb', borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #fde68a' } : undefined}
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
                const effH           = match.score_home ?? simMap.get(match.id)?.score_home ?? null
                const effA           = match.score_away ?? simMap.get(match.id)?.score_away ?? null
                const possibleZebras  = matchZebraMap.possible.get(match.id)
                const isActualZebra  = matchZebraMap.actual.get(match.id) ?? false
                const isActualZebraBet = matchZebraMap.actualBet.get(match.id) ?? false
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
                      <SimScoreInput
                        match={match}
                        canEdit={canEdit(match)}
                        possibleZebras={possibleZebras}
                        isActualZebra={isActualZebra}
                        isActualZebraBet={isActualZebraBet}
                        simScore={simMap.get(match.id)}
                        onSaved={(sh, sa) => {
                          if (sh === null) {
                            setSimMap(prev => { const next = new Map(prev); next.delete(match.id); return next })
                            resetLivePointsForMatch(match.id)
                            persistSimScore(match.id, null, null)
                          } else {
                            setSimMap(prev => new Map(prev).set(match.id, { score_home: sh, score_away: sa! }))
                            recomputeForMatch(match.id, sh, sa!, match.is_brazil)
                            persistSimScore(match.id, sh, sa)
                          }
                        }}
                      />
                    </td>
                    {/* Colunas de stats */}
                    {(() => {
                      const stats  = matchStatsMap.get(match.id) ?? { pontuaram: 0, cravaram: 0, media: 0 }
                      const lb     = betMap.get(`${effectiveLeaderId}:${match.id}`)
                      const lbKind = matchCellKind(lb, effH, effA)
                      const lbPts  = getMatchPts(effectiveLeaderId, match.id)
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
                    {displayParts.map((p, idx) => {
                      const isWatch = p.id === WATCH_ID
                      const dataId = isWatch ? watchPart?.id ?? null : p.id
                      const isMe = p.id === activeParticipantId
                      const isActiveFrozen = displayFrozenLeft !== null && idx === 0
                      const isWatchFrozen  = isWatch && !isActiveFrozen && frozenWatchLeft !== null
                      const isFrozen = isActiveFrozen || isWatchFrozen
                      const frozenLeft = isWatchFrozen ? frozenWatchLeft! : displayFrozenLeft!
                      if (isWatch && !dataId) return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: bg, borderLeft: '2px solid #7c3aed' } : undefined}
                          className="border-r border-violet-100 text-center">
                          <span className="text-gray-200">—</span>
                        </td>
                      )
                      const key  = `${dataId!}:${match.id}`
                      const bet  = betMap.get(key)
                      const kind = matchCellKind(bet, effH, effA)
                      const pts  = getMatchPts(dataId!, match.id)
                      const frozenBg = isFrozen ? (CELL_KIND_BG_HEX[kind] || bg) : undefined
                      const betOutcome = bet ? getMatchResult(bet.score_home, bet.score_away) : null
                      const isPotentialZebra = betOutcome !== null && !!possibleZebras?.[betOutcome]
                      return (
                        <td key={p.id}
                          style={isFrozen ? { position: 'sticky', left: frozenLeft, zIndex: 20, background: frozenBg, borderLeft: isWatch ? '2px solid #7c3aed' : '2px solid #d1d5db' } : undefined}
                          className={`border-r border-gray-100 text-center ${!isFrozen ? CELL_BG[kind] : ''} ${isMe ? 'ring-inset ring-1 ring-verde-300' : ''}`}>
                          {bet ? (
                            <div className="flex flex-col items-center leading-none gap-px">
                              <span className={`tabular-nums font-semibold rounded px-0.5 ${isPotentialZebra ? 'bg-gray-900 text-white' : 'text-gray-700'}`}>
                                {bet.score_home}–{bet.score_away}
                              </span>
                              {pts !== null && (
                                <span className={`tabular-nums font-bold ${pts > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                                  {pts > 0 ? `+${pts}` : '0'}
                                </span>
                              )}
                            </div>
                          ) : lockedSet.has(match.id) && dataId !== activeParticipantId
                            ? <span className="text-gray-300 text-[10px]" title="Prazo em aberto">🔒</span>
                            : <span className="text-gray-200">—</span>
                          }
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
      )}

      {/* Legend (só na aba Tabela) */}
      {tab === 'tabela' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 bg-white px-3 py-1.5 text-[10px] text-gray-400 shrink-0">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" />Cravada</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-sky-100" />Vencedor/Parcial</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-rose-50 border border-rose-200" />Errou</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-900" />Zebra apostada (≤15%)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-gray-500" />Zebra sem aposta</span>
        </div>
      )}

      {/* Modal: Selecionar participante para acompanhar */}
      {showWatchSelector && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowWatchSelector(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: '70vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="font-semibold text-gray-800">Acompanhar participante</span>
              <button onClick={() => setShowWatchSelector(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-4 pb-2">
              <input
                autoFocus
                type="text"
                placeholder="Buscar por nome…"
                value={watchQuery}
                onChange={e => setWatchQuery(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-violet-500"
              />
            </div>
            <div className="overflow-y-auto flex-1 px-4 pb-2">
              {watchParticipantId && (
                <button
                  onClick={() => { saveWatchPart(null); setShowWatchSelector(false) }}
                  className="w-full text-left px-3 py-2 mb-1 rounded-lg text-[12px] text-rose-600 hover:bg-rose-50 font-medium transition">
                  Remover acompanhamento
                </button>
              )}
              {participants
                .filter(p => p.id !== activeParticipantId && p.apelido.toLowerCase().includes(watchQuery.toLowerCase()))
                .map(p => (
                  <button key={p.id}
                    onClick={() => { saveWatchPart(p.id); setShowWatchSelector(false) }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition flex items-center gap-2 ${
                      p.id === watchParticipantId ? 'bg-violet-100 text-violet-800 font-semibold' : 'hover:bg-gray-100 text-gray-700'
                    }`}>
                    {p.id === watchParticipantId && <span className="text-[11px]">👁</span>}
                    {p.apelido}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Gabaritar de… */}
      {showGabaritarDe && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowGabaritarDe(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col" style={{ maxHeight: '70vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="font-semibold text-gray-800">Gabaritar de…</span>
              <button onClick={() => setShowGabaritarDe(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-4 pb-2">
              <input
                autoFocus
                type="text"
                placeholder="Buscar por nome…"
                value={gabaritarDeQuery}
                onChange={e => setGabaritarDeQuery(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-violet-500"
              />
            </div>
            <div className="overflow-y-auto flex-1 px-4">
              {participants
                .filter(p => p.id !== activeParticipantId && p.apelido.toLowerCase().includes(gabaritarDeQuery.toLowerCase()))
                .map(p => (
                  <button key={p.id}
                    onClick={() => setGabaritarDeSelected(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-[13px] transition flex items-center gap-2 ${
                      p.id === gabaritarDeSelected ? 'bg-violet-100 text-violet-800 font-semibold' : 'hover:bg-gray-100 text-gray-700'
                    }`}>
                    {p.id === gabaritarDeSelected && <span className="text-[11px]">✓</span>}
                    {p.apelido}
                    {p.id === watchParticipantId && <span className="text-[10px] text-violet-500 ml-auto">👁</span>}
                  </button>
                ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowGabaritarDe(false)}
                className="px-4 py-1.5 text-[12px] rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 font-medium transition">
                Cancelar
              </button>
              <button
                disabled={!gabaritarDeSelected}
                onClick={async () => {
                  if (!gabaritarDeSelected) return
                  setShowGabaritarDe(false)
                  await handleGabaritarDe(gabaritarDeSelected)
                }}
                className="px-4 py-1.5 text-[12px] rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition">
                Gabaritar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
