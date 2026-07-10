export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PanelaClient } from './PanelaClient'
import { getServerNow } from '@/lib/production-mode'
import { scoreMatchBet, detectMatchZebra, getMatchResult, scoreTournamentBet } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

export default async function MinhaPanelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  await requirePageAccess('minhaPanela', profile?.role ?? 'user')

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = await getServerNow()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from(table).select(select).order('id', { ascending: true }).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  // ── Fetch paralelo: dados base ─────────────────────────────────────────────
  const [
    allParticipantsRes,
    panelaRes,
    snapshotRes,
    matchesRes,
    rulesRes,
    allBetsRaw,
    groupBetsRaw,
    thirdBetsRaw,
    tournamentBetsRes,
    thirdScoringRes,
    artillarySettingRes,
    scorerMappingRes,
    topScorersRes,
  ] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    admin.from('daily_rankings_snapshot')
      .select('participant_id, rank, pts_total, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(500),
    supabase.from('matches')
      .select('id, match_number, phase, group_name, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, penalty_winner, is_brazil')
      .order('match_datetime', { ascending: true }),
    supabase.from('scoring_rules').select('key, points'),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    fetchAll('group_bets', 'participant_id, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('third_place_scoring').select('group_name, enabled'),
    admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle()
      .then((r: { data: { value: string } | null }) => r, () => ({ data: null })),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name')
      .then((r: { data: { raw_name: string; standardized_name: string }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
      .then((r: { data: { player_name: string; goals_count: number }[] | null }) => r, () => ({ data: [] })),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allParticipants: { id: string; apelido: string }[] = allParticipantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map(r => r.member_participant_id)
  const snapshotRows: { participant_id: string; rank: number; pts_total: number; snapshot_date: string }[] =
    snapshotRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: any[] = matchesRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Pontuação ao vivo (independe de participant_scores) ────────────────────
  const scoredMatches = allMatches.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.score_home !== null && m.score_away !== null,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredById = new Map<string, any>(scoredMatches.map((m: any) => [m.id, m]))

  // Distribuição de resultados por jogo → zebra
  const betsByMatch: Record<string, Array<{ score_home: number; score_away: number }>> = {}
  for (const b of allBetsRaw) {
    ;(betsByMatch[b.match_id] ??= []).push({ score_home: b.score_home, score_away: b.score_away })
  }
  const isZebraMatch: Record<string, boolean> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of scoredMatches as any[]) {
    const actual = getMatchResult(m.score_home, m.score_away)
    isZebraMatch[m.id] = detectMatchZebra(betsByMatch[m.id] ?? [], actual, zebraThreshold)
  }

  // Pontos de jogos por participante
  const ptsMatchesMap: Record<string, number> = {}
  for (const b of allBetsRaw) {
    const m = scoredById.get(b.match_id)
    if (!m) continue
    const pts = scoreMatchBet(
      b.score_home, b.score_away,
      m.score_home, m.score_away,
      isZebraMatch[b.match_id] ?? false,
      m.is_brazil ?? false,
      rules,
    )
    ptsMatchesMap[b.participant_id] = (ptsMatchesMap[b.participant_id] ?? 0) + pts
  }

  // ptsGroups (pontos já armazenados em group_bets.points)
  const ptsGroupsMap: Record<string, number> = {}
  for (const b of groupBetsRaw) {
    if (b.points != null) ptsGroupsMap[b.participant_id] = (ptsGroupsMap[b.participant_id] ?? 0) + b.points
  }

  // ptsThirds ao vivo (mesma fórmula da classificacaoMB)
  const thirdScoringEnabled = new Set<string>(
    ((thirdScoringRes.data ?? []) as { group_name: string; enabled: boolean }[])
      .filter(r => r.enabled)
      .map(r => r.group_name)
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gmsSlim: MatchSlim[] = (allMatches as any[])
    .filter((m: any) => m.phase === 'group' && m.group_name)
    .map((m: any) => ({ id: m.id, group_name: m.group_name, phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: m.flag_home ?? '', flag_away: m.flag_away ?? '' }))
  const officialScoreMap = new Map<string, BetSlim>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of scoredMatches as any[]) {
    officialScoreMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
  }
  const officialGroupStandings = calcGroupStandings(gmsSlim, officialScoreMap)

  // Resolver nomes reais para jogos eliminatórios (16avos, oitavas, etc.)
  const byGroupCompletion = new Map<string, { total: number; scored: number }>()
  for (const m of gmsSlim) {
    const e = byGroupCompletion.get(m.group_name!) ?? { total: 0, scored: 0 }
    e.total++
    if (officialScoreMap.has(m.id)) e.scored++
    byGroupCompletion.set(m.group_name!, e)
  }
  const completeGroupsSet = new Set<string>(
    [...byGroupCompletion.entries()].filter(([, v]) => v.total > 0 && v.scored === v.total).map(([k]) => k),
  )
  const allGroupsComplete = byGroupCompletion.size > 0 && completeGroupsSet.size === byGroupCompletion.size
  const knockoutThirds = rankThirds(officialGroupStandings)
  const knockoutThirdSlots = resolveThirdSlots(knockoutThirds)
  const knockoutR32Slots = buildR32Teams(officialGroupStandings, knockoutThirds, knockoutThirdSlots, undefined, completeGroupsSet, allGroupsComplete)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knockoutMatchesForMap = (allMatches as any[])
    .filter((m: any) => ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
    .map((m: any) => ({
      id: m.id as string, phase: m.phase as string, match_number: m.match_number as number,
      team_home: m.team_home as string, flag_home: (m.flag_home ?? '') as string,
      team_away: m.team_away as string, flag_away: (m.flag_away ?? '') as string,
      score_home: m.score_home as number | null, score_away: m.score_away as number | null,
      penalty_winner: m.penalty_winner as string | null,
    }))
  const knockoutTeamMap = buildKnockoutTeamMap(knockoutR32Slots, knockoutMatchesForMap)

  const actualThirdByGroup = new Map<string, string>()
  for (const standing of officialGroupStandings) {
    const g = standing.group
    if (!thirdScoringEnabled.has(g)) continue
    const groupMatchIds = gmsSlim.filter(m => m.group_name === g).map(m => m.id)
    if (!groupMatchIds.every(id => officialScoreMap.has(id))) continue
    const thirdTeam = standing.teams[2]?.team
    if (thirdTeam) actualThirdByGroup.set(g, thirdTeam)
  }
  const thirdPts = rules['terceiro_classificado'] ?? 3
  const ptsThirdsMap: Record<string, number> = {}
  for (const bet of (thirdBetsRaw as { participant_id: string; group_name: string; team: string }[])) {
    const actualThird = actualThirdByGroup.get(bet.group_name)
    if (actualThird && bet.team === actualThird)
      ptsThirdsMap[bet.participant_id] = (ptsThirdsMap[bet.participant_id] ?? 0) + thirdPts
  }

  // ptsG4 ao vivo (mesma fórmula da classificacaoMB/evolucao)
  const artillaryActive = artillarySettingRes?.data?.value === 'true'
  const scorerMapping: Record<string, string> = Object.fromEntries(
    ((scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string }[])
      .map(m => [m.raw_name.toLowerCase().trim(), m.standardized_name])
  )
  let officialScorers: string[] = []
  if (artillaryActive) {
    const topScorersData = (topScorersRes?.data ?? []) as { player_name: string; goals_count: number }[]
    if (topScorersData.length > 0 && topScorersData[0].goals_count > 0) {
      const maxGoals = topScorersData[0].goals_count
      officialScorers = topScorersData.filter(s => s.goals_count === maxGoals).map(s => s.player_name)
    }
  }
  // team_home/team_away crus ficam como placeholder ("Venc. Jogo N") até o fim do
  // torneio — por isso recebem home/away já resolvidos via knockoutTeamMap (mesmo
  // motor de chaveamento usado em classificacaoMB/recalculate.ts).
  function koWinner(
    m: { score_home: number | null; score_away: number | null; penalty_winner: string | null },
    home: string, away: string,
  ): string | null {
    if (m.score_home == null || m.score_away == null) return null
    if (m.score_home > m.score_away) return home
    if (m.score_away > m.score_home) return away
    return m.penalty_winner ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function resolveKo(m: any): { winner: string | null; loser: string | null } {
    const ov = knockoutTeamMap.get(m.id)
    const home = ov?.team_home || m.team_home
    const away = ov?.team_away || m.team_away
    const winner = koWinner(m, home, away)
    const loser  = winner ? (winner === home ? away : home) : null
    return { winner, loser }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const koDone = (allMatches as any[]).filter((m: any) => m.score_home !== null && ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qfDone  = koDone.filter((m: any) => m.phase === 'quarterfinal')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sfDone  = koDone.filter((m: any) => m.phase === 'semifinal')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finDone = koDone.filter((m: any) => m.phase === 'final')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tpDone  = koDone.filter((m: any) => m.phase === 'third_place')
  const semifinalists = qfDone.map((m: any) => resolveKo(m).winner).filter(Boolean) as string[]
  const finalists     = sfDone.map((m: any) => resolveKo(m).winner).filter(Boolean) as string[]
  const finResolved   = finDone.length > 0 ? resolveKo(finDone[0]) : null
  const tpResolved    = tpDone.length > 0  ? resolveKo(tpDone[0])  : null
  const champion      = finResolved?.winner ?? null
  const runnerUp      = finResolved?.loser  ?? null
  const third         = tpResolved?.winner  ?? null
  const fourth        = tpResolved?.loser   ?? null
  const allTBets = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string | null; runner_up: string | null
    semi1: string | null; semi2: string | null; top_scorer: string | null
  }[]
  const chamBetsWithPick = allTBets.filter(b => b.champion && b.champion === champion)
  const chamBetsTotal    = allTBets.filter(b => b.champion).length
  const isZebraChampion  = chamBetsTotal > 0 && champion !== null
    && (chamBetsWithPick.length / chamBetsTotal) * 100 <= zebraThreshold
  const tournamentResults = { semifinalists, finalists, champion, runnerUp, third, fourth, officialScorers }
  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: artillaryActive ? (tb.top_scorer ?? '') : '',
      },
      tournamentResults,
      rules,
      isZebraChampion,
      scorerMapping,
    )
  }

  // ── Ranking completo ────────────────────────────────────────────────────────
  const sortedParticipants = allParticipants
    .map(p => ({
      id: p.id,
      apelido: p.apelido,
      ptsTotal:
        (ptsMatchesMap[p.id] ?? 0) +
        (ptsGroupsMap[p.id]  ?? 0) +
        (ptsThirdsMap[p.id]  ?? 0) +
        (ptsG4Map[p.id]      ?? 0),
    }))
    .sort((a, b) => b.ptsTotal - a.ptsTotal)

  const allRanked: { id: string; apelido: string; ptsTotal: number; rank: number }[] = []
  for (let i = 0; i < sortedParticipants.length; i++) {
    const rank =
      i > 0 && sortedParticipants[i].ptsTotal === sortedParticipants[i - 1].ptsTotal
        ? allRanked[i - 1].rank
        : i + 1
    allRanked.push({ ...sortedParticipants[i], rank })
  }

  // ── Snapshot mais recente por participante ──────────────────────────────────
  const latestDate = snapshotRows.length > 0 ? snapshotRows[0].snapshot_date : null
  const snapshotByPid: Record<string, { rank: number; pts_total: number }> = {}
  if (latestDate) {
    for (const s of snapshotRows) {
      if (s.snapshot_date === latestDate && !snapshotByPid[s.participant_id]) {
        snapshotByPid[s.participant_id] = { rank: s.rank, pts_total: s.pts_total }
      }
    }
  }

  // ── Jogos recentes (com resultado) e próximos (prazo encerrado) ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedMatches = allMatches.filter((m: any) => m.score_home !== null && m.score_away !== null)
  const recentMatches = completedMatches.slice(-10)

  const upcomingMatches = allMatches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) =>
      m.score_home === null &&
      m.score_away === null &&
      new Date(m.betting_deadline) < now,
    )
    .slice(0, 10)

  // ── Palpites para os jogos exibidos ────────────────────────────────────────
  const relevantMatchIds = new Set([...recentMatches, ...upcomingMatches].map((m: any) => m.id))

  const betsByParticipant: Record<string, Record<string, {
    scoreHome: number; scoreAway: number; points: number | null
  }>> = {}

  for (const b of allBetsRaw) {
    if (!relevantMatchIds.has(b.match_id)) continue
    const m = scoredById.get(b.match_id)
    const pts = m
      ? scoreMatchBet(
          b.score_home, b.score_away,
          m.score_home, m.score_away,
          isZebraMatch[b.match_id] ?? false,
          m.is_brazil ?? false,
          rules,
        )
      : null  // jogo ainda não realizado
    ;(betsByParticipant[b.participant_id] ??= {})[b.match_id] = {
      scoreHome: b.score_home,
      scoreAway: b.score_away,
      points: pts,
    }
  }

  return (
    <>
      <Navbar />
      <PanelaClient
        allParticipants={allParticipants}
        currentParticipantId={participantId}
        initialPanelaIds={panelaIds}
        allRanked={allRanked}
        snapshotByPid={snapshotByPid}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recentMatches={recentMatches.map((m: any) => {
          const ov = knockoutTeamMap.get(m.id)
          return {
            id:            m.id,
            teamHome:      ov?.team_home ?? m.team_home,
            teamAway:      ov?.team_away ?? m.team_away,
            flagHome:      ov?.flag_home ?? m.flag_home  ?? '',
            flagAway:      ov?.flag_away ?? m.flag_away  ?? '',
            matchDatetime: m.match_datetime,
            scoreHome:     m.score_home,
            scoreAway:     m.score_away,
          }
        })}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        upcomingMatches={upcomingMatches.map((m: any) => {
          const ov = knockoutTeamMap.get(m.id)
          return {
            id:            m.id,
            teamHome:      ov?.team_home ?? m.team_home,
            teamAway:      ov?.team_away ?? m.team_away,
            flagHome:      ov?.flag_home ?? m.flag_home  ?? '',
            flagAway:      ov?.flag_away ?? m.flag_away  ?? '',
            matchDatetime: m.match_datetime,
          }
        })}
        betsByParticipant={betsByParticipant}
      />
    </>
  )
}
