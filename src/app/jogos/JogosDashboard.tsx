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
import { EstatisticasTab } from './EstatisticasTab'
import type { TeamInfo } from './EstatisticasTab'

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
export type GroupBetStat = { participant_id: string; group_name: string; first_place: string; second_place: string }
export type ThirdBetStat = { participant_id: string; group_name: string; team: string }
export type TournamentBetStat = { participant_id: string; champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

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
  teamGroups: Record<string, string>
  storedTotals: Record<string, number>
  isAdmin: boolean
  userId: string
  userName: string
  activeParticipantId: string | null
  userToParticipants: Record<string, string[]>
  attendance: AttendanceRow[]
  photos: PhotoRow[]
  groupBets: GroupBetStat[]
  thirdBets: ThirdBetStat[]
  tournamentBets: TournamentBetStat[]
}

export function JogosDashboard({
  initialMatchId, matches: initialMatches, participants, bets: initialBets,
  rules, teamAbbrs, teamGroups, storedTotals, isAdmin, userId, userName,
  activeParticipantId, userToParticipants, attendance: initialAttendance, photos: initialPhotos,
  groupBets, thirdBets, tournamentBets,
}: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  const [matches, setMatches]     = useState(initialMatches)
  const [bets, setBets]           = useState(initialBets)
  const [attendance, setAttendance] = useState(initialAttendance)
  const [photos, setPhotos]       = useState(initialPhotos)
  const [activeTab, setActiveTab] = useState<'jogos' | 'stats'>('jogos')

  const switchTab = (tab: 'jogos' | 'stats') => {
    setActiveTab(tab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const teamFlags = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const match of matches) {
      if (match.team_home && match.flag_home) m[match.team_home] = match.flag_home
      if (match.team_away && match.flag_away) m[match.team_away] = match.flag_away
    }
    return m
  }, [matches])

  const teamsInfo = useMemo<TeamInfo[]>(() => {
    return Object.entries(teamGroups)
      .filter(([, g]) => !!g)
      .map(([name, group]) => ({
        name,
        abbr:  teamAbbrs[name] ?? name.slice(0, 3).toUpperCase(),
        group,
        flag:  teamFlags[name] ?? '',
      }))
  }, [teamGroups, teamAbbrs, teamFlags])

  // Goal animation state — booleans cleared automatically after GOAL_ANIM_MS
  const [goalAnim, setGoalAnim]   = useState<{ home: boolean; away: boolean }>({ home: false, away: false })
  const prevScoreRef  = useRef<{ home: number | null; away: number | null }>({ home: null, away: null })
  const goalTimersRef = useRef<{ home?: ReturnType<typeof setTimeout>; away?: ReturnType<typeof setTimeout> }>({})

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

  // Points WITHOUT this match (live total minus this match's contribution)
  const ptsWithoutMatch = useMemo(() => {
    const out: Record<string, number> = {}
    for (const p of participants) {
      out[p.id] = (livePoints[p.id] ?? 0) - (matchPoints[p.id] ?? 0)
    }
    return out
  }, [participants, livePoints, matchPoints])

  // Ranking before (live total without this match)
  const rankBefore = useMemo(() => {
    const sorted = [...participants].sort((a, b) => (ptsWithoutMatch[b.id] ?? 0) - (ptsWithoutMatch[a.id] ?? 0))
    const out: Record<string, number> = {}
    sorted.forEach((p, i) => { out[p.id] = i + 1 })
    return out
  }, [participants, ptsWithoutMatch])

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
        goalAnim={goalAnim}
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
      <div className="pt-36 sm:pt-24 max-w-3xl mx-auto px-3 sm:px-4 space-y-4 py-4">

        {/* Tab bar */}
        <div className="flex rounded-xl bg-gray-200/70 p-0.5">
          <button
            onClick={() => switchTab('jogos')}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-bold transition-all ${activeTab === 'jogos' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Jogos
          </button>
          <button
            onClick={() => switchTab('stats')}
            className={`flex-1 rounded-[10px] py-1.5 text-xs font-bold transition-all ${activeTab === 'stats' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Estatísticas MB
          </button>
        </div>

        {activeTab === 'jogos' ? (
          <>
            <BetStats
              match={match}
              matchBets={matchBets}
              participants={participants}
              isZebra={headerZebra}
              rules={rules}
              rankAfter={rankAfter}
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
              isAdmin={isAdmin}
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
              onPhotoUpdated={updated => setPhotos(prev => prev.map(p => p.id === updated.id ? updated : p))}
            />
          </>
        ) : (
          <EstatisticasTab
            participants={participants}
            teams={teamsInfo}
            groupBets={groupBets}
            thirdBets={thirdBets}
            tournamentBets={tournamentBets}
            zebraThreshold={threshold}
          />
        )}
      </div>
    </div>
  )
}
