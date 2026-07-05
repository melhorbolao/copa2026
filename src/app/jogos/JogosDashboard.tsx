'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { scoreMatchBet, getMatchResult, detectMatchZebra } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'
import { ScoreHeader } from './ScoreHeader'
import { BetStats } from './BetStats'
import { RankingPanel } from './RankingPanel'
import { GroupStandings } from './GroupStandings'

export type MatchFull = {
  id: string; match_number: number; phase: string; round: number | null
  group_name: string | null; team_home: string; team_away: string
  flag_home: string; flag_away: string; match_datetime: string; city: string
  betting_deadline: string; score_home: number | null; score_away: number | null
  penalty_winner: string | null; is_brazil: boolean
}
export type BetRaw    = { participant_id: string; match_id: string; score_home: number; score_away: number; points: number | null }
export type Participant = { id: string; apelido: string }

const GOAL_ANIM_MS = 3 * 60 * 1000

function defaultMatchIdx(matches: MatchFull[]): number {
  const now = Date.now()
  // find in-progress (started, within 4h) — se houver dois simultâneos, o último na tabela
  let lastInProgress = -1
  matches.forEach((m, i) => {
    const t = new Date(m.match_datetime).getTime()
    if (now >= t && now <= t + 4 * 3600_000) lastInProgress = i
  })
  if (lastInProgress >= 0) return lastInProgress
  // next upcoming
  const next = matches.findIndex(m => new Date(m.match_datetime).getTime() > now)
  if (next >= 0) return next
  // last played
  return matches.length - 1
}

interface Props {
  initialMatchId: string | null
  matches: MatchFull[]
  participants: Participant[]
  bets: BetRaw[]
  rules: Record<string, number>
  teamAbbrs: Record<string, string>
  storedTotals: Record<string, number>
  isAdmin: boolean
  userId: string
  userName: string
  activeParticipantId: string | null
}

