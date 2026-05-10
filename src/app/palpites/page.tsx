export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PalpitesContent } from './PalpitesContent'
import type { PalpitesContentProps } from './PalpitesContent'
import { PalpitesSkeleton } from './PalpitesSkeleton'
import {
  getCachedScoringRules, getCachedScorerMapping, getCachedOfficialScorers,
} from './cached'
import {
  calcGroupStandings, rankThirds, resolveThirdSlots,
  buildR32Teams, buildKnockoutTeamMap, R32_MATCHES,
  computeGroupCompletion,
} from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'
import { scoreTournamentBetBreakdown } from '@/lib/scoring/engine'
import type { TournamentResults, TournamentBetBreakdown } from '@/lib/scoring/engine'
import type { MatchPhase } from '@/types/database'
import {
  getPhaseSettings, getQualifiedSets, canFillStage, STAGE_KEYS,
} from '@/lib/phase-availability'
import type { StageKey } from '@/lib/phase-availability'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const DEADLINE_LABELS: Record<string, string> = {
  group_1: 'Rodada 1', group_2: 'Rodada 2', group_3: 'Rodada 3',
  round_of_32: '16 avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
  semifinal: 'Semifinal', third_place: 'Final', final: 'Final',
}

export default async function PalpitesPage() {
  // ── Auth + access (rápido, sem queries pesadas) ────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [participantId, { data: userProfile }] = await Promise.all([
    getActiveParticipantId(supabase, user.id).catch(() => null),
    supabase.from('users').select('is_admin').eq('id', user.id).single(),
  ])
  if (!participantId) redirect('/aguardando-aprovacao')
  await requirePageAccess('palpites', userProfile?.is_admin ?? false)

  // Stream: o Navbar já vai. Os dados pesados ficam dentro do Suspense.
  return (
    <>
      <Navbar />
      <Suspense fallback={<PalpitesSkeleton />}>
        <PalpitesData participantId={participantId} />
      </Suspense>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente assíncrono que carrega TUDO o que /palpites precisa para
// renderizar PalpitesContent. Suspende enquanto as queries rodam.
// ─────────────────────────────────────────────────────────────────────────────
async function PalpitesData({ participantId }: { participantId: string }) {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // Config cacheada (1h TTL) — não conta como query a cada request
  const [rulesMap, scorerMapping, officialTopScorers] = await Promise.all([
    getCachedScoringRules(),
    getCachedScorerMapping(),
    getCachedOfficialScorers(),
  ])

  // 5 queries dinâmicas em paralelo (eram 8 — caímos pra 5) +
  // configurações de disponibilidade e qualificados pelos cortes (regulamento 27–30).
  const phaseSettingsP = getPhaseSettings()
  const qualifiedP     = getQualifiedSets()

  const [
    { data: matches },
    { data: bets },
    { data: groupBets },
    { data: tBet },
    thirdBetsResult,
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
    admin.from('third_place_bets')
      .select('group_name, team, points')
      .eq('participant_id', participantId),
  ])

  const [phaseSettings, qualified] = await Promise.all([phaseSettingsP, qualifiedP])
  const fillableStages: Record<StageKey, boolean> = Object.fromEntries(
    STAGE_KEYS.map(s => [s, canFillStage(s, participantId, phaseSettings, qualified)]),
  ) as Record<StageKey, boolean>

  let thirdBets: { group_name: string; team: string; points: number | null }[] = []
  if (thirdBetsResult.error) {
    console.error('[palpites/page] third_place_bets error:', thirdBetsResult.error?.message)
    const r2 = await admin.from('third_place_bets').select('group_name, team').eq('participant_id', participantId)
    if (r2.error) console.error('[palpites/page] third_place_bets fallback error:', r2.error?.message)
    thirdBets = (r2.data ?? []) as typeof thirdBets
  } else {
    thirdBets = (thirdBetsResult.data ?? []) as typeof thirdBets
  }

  const thirdPts = rulesMap['terceiro_classificado'] ?? 3

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

  // Guard contra fallback alfabético: só preenche slots do bracket quando os
  // grupos relevantes têm TODOS os jogos com placar registrado em betMap.
  const { completeGroups, allGroupsComplete } =
    computeGroupCompletion(groupMatches, officialScoreMap)

  const officialR32Slots = officialThirdSlots
    ? buildR32Teams(officialStandings, officialThirds, officialThirdSlots, undefined, completeGroups, allGroupsComplete)
    : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knockoutTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatches as any)

  const resolvedKnockoutByPhase: Partial<Record<string, object[]>> = {}
  for (const m of knockoutMatches) {
    const p = m.phase as MatchPhase
    if (!resolvedKnockoutByPhase[p]) resolvedKnockoutByPhase[p] = []
    resolvedKnockoutByPhase[p]!.push({ ...m, ...(knockoutTeamMap.get(m.id) ?? {}) })
  }

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
  let liveBreakdown: TournamentBetBreakdown | null = null
  if (tBet && (knockoutResults.semifinalists.length > 0 || knockoutResults.officialScorers.length > 0)) {
    const betInput = { champion: tBet.champion ?? '', runner_up: tBet.runner_up ?? '', semi1: tBet.semi1 ?? '', semi2: tBet.semi2 ?? '', top_scorer: tBet.top_scorer ?? '' }
    liveBreakdown = scoreTournamentBetBreakdown(betInput, knockoutResults, rulesMap, false, scorerMapping)
    liveScore = liveBreakdown.champion + liveBreakdown.runner_up + liveBreakdown.semi1 + liveBreakdown.semi2 + liveBreakdown.top_scorer
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

  // ── Dados para a aba "Minha Tabela" ──────────────────────────────
  const groupBetsOverride: Record<string, { first_place: string; second_place: string }> =
    Object.fromEntries((groupBets ?? []).map(gb => [gb.group_name, { first_place: gb.first_place, second_place: gb.second_place }]))
  const thirdBetsOverride: Record<string, { team: string }> =
    Object.fromEntries(thirdBets.map(tb => [tb.group_name, { team: tb.team }]))
  const g4Deadline = groupMatches.map(m => m.betting_deadline).sort()[0] ?? ''
  const hasTournamentBet = !!(tBet?.champion)
  const groupAllBetsFilled: Record<string, boolean> = {}
  const groupBetSet = new Set((bets ?? []).map(b => b.match_id))
  for (const m of groupMatches) {
    if (!m.group_name) continue
    if (!(m.group_name in groupAllBetsFilled)) groupAllBetsFilled[m.group_name] = true
    if (!groupBetSet.has(m.id)) groupAllBetsFilled[m.group_name] = false
  }
  const filledBets        = groupBetCount
  const totalGroupMatches = groupMatches.length

  // Mesma guarda do bracket oficial, mas baseada nos PALPITES do usuário:
  // só preenche slots da Minha Tabela quando os grupos relevantes estão
  // 100% palpitados — caso contrário cai no fallback alfabético.
  const userCompletion = computeGroupCompletion(slimGroupMatches, slimBetMap)

  // ── Default etapa = rodada ativa (item A) ─────────────────────────
  // O servidor calcula o default para o cliente saber qual etapa exibir
  // quando a URL não tem `?etapa=...`. Cliente continua reativo a mudanças.
  const now = new Date()
  let defaultActiveRound: number | null = null
  for (const r of [1, 2, 3]) {
    const m = groupMatches.find(gm => gm.round === r)
    if (m && new Date(m.betting_deadline) > now) { defaultActiveRound = r; break }
  }

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
    liveBreakdown,
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
    calculatedStandings,
    groupBetsOverride,
    thirdBetsOverride,
    g4Deadline,
    hasTournamentBet,
    groupAllBetsFilled,
    filledBets,
    totalGroupMatches,
    defaultActiveRound,
    userCompleteGroups: [...userCompletion.completeGroups],
    userAllGroupsComplete: userCompletion.allGroupsComplete,
    fillableStages,
  }

  return <PalpitesContent {...props} />
}
