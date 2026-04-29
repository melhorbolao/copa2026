'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { scoreMatchBet, getMatchResult, detectMatchZebra } from '@/lib/scoring/engine'
import { calcGroupStandings } from '@/lib/bracket/engine'
import { ScoreHeader } from './ScoreHeader'
import { BetStats } from './BetStats'
import { RankingPanel } from './RankingPanel'
import { GroupStandings } from './GroupStandings'
import { StadiumSection } from './StadiumSection'

export type MatchFull = {
  id: string; match_number: number; phase: string; round: number | null
  group_name: string | null; team_home: string; team_away: string
  flag_home: string; flag_away: string; match_datetime: string; city: string
  betting_deadline: string; score_home: number | null; score_away: number | null
  penalty_winner: string | null; is_brazil: boolean
}
export type BetRaw    = { participant_id: string; match_id: string; score_home: number; score_away: number; points: number | null }
export type Participant = { id: string; apelido: string }
export type AttendanceRow = { id: string; match_id: string; user_id: string; participant_ids: string[] | null }
export type PhotoRow = { id: string; match_id: string; user_id: string; storage_path: string; participant_ids: string[] | null; caption: string | null; created_at: string; url: string | null }

const GOAL_ANIM_MS = 3 * 60 * 1000

function defaultMatchIdx(matches: MatchFull[]): number {
  const now = Date.now()
  // find in-progress (started, within 2h)
  const inProgress = matches.findIndex(m => {
    const t = new Date(m.match_datetime).getTime()
    return now >= t && now <= t + 2 * 3600_000
  })
  if (inProgress >= 0) return inProgress
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
  userToParticipants: Record<string, string[]>
  attendance: AttendanceRow[]
  photos: PhotoRow[]
}