export function JogosDashboard({
  initialMatchId, matches: initialMatches, participants, bets: initialBets,
  rules, teamAbbrs, storedTotals, isAdmin, userId, userName,
  activeParticipantId,
}: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [matches, setMatches] = useState(initialMatches)
  const [bets, setBets]       = useState(initialBets)

  // Sincroniza bets com dados frescos do servidor após router.refresh()
  useEffect(() => { setBets(initialBets) }, [initialBets])

  // Goal animation state — booleans cleared automatically after GOAL_ANIM_MS
  const [goalAnim, setGoalAnim]   = useState<{ home: boolean; away: boolean }>({ home: false, away: false })
  const prevScoreRef  = useRef<{ home: number | null; away: number | null }>({ home: null, away: null })
  const goalTimersRef = useRef<{ home?: ReturnType<typeof setTimeout>; away?: ReturnType<typeof setTimeout> }>({})

  // Current match index — auto-detecção sempre vence (jogo em andamento ou próximo)
  const [matchIdx, setMatchIdx] = useState(() => defaultMatchIdx(initialMatches))

  const match = matches[matchIdx] ?? matches[0]

  // Sync URL with current match
  useEffect(() => {
    if (!match) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('m', match.id)
    router.replace(`/jogos?${params.toString()}`, { scroll: false })
  }, [match?.id]) // eslint-disable-line

  const prevMatchIdRef = useRef<string | null>(null)

  // Goal animation detection with sessionStorage persistence across page navigations
  useEffect(() => {
    if (!match) return

    const homeKey = `goalAnim_home_${match.id}`
    const awayKey = `goalAnim_away_${match.id}`

    // When match changes: reset and restore any persisted animation for new match
    if (prevMatchIdRef.current !== match.id) {
      prevMatchIdRef.current = match.id
      prevScoreRef.current = { home: match.score_home, away: match.score_away }
      setGoalAnim({ home: false, away: false })
      const now = Date.now()
      const homeEnd = sessionStorage.getItem(homeKey)
      const awayEnd = sessionStorage.getItem(awayKey)
      if (homeEnd && Number(homeEnd) > now) {
        setGoalAnim(g => ({ ...g, home: true }))
        clearTimeout(goalTimersRef.current.home)
        goalTimersRef.current.home = setTimeout(() => {
          setGoalAnim(g => ({ ...g, home: false }))
          sessionStorage.removeItem(homeKey)
        }, Number(homeEnd) - now)
      }
      if (awayEnd && Number(awayEnd) > now) {
        setGoalAnim(g => ({ ...g, away: true }))
        clearTimeout(goalTimersRef.current.away)
        goalTimersRef.current.away = setTimeout(() => {
          setGoalAnim(g => ({ ...g, away: false }))
          sessionStorage.removeItem(awayKey)
        }, Number(awayEnd) - now)
      }
      return
    }

    const prev = prevScoreRef.current
    if (prev.home !== null && match.score_home !== null && match.score_home > prev.home) {
      const endTime = Date.now() + GOAL_ANIM_MS
      sessionStorage.setItem(homeKey, String(endTime))
      clearTimeout(goalTimersRef.current.home)
      setGoalAnim(g => ({ ...g, home: true }))
      goalTimersRef.current.home = setTimeout(() => {
        setGoalAnim(g => ({ ...g, home: false }))
        sessionStorage.removeItem(homeKey)
      }, GOAL_ANIM_MS)
    }
    if (prev.away !== null && match.score_away !== null && match.score_away > prev.away) {
      const endTime = Date.now() + GOAL_ANIM_MS
      sessionStorage.setItem(awayKey, String(endTime))
      clearTimeout(goalTimersRef.current.away)
      setGoalAnim(g => ({ ...g, away: true }))
      goalTimersRef.current.away = setTimeout(() => {
        setGoalAnim(g => ({ ...g, away: false }))
        sessionStorage.removeItem(awayKey)
      }, GOAL_ANIM_MS)
    }
    prevScoreRef.current = { home: match.score_home, away: match.score_away }
  }, [match?.score_home, match?.score_away, match?.id]) // eslint-disable-line

  // Realtime: matches score updates.
  // Ao mudar o placar de um jogo, os `bets` locais de quem carregou a página antes do prazo
  // fechar podem estar incompletos (filterBetsByDeadline oculta palpites alheios até o prazo).
  // Um router.refresh() busca bets/storedTotals atualizados do servidor para TODOS os
  // espectadores (antes só acontecia no navegador de quem salvava o placar), evitando
  // ranking/medalhas divergentes calculados no cliente com dados parciais.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('jogos_matches_rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, payload => {
        let scoreChanged = false
        setMatches(prev => prev.map(m => {
          if (m.id !== payload.new.id) return m
          if (m.score_home !== payload.new.score_home || m.score_away !== payload.new.score_away) {
            scoreChanged = true
          }
          return { ...m, ...payload.new }
        }))
        if (scoreChanged) router.refresh()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [router])

  // Handle score save callback (from ScoreHeader)
  const handleScoreSaved = useCallback((sh: number | null, sa: number | null) => {
    setMatches(prev => prev.map(m => m.id === match.id ? { ...m, score_home: sh, score_away: sa } : m))
    // Busca storedTotals e bets.points atualizados do servidor para recalcular posições
    router.refresh()
  }, [match?.id]) // eslint-disable-line

  const navigate = (dir: -1 | 1) => {
    const next = matchIdx + dir
    if (next < 0 || next >= matches.length) return
    setMatchIdx(next)
  }

  // ── Computed data for current match ────────────────────────────────────────

  const threshold = rules['percentual_zebra'] ?? 15

  // All bets for this match
  const matchBets = useMemo(
    () => bets.filter(b => b.match_id === match?.id),
    [bets, match?.id],
  )

  // Zebra detection for header
  const headerZebra = useMemo(() => {
    if (!match?.score_home === null || match?.score_away === null) return false
    if (matchBets.length === 0) return false
    const result = getMatchResult(match.score_home!, match.score_away!)
    return detectMatchZebra(matchBets, result, threshold)
  }, [match?.score_home, match?.score_away, matchBets, threshold])

  // Minority outcomes map (H/D/A) — for bet table styling
  const minorityMap = useMemo(() => {
    if (matchBets.length === 0) return null
    return {
      H: detectMatchZebra(matchBets, 'H', threshold),
      D: detectMatchZebra(matchBets, 'D', threshold),
      A: detectMatchZebra(matchBets, 'A', threshold),
    }
  }, [matchBets, threshold])

  // Total live: parte de storedTotals (inclui grupos, torneio, artilheiro) e soma apenas o delta
  // de jogos ainda não recalculados no servidor (bets.points === null mas match já tem placar).
  const livePoints = useMemo(() => {
    const pts: Record<string, number> = {}
    for (const p of participants) pts[p.id] = storedTotals[p.id] ?? 0
    for (const m of matches) {
      if (m.score_home === null || m.score_away === null) continue
      const mBets = bets.filter(b => b.match_id === m.id)
      if (!mBets.some(b => b.points === null)) continue  // tudo recalculado, já em storedTotals
      const isZebra = detectMatchZebra(mBets, getMatchResult(m.score_home, m.score_away), threshold)
      for (const b of mBets.filter(bx => bx.points === null)) {
        pts[b.participant_id] = (pts[b.participant_id] ?? 0) +
          scoreMatchBet(b.score_home, b.score_away, m.score_home, m.score_away, isZebra, m.is_brazil, rules)
      }
    }
    return pts
  }, [matches, bets, participants, rules, threshold, storedTotals])

  // Points contributed by this match only.
  // Usa bets.points armazenados quando disponíveis (evita divergência na detecção de zebra
  // entre safeBets filtrado e o conjunto completo usado pelo servidor). Só computa ao vivo
  // quando o jogo ainda não foi recalculado (bets.points === null).
  const matchPoints = useMemo(() => {
    const pts: Record<string, number> = {}
    if (match?.score_home === null || match?.score_away === null) return pts
    for (const b of matchBets) {
      if (b.points !== null) pts[b.participant_id] = b.points
    }
    const unrecalculated = matchBets.filter(b => b.points === null)
    if (unrecalculated.length > 0) {
      const isZebra = detectMatchZebra(matchBets, getMatchResult(match.score_home!, match.score_away!), threshold)
      for (const b of unrecalculated) {
        pts[b.participant_id] = scoreMatchBet(b.score_home, b.score_away, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
      }
    }
    return pts
  }, [match?.score_home, match?.score_away, matchBets, match?.is_brazil, rules, threshold])

  // Points WITHOUT this match (live total minus this match's contribution) — usado para "PTS Total" no painel
  const ptsWithoutMatch = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of participants) {
      out[p.id] = (livePoints[p.id] ?? 0) - (matchPoints[p.id] ?? 0)
    }
    return out
  }, [participants, livePoints, matchPoints])

  // Ranking before: usa ptsWithoutMatch (livePoints sem este jogo) para capturar o delta
  // ao vivo de jogos recentes ainda não processados pelo cron, evitando posição desatualizada.
  const rankBefore = useMemo(() => {
    const sorted = [...participants].sort((a, b) => (ptsWithoutMatch[b.id] ?? 0) - (ptsWithoutMatch[a.id] ?? 0))
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => {
      out[p.id] = i > 0 && (ptsWithoutMatch[p.id] ?? 0) === (ptsWithoutMatch[sorted[i - 1].id] ?? 0)
        ? out[sorted[i - 1].id]
        : i + 1
    })
    return out
  }, [participants, ptsWithoutMatch])

  // Ranking after: ptsWithoutMatch + matchPoints = livePoints — base consistente com rankBefore
  const rankAfter = useMemo(() => {
    const ptsAfter = (p: { id: string }) => (ptsWithoutMatch[p.id] ?? 0) + (matchPoints[p.id] ?? 0)
    const sorted = [...participants].sort((a, b) => ptsAfter(b) - ptsAfter(a))
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => {
      out[p.id] = i > 0 && ptsAfter(p) === ptsAfter(sorted[i - 1])
        ? out[sorted[i - 1].id]
        : i + 1
    })
    return out
  }, [participants, ptsWithoutMatch, matchPoints])

  // Ranking geral ao vivo — usa livePoints (todos os jogos, incluindo não recalculados)
  const currentRank = useMemo(() => {
    const sorted = [...participants].sort((a, b) => (livePoints[b.id] ?? 0) - (livePoints[a.id] ?? 0))
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => {
      out[p.id] = i > 0 && (livePoints[p.id] ?? 0) === (livePoints[sorted[i - 1].id] ?? 0)
        ? out[sorted[i - 1].id]
        : i + 1
    })
    return out
  }, [participants, livePoints])

  // Resolve nomes reais para jogos eliminatórios a partir das classificações oficiais dos grupos
  const derivedTeamMap = useMemo(() => {
    const groupMatches = matches.filter(m => m.phase === 'group')
    const slim: MatchSlim[] = groupMatches.map(m => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away,
      flag_home: m.flag_home, flag_away: m.flag_away,
    }))
    const betMap = new Map<string, BetSlim>()
    const byGroup = new Map<string, { total: number; scored: number }>()
    for (const m of groupMatches) {
      if (m.score_home !== null && m.score_away !== null) {
        betMap.set(m.id, { match_id: m.id, score_home: m.score_home as number, score_away: m.score_away as number })
      }
      if (m.group_name) {
        const e = byGroup.get(m.group_name) ?? { total: 0, scored: 0 }
        e.total++
        if (m.score_home !== null && m.score_away !== null) e.scored++
        byGroup.set(m.group_name, e)
      }
    }
    const completeGroups = new Set<string>()
    for (const [g, { total, scored }] of byGroup) {
      if (total > 0 && scored === total) completeGroups.add(g)
    }
    const allGroupsComplete = byGroup.size > 0 && completeGroups.size === byGroup.size
    const standings = calcGroupStandings(slim, betMap)
    const thirds = rankThirds(standings)
    const thirdSlots = resolveThirdSlots(thirds)
    const r32Slots = buildR32Teams(standings, thirds, thirdSlots, undefined, completeGroups, allGroupsComplete)
    const knockoutMatches = matches.filter(m =>
      ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase)
    )
    return buildKnockoutTeamMap(r32Slots, knockoutMatches)
  }, [matches])

  // Match efetivo: aplica nomes reais para fases eliminatórias
  const effectiveMatch = useMemo(() => {
    if (!match) return match
    const override = derivedTeamMap.get(match.id)
    return override ? { ...match, ...override } : match
  }, [match, derivedTeamMap])

  // "Quase" — who scores if home gets +1 or away gets +1
  const quase = useMemo(() => {
    if (match?.score_home === null || match?.score_away === null) return { home: [], away: [] }
    const sh = match.score_home! + 1
    const sa = match.score_away!
    const sa2 = match.score_away! + 1
    const sh2 = match.score_home!
    const homeGoal = matchBets.filter(b => b.score_home === sh && b.score_away === sa)
    const awayGoal = matchBets.filter(b => b.score_home === sh2 && b.score_away === sa2)
    return { home: homeGoal.map(b => b.participant_id), away: awayGoal.map(b => b.participant_id) }
  }, [match?.score_home, match?.score_away, matchBets])

  // Group standings (for group phase) using official scores via betMap
  const groupStandings = useMemo(() => {
    if (match?.phase !== 'group' || !match.group_name) return null
    const g = match.group_name
    const groupMatches = matches.filter(m => m.phase === 'group' && m.group_name === g)
    const betMap = new Map<string, BetSlim>()
    for (const m of groupMatches) {
      if (m.score_home !== null && m.score_away !== null) {
        betMap.set(m.id, { match_id: m.id, score_home: m.score_home as number, score_away: m.score_away as number })
      }
    }
    return calcGroupStandings(
      groupMatches.map(m => ({ id: m.id, group_name: m.group_name!, phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: m.flag_home, flag_away: m.flag_away })),
      betMap,
    )
  }, [matches, match?.phase, match?.group_name])

  if (!match) return <div className="p-8 text-center text-gray-400">Nenhum jogo disponível.</div>

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <ScoreHeader
        match={effectiveMatch}
        matches={matches}
        matchIdx={matchIdx}
        abbr={abbr}
        isAdmin={isAdmin}
        userId={userId}
        goalAnim={goalAnim}
        isZebra={headerZebra}
        onNavigate={navigate}
        onScoreSaved={handleScoreSaved}
      />

      {/* Page content — offset from fixed header */}
      <div className="jogos-content-top max-w-3xl mx-auto px-3 sm:px-4 space-y-4">

        <BetStats
          match={effectiveMatch}
          matchBets={matchBets}
          participants={participants}
          isZebra={headerZebra}
          rules={rules}
          rankBefore={rankBefore}
          rankAfter={rankAfter}
          currentRank={currentRank}
          hasAnyScore={match.score_home !== null || Object.values(livePoints).some(pts => pts > 0)}
          activeParticipantId={activeParticipantId}
          teamAbbrs={teamAbbrs}
        />

        <RankingPanel
          match={effectiveMatch}
          matchBets={matchBets}
          participants={participants}
          matchPoints={matchPoints}
          ptsWithoutMatch={ptsWithoutMatch}
          rankBefore={rankBefore}
          rankAfter={rankAfter}
          quase={quase}
          abbr={abbr}
          teamAbbrs={teamAbbrs}
          isAdmin={isAdmin}
        />

        {match.phase === 'group' && groupStandings && (
          <GroupStandings
            group={match.group_name!}
            standings={groupStandings}
            teamAbbrs={teamAbbrs}
          />
        )}
      </div>
    </div>
  )
}
