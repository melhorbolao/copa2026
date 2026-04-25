export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PalpitesContent } from './PalpitesContent'
import type { PalpitesContentProps } from './PalpitesContent'
import {
  calcGroupStandings, rankThirds, resolveThirdSlots,
  buildR32Teams, buildKnockoutTeamMap, R32_MATCHES,
} from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'
import { scoreTournamentBet } from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'
import type { MatchPhase } from '@/types/database'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const DEADLINE_LABELS: Record<string, string> = {
  group_1: 'Rodada 1', group_2: 'Rodada 2', group_3: 'Rodada 3',
  round_of_32: '16 avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
  semifinal: 'Semifinal', third_place: 'Final', final: 'Final',
}

export default async function PalpitesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // Parallel: participantId lookup + admin profile fetch
  const [participantId, { data: userProfile }] = await Promise.all([
    getActiveParticipantId(supabase, user.id).catch(() => null),
    supabase.from('users').select('is_admin').eq('id', user.id).single(),
  ])
  if (!participantId) redirect('/aguardando-aprovacao')
  await requirePageAccess('palpites', userProfile?.is_admin ?? false)

  // All DB queries in a single parallel batch (8 concurrent)
  const [
    { data: matches },
    { data: bets },
    { data: groupBets },
    { data: tBet },
    scorerMappingsRaw,
    { data: rulesData },
    thirdBetsResult,
    officialScorerResult,
  ] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, city, betting_deadline, score_home, score_away, is_brazil, penalty_winner')
      .order('match_datetime', { ascending: true }),
    supabase.from('bets')
      .select('match_id, score_home, score_away, points')
      .eq('participant_id', participantId),
    supabase.from('group_bets')
      .select('group_name, first_place, second_place, points')
      .eq('participant_id', participantId),
    supabase.from('tournament_bets')
      .select('champion, runner_up, semi1, semi2, top_scorer, points')
      .eq('participant_id', participantId)
      .maybeSingle(),
    supabase.from('top_scorer_mapping').select('raw_name, standardized_name')
      .then(r => r.data ?? [], () => []),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('third_place_bets')
      .select('group_name, team, points')
      .eq('participant_id', participantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle()
      .then((r: any) => r, () => null),
  ])

  if (thirdBetsResult.error) {
    console.error('[palpites/page] third_place_bets error:', thirdBetsResult.error?.message)
  }
  const thirdBets = (thirdBetsResult.data ?? []) as { group_name: string; team: string; points: number | null }[]

  const rulesMap: Record<string, number> = Object.fromEntries(
    (rulesData ?? []).map((r: { key: string; points: number }) => [r.key, r.points])
  )
  const thirdPts = rulesMap['terceiro_classificado'] ?? 3

  const scorerMapping: Record<string, string> = Object.fromEntries(
    (scorerMappingsRaw as { raw_name: string; standardized_name: string }[]).map(m => [m.raw_name, m.standardized_name])
  )

  let officialTopScorers: string[] = []
  if (officialScorerResult?.data?.value) {
    try { officialTopScorers = JSON.parse(officialScorerResult.data.value) }
    catch { officialTopScorers = [officialScorerResult.data.value] }
  }

  // ── Derived bracket data ─────────────────────────────────────────
  const groupMatches    = (matches ?? []).filter(m => m.phase === 'group')
  const knockoutMatches = (matches ?? []).filter(m => m.phase !== 'group')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slimGroupMatches: MatchSlim[] = (groupMatches as any[]).map((m: any) => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home, flag_away: m.flag_away,
  }))

  const slimBetMap = new Map<string, BetSlim>(
    (bets ?? []).map(b => [b.match_id, { match_id: b.match_id, score_home: b.score_home ?? 0, score_away: b.score_away ?? 0 }])
  )
  const calculatedStandings = calcGroupStandings(slimGroupMatches, slimBetMap)

  const officialScoreMap = new Map<string, BetSlim>(
    groupMatches
      .filter(m => m.score_home !== null && m.score_away !== null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => [m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away }])
  )
  const officialStandings  = calcGroupStandings(slimGroupMatches, officialScoreMap)
  const officialThirdTeams: Record<string, string> = {}
  for (const s of officialStandings) {
    if (s.teams[2]?.team) officialThirdTeams[s.group] = s.teams[2].team
  }
  const officialThirds     = rankThirds(officialStandings)
  const officialThirdSlots = resolveThirdSlots(officialThirds)
  const officialR32Slots   = officialThirdSlots
    ? buildR32Teams(officialStandings, officialThirds, officialThirdSlots)
    : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knockoutTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatches as any)

  // Pre-resolve knockout team names so client gets serializable plain objects
  const resolvedKnockoutByPhase: Partial<Record<string, object[]>> = {}
  for (const m of knockoutMatches) {
    const p = m.phase as MatchPhase
    if (!resolvedKnockoutByPhase[p]) resolvedKnockoutByPhase[p] = []
    resolvedKnockoutByPhase[p]!.push({ ...m, ...(knockoutTeamMap.get(m.id) ?? {}) })
  }

  // R32 labels as plain object (Map is not serializable as a prop)
  const r32Labels: Record<number, { labelA: string; labelB: string }> = {}
  R32_MATCHES.forEach((m, i) => {
    const num  = parseInt(m.matchNum.slice(1), 10)
    const slot = officialR32Slots[i]
    if (slot) r32Labels[num] = { labelA: slot.labelA, labelB: slot.labelB }
  })

  // ── Group-level data ─────────────────────────────────────────────
  type TeamEntry = { team: string; flag: string }
  const groupTeams: Record<string, { teams: TeamEntry[]; deadline: string }> = {}
  for (const m of groupMatches) {
    if (!m.group_name) continue
    const g = m.group_name as string
    if (!groupTeams[g]) groupTeams[g] = { teams: [], deadline: m.betting_deadline }
    for (const [team, flag] of [[m.team_home, m.flag_home], [m.team_away, m.flag_away]] as [string,string][]) {
      if (team !== 'TBD' && !groupTeams[g].teams.find(t => t.team === team)) {
        groupTeams[g].teams.push({ team, flag })
      }
    }
  }

  const seen = new Set<string>()
  const allTeams: TeamEntry[] = []
  for (const g of GROUP_ORDER) {
    for (const t of groupTeams[g]?.teams ?? []) {
      if (!seen.has(t.team)) { seen.add(t.team); allTeams.push(t) }
    }
  }
  allTeams.sort((a, b) => a.team.localeCompare(b.team, 'pt'))

  const tournamentDeadline = groupMatches[0]?.betting_deadline ?? new Date().toISOString()

  const calculatedTopPerGroup: Record<string, { first: string; second: string; third: string; tiedTeams: string[] }> =
    Object.fromEntries(
      calculatedStandings.map(s => [s.group, {
        first: s.teams[0]?.team ?? '', second: s.teams[1]?.team ?? '',
        third: s.teams[2]?.team ?? '', tiedTeams: s.tiedTeams ?? [],
      }])
    )

  // Bet maps as plain objects (Map is not serializable as a prop)
  const betMap: Record<string, { score_home: number; score_away: number; points: number | null }> =
    Object.fromEntries((bets ?? []).map(b => [b.match_id, { score_home: b.score_home ?? 0, score_away: b.score_away ?? 0, points: b.points }]))

  const groupBetMap: Record<string, { first_place: string; second_place: string; points: number | null }> =
    Object.fromEntries((groupBets ?? []).map(b => [b.group_name, { first_place: b.first_place, second_place: b.second_place, points: b.points }]))

  // ── Live G4 + artilheiro score ───────────────────────────────────
  const resolveKnockoutTeam = (m: { id: string; team_home: string; team_away: string }, side: 'home' | 'away'): string => {
    const ov = knockoutTeamMap.get(m.id)
    return side === 'home' ? (ov?.team_home ?? m.team_home) : (ov?.team_away ?? m.team_away)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knockoutWinner = (m: any): string | null => {
    if (m.score_home === null || m.score_away === null) return null
    const h = resolveKnockoutTeam(m, 'home'), a = resolveKnockoutTeam(m, 'away')
    if (m.score_home > m.score_away) return h
    if (m.score_away > m.score_home) return a
    return m.penalty_winner ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byPhase = (p: string) => knockoutMatches.filter((m: any) => m.phase === p).sort((a: any, b: any) => a.match_number - b.match_number)
  const qfMs   = byPhase('quarterfinal')
  const sfMs   = byPhase('semifinal')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finM   = knockoutMatches.find((m: any) => m.phase === 'final')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thrM   = knockoutMatches.find((m: any) => m.phase === 'third_place')

  const kSemis = qfMs.map(knockoutWinner).filter((t: string | null): t is string => !!t)
  const kFins  = sfMs.map(knockoutWinner).filter((t: string | null): t is string => !!t)
  let kChampion: string | null = null, kRunnerUp: string | null = null
  if (finM) {
    kChampion = knockoutWinner(finM)
    if (kChampion) kRunnerUp = resolveKnockoutTeam(finM, kChampion === resolveKnockoutTeam(finM, 'home') ? 'away' : 'home')
  }
  let kThird: string | null = null, kFourth: string | null = null
  if (thrM) {
    kThird = knockoutWinner(thrM)
    if (kThird) kFourth = resolveKnockoutTeam(thrM, kThird === resolveKnockoutTeam(thrM, 'home') ? 'away' : 'home')
  }
  const knockoutResults: TournamentResults = {
    semifinalists: kSemis, finalists: kFins,
    champion: kChampion, runnerUp: kRunnerUp,
    third: kThird, fourth: kFourth,
    officialScorers: officialTopScorers,
  }

  let liveScore: number | null = null
  if (tBet && (knockoutResults.semifinalists.length > 0 || knockoutResults.officialScorers.length > 0)) {
    liveScore = scoreTournamentBet(
      { champion: tBet.champion ?? '', runner_up: tBet.runner_up ?? '', semi1: tBet.semi1 ?? '', semi2: tBet.semi2 ?? '', top_scorer: tBet.top_scorer ?? '' },
      knockoutResults, rulesMap, false, scorerMapping,
    )
  }

  // ── Filter-independent stats ─────────────────────────────────────
  const totalMatches   = matches?.length ?? 0
  const totalBets      = bets?.length ?? 0
  const totalGroupBets = (groupBets ?? []).filter(b => b.first_place && b.second_place).length
  const thirdCount     = thirdBets.filter(b => b.team?.trim().length > 0).length
  const bonusCount     = tBet
    ? [tBet.champion, tBet.runner_up, tBet.semi1, tBet.semi2, tBet.top_scorer].filter(v => v && String(v).length > 0).length
    : 0

  const groupMatchSet  = new Set(groupMatches.map(m => m.id))
  const groupBetCount  = (bets ?? []).filter(b =>
    groupMatchSet.has(b.match_id) && b.score_home !== null && b.score_away !== null
  ).length
  const allGroupsFilled = groupMatches.length > 0 && groupBetCount >= groupMatches.length
  const alreadyFilled   = (groupBets ?? []).filter(b => b.first_place && b.second_place).length > 0
    || thirdBets.length > 0

  const now = new Date()
  const nextMatch = (matches ?? [])
    .filter(m => new Date(m.betting_deadline) > now)
    .sort((a, b) => new Date(a.betting_deadline).getTime() - new Date(b.betting_deadline).getTime())[0]
  const nextDeadline = nextMatch ? {
    iso:   nextMatch.betting_deadline,
    label: nextMatch.phase === 'group'
      ? (DEADLINE_LABELS[`group_${nextMatch.round}`] ?? 'Rodada')
      : (DEADLINE_LABELS[nextMatch.phase] ?? 'Próxima etapa'),
  } : null

  const props: PalpitesContentProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    groupMatches: groupMatches as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolvedKnockoutByPhase: resolvedKnockoutByPhase as any,
    r32Labels,
    betMap,
    groupBetMap,
    tBet: tBet ? {
      champion: tBet.champion ?? '', runner_up: tBet.runner_up ?? '',
      semi1: tBet.semi1 ?? '', semi2: tBet.semi2 ?? '',
      top_scorer: tBet.top_scorer ?? '', points: tBet.points,
    } : null,
    thirdBets,
    groupTeams,
    allTeams,
    tournamentDeadline,
    calculatedTopPerGroup,
    officialThirdTeams,
    liveScore,
    scorerMapping,
    thirdPts,
    participantId,
    totalMatches,
    totalBets,
    totalGroupBets,
    thirdCount,
    bonusCount,
    allGroupsFilled,
    alreadyFilled,
    nextDeadline,
  }

  return (
    <>
      <Navbar />
      <Suspense fallback={null}>
        <PalpitesContent {...props} />
      </Suspense>
    </>
  )
}