export function JogosDashboard({
  initialMatchId, matches: initialMatches, participants, bets: initialBets,
  rules, teamAbbrs, storedTotals, isAdmin, userId, userName,
  activeParticipantId, userToParticipants, attendance: initialAttendance, photos: initialPhotos,
}: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [matches, setMatches]     = useState(initialMatches)
  const [bets, setBets]           = useState(initialBets)
  const [attendance, setAttendance] = useState(initialAttendance)
  const [photos, setPhotos]       = useState(initialPhotos)

  // Goal animation state: { home?: number (timestamp), away?: number }
  const [goalAnim, setGoalAnim]   = useState<{ home?: number; away?: number }>({})
  const prevScoreRef = useRef<{ home: number | null; away: number | null }>({ home: null, away: null })

  // Current match index
  const [matchIdx, setMatchIdx] = useState(() => {
    if (initialMatchId) {
      const idx = initialMatches.findIndex(m => m.id === initialMatchId)
      if (idx >= 0) return idx
    }
    return defaultMatchIdx(initialMatches)
  })

  const match = matches[matchIdx] ?? matches[0]

  // Sync URL with current match
  useEffect(() => {
    if (!match) return
    const params = new URLSearchParams(searchParams.toString())
    params.set('m', match.id)
    router.replace(`/jogos?${params.toString()}`, { scroll: false })
  }, [match?.id]) // eslint-disable-line

  // Goal animation detection
  useEffect(() => {
    if (!match) return
    const prev = prevScoreRef.current
    const now  = Date.now()
    if (prev.home !== null && match.score_home !== null && match.score_home > prev.home)
      setGoalAnim(g => ({ ...g, home: now }))
    if (prev.away !== null && match.score_away !== null && match.score_away > prev.away)
      setGoalAnim(g => ({ ...g, away: now }))
    prevScoreRef.current = { home: match.score_home, away: match.score_away }
  }, [match?.score_home, match?.score_away]) // eslint-disable-line

  // Realtime: matches score updates
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('jogos_matches_rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, payload => {
        setMatches(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Realtime: attendance
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('jogos_attendance_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stadium_attendance' }, () => {
        // Refresh page data
        router.refresh()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line

  // Handle score save callback (from ScoreHeader)
  const handleScoreSaved = useCallback((sh: number | null, sa: number | null) => {
    setMatches(prev => prev.map(m => m.id === match.id ? { ...m, score_home: sh, score_away: sa } : m))
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

  // Is goal animation still active?
  const goalAnimActive = useMemo(() => ({
    home: goalAnim.home !== undefined && Date.now() - goalAnim.home < GOAL_ANIM_MS,
    away: goalAnim.away !== undefined && Date.now() - goalAnim.away < GOAL_ANIM_MS,
  }), [goalAnim])

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

  // Per-participant points for ALL matches (live computation)
  const livePoints = useMemo(() => {
    const pts: Record<string, number> = {}
    for (const p of participants) pts[p.id] = 0
    for (const m of matches) {
      if (m.score_home === null || m.score_away === null) continue
      const isZebra = detectMatchZebra(
        bets.filter(b => b.match_id === m.id),
        getMatchResult(m.score_home, m.score_away),
        threshold,
      )
      for (const b of bets.filter(bx => bx.match_id === m.id)) {
        pts[b.participant_id] = (pts[b.participant_id] ?? 0) +
          scoreMatchBet(b.score_home, b.score_away, m.score_home, m.score_away, isZebra, m.is_brazil, rules)
      }
    }
    return pts
  }, [matches, bets, participants, rules, threshold])

  // Points contributed by this match only (live)
  const matchPoints = useMemo(() => {
    const pts: Record<string, number> = {}
    if (match?.score_home === null || match?.score_away === null) return pts
    const isZebra = detectMatchZebra(matchBets, getMatchResult(match.score_home!, match.score_away!), threshold)
    for (const b of matchBets) {
      pts[b.participant_id] = scoreMatchBet(b.score_home, b.score_away, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
    }
    return pts
  }, [match?.score_home, match?.score_away, matchBets, match?.is_brazil, rules, threshold])

  // Points WITHOUT this match (using stored totals minus stored match bet points)
  const ptsWithoutMatch = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of participants) {
      const stored = storedTotals[p.id] ?? 0
      const storedBet = bets.find(b => b.match_id === match?.id && b.participant_id === p.id)
      out[p.id] = stored - (storedBet?.points ?? 0)
    }
    return out
  }, [participants, storedTotals, bets, match?.id])

  // Ranking before (by stored totals)
  const rankBefore = useMemo(() => {
    const sorted = [...participants].sort((a, b) => (storedTotals[b.id] ?? 0) - (storedTotals[a.id] ?? 0))
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => { out[p.id] = i + 1 })
    return out
  }, [participants, storedTotals])

  // Ranking after (stored without match + new match points)
  const rankAfter = useMemo(() => {
    const sorted = [...participants].sort((a, b) =>
      ((ptsWithoutMatch[b.id] ?? 0) + (matchPoints[b.id] ?? 0)) -
      ((ptsWithoutMatch[a.id] ?? 0) + (matchPoints[a.id] ?? 0))
    )
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => { out[p.id] = i + 1 })
    return out
  }, [participants, ptsWithoutMatch, matchPoints])

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
    const betMap = new Map<string, import('@/lib/bracket/engine').BetSlim>()
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

  // Attendance for this match
  const matchAttendance = useMemo(
    () => attendance.filter(a => a.match_id === match?.id),
    [attendance, match?.id],
  )

  // Photos for this match
  const matchPhotos = useMemo(
    () => photos.filter(p => p.match_id === match?.id),
    [photos, match?.id],
  )

  // Count distinct participants present
  const presentParticipantIds = useMemo(() => {
    const ids = new Set<string>()
    for (const a of matchAttendance) {
      for (const pid of a.participant_ids ?? []) ids.add(pid)
    }
    return ids
  }, [matchAttendance])

  if (!match) return <div className="p-8 text-center text-gray-400">Nenhum jogo disponível.</div>

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <ScoreHeader
        match={match}
        matches={matches}
        matchIdx={matchIdx}
        abbr={abbr}
        isAdmin={isAdmin}
        userId={userId}
        goalAnim={goalAnimActive}
        isZebra={headerZebra}
        presentCount={presentParticipantIds.size}
        attendance={matchAttendance}
        participants={participants}
        userToParticipants={userToParticipants}
        activeParticipantId={activeParticipantId}
        onNavigate={navigate}
        onScoreSaved={handleScoreSaved}
      />

      {/* Page content — offset from fixed header */}
      <div className="pt-[100px] sm:pt-[80px] max-w-3xl mx-auto px-3 sm:px-4 space-y-4 py-4">

        <BetStats
          match={match}
          matchBets={matchBets}
          participants={participants}
          minorityMap={minorityMap}
          abbr={abbr}
        />

        <RankingPanel
          match={match}
          matchBets={matchBets}
          participants={participants}
          matchPoints={matchPoints}
          ptsWithoutMatch={ptsWithoutMatch}
          rankBefore={rankBefore}
          rankAfter={rankAfter}
          quase={quase}
          abbr={abbr}
          teamAbbrs={teamAbbrs}
        />

        {match.phase === 'group' && groupStandings && (
          <GroupStandings
            group={match.group_name!}
            standings={groupStandings}
            teamAbbrs={teamAbbrs}
          />
        )}

        <StadiumSection
          match={match}
          matchAttendance={matchAttendance}
          matchPhotos={matchPhotos}
          participants={participants}
          userId={userId}
          isAdmin={isAdmin}
          userToParticipants={userToParticipants}
          activeParticipantId={activeParticipantId}
          onAttendanceChange={updated => setAttendance(prev => {
            const filtered = prev.filter(a => !(a.match_id === match.id && a.user_id === userId))
            return updated ? [...filtered, updated] : filtered
          })}
          onPhotoAdded={p => setPhotos(prev => [p, ...prev])}
          onPhotoDeleted={id => setPhotos(prev => prev.filter(p => p.id !== id))}
        />
      </div>
    </div>
  )
}
