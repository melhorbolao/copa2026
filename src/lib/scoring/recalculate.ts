// DB-aware recalculation logic.
// All functions use the service-role admin client and are server-only.

import { createAuthAdminClient } from '@/lib/supabase/server'
import { recalculateDailyPoints } from './daily-points'
import { calcGroupStandings, rankThirds } from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'
import {
  scoreMatchBet,
  scoreGroupBet,
  scoreTournamentBet,
  detectMatchZebra,
  detectGroupZebra,
  getMatchResult,
  type RuleMap,
  type TournamentResults,
} from './engine'

// ── Helpers ───────────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAuthAdminClient>

async function loadRules(admin: AdminClient): Promise<RuleMap> {
  const { data } = await admin.from('scoring_rules').select('key, points')
  return Object.fromEntries((data ?? []).map(r => [r.key, r.points]))
}

function matchWinner(
  m: { team_home: string; team_away: string; score_home: number | null; score_away: number | null; penalty_winner: string | null },
): string | null {
  if (m.score_home === null || m.score_away === null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  return m.penalty_winner ?? null
}

// ── Shared types for pre-loaded data ─────────────────────────────────────────

interface GroupMatchRow {
  id: string; group_name: string | null; phase: string
  team_home: string; team_away: string; flag_home: string; flag_away: string
  score_home: number | null; score_away: number | null
}

interface MatchScoreRow {
  id: string; score_home: number | null; score_away: number | null
  is_brazil: boolean; team_home: string; team_away: string
}

// ── Internal: update points without refreshing totals ─────────────────────────
// These return the participant IDs they touched, so the caller can batch-refresh.

async function _updateMatchBetPoints(
  matchId: string,
  admin: AdminClient,
  rules: RuleMap,
  isBrazilOverride?: boolean,
  preloadedMatch?: MatchScoreRow,
): Promise<string[]> {
  const match: MatchScoreRow | null = preloadedMatch ?? (await admin
    .from('matches')
    .select('id, score_home, score_away, is_brazil, team_home, team_away')
    .eq('id', matchId)
    .single()).data

  if (!match || match.score_home === null || match.score_away === null) {
    // Placar removido — limpa pontos residuais para não contaminar a TabelaMB
    await (admin as any).from('bets').update({ points: null }).eq('match_id', matchId)
    return []
  }

  const { data: bets } = await admin
    .from('bets')
    .select('id, participant_id, score_home, score_away')
    .eq('match_id', matchId)

  if (!bets?.length) return []

  // is_brazil pode estar desatualizado no DB para jogos de mata-mata inseridos com 'TBD'.
  // isBrazilOverride é passado pelo cliente quando ele conhece o time real (via TeamOverride do chaveamento).
  const isBrazil = isBrazilOverride ?? (match.is_brazil || match.team_home === 'Brasil' || match.team_away === 'Brasil')

  const actualResult = getMatchResult(match.score_home, match.score_away)
  const threshold    = rules['percentual_zebra'] ?? 15
  const isZebra      = detectMatchZebra(
    bets as { score_home: number; score_away: number }[],
    actualResult,
    threshold,
  )

  // Inclui todos os campos NOT NULL para o upsert funcionar corretamente
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertErr } = await (admin as any).from('bets').upsert(
    bets.map(bet => ({
      id:             bet.id,
      match_id:       matchId,
      participant_id: bet.participant_id,
      score_home:     bet.score_home,
      score_away:     bet.score_away,
      points: scoreMatchBet(
        bet.score_home, bet.score_away,
        match.score_home!, match.score_away!,
        isZebra, isBrazil, rules,
      ),
    })),
    { onConflict: 'id' },
  )
  if (upsertErr) throw new Error(`bets upsert (match ${matchId}): ${upsertErr.message}`)

  return [...new Set(bets.map(b => b.participant_id))]
}

async function _updateGroupBetPoints(
  groupName: string,
  admin: AdminClient,
  rules: RuleMap,
  preloadedGroupMatches?: GroupMatchRow[],
): Promise<string[]> {
  const groupMatches = preloadedGroupMatches
    ? preloadedGroupMatches.filter(m => m.group_name === groupName)
    : (await admin
        .from('matches')
        .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
        .eq('phase', 'group')
        .eq('group_name', groupName)).data ?? []

  if (!groupMatches.length) return []
  if (!groupMatches.every(m => m.score_home !== null && m.score_away !== null)) return []

  const slimMatches: MatchSlim[] = groupMatches.map(m => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home, flag_away: m.flag_away,
  }))
  const betMap = new Map<string, BetSlim>(
    groupMatches.map(m => [
      m.id,
      { match_id: m.id, score_home: m.score_home!, score_away: m.score_away! },
    ])
  )
  const standings     = calcGroupStandings(slimMatches, betMap)
  const groupStanding = standings.find(s => s.group === groupName)
  if (!groupStanding || groupStanding.teams.length < 2) return []

  const actual1st = groupStanding.teams[0].team
  const actual2nd = groupStanding.teams[1].team

  const { data: groupBets } = await admin
    .from('group_bets')
    .select('id, participant_id, first_place, second_place')
    .eq('group_name', groupName)

  if (!groupBets?.length) return []

  const threshold = rules['percentual_zebra'] ?? 15
  const isZebra1  = detectGroupZebra(
    groupBets.map(b => ({ first_place: b.first_place })),
    actual1st,
    threshold,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('group_bets').upsert(
    groupBets.map(bet => ({
      id:             bet.id,
      participant_id: bet.participant_id,
      group_name:     groupName,
      first_place:    bet.first_place,
      second_place:   bet.second_place,
      points: scoreGroupBet(
        bet.first_place, bet.second_place,
        actual1st, actual2nd,
        isZebra1, rules,
      ),
    })),
    { onConflict: 'id' },
  )

  return [...new Set(groupBets.map(b => b.participant_id))]
}

async function _updateThirdBetPoints(
  admin: AdminClient,
  rules: RuleMap,
  preloadedGroupMatches?: GroupMatchRow[],
): Promise<string[]> {
  const groupMatches: GroupMatchRow[] = preloadedGroupMatches ?? (await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')).data ?? []

  if (!groupMatches.length) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thirdBets } = await (admin as any)
    .from('third_place_bets')
    .select('id, participant_id, group_name, team')

  if (!thirdBets?.length) return []

  const zeroAll = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('third_place_bets').upsert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (thirdBets as any[]).map((bet: any) => ({
        id: bet.id, participant_id: bet.participant_id,
        group_name: bet.group_name, team: bet.team, points: 0,
      })),
      { onConflict: 'id' },
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return [...new Set((thirdBets as any[]).map((b: any) => b.participant_id as string))]
  }

  // Só pontua terceiros quando TODOS os jogos de grupo têm placar.
  // Antes disso é impossível saber quais 8 thirds avançam — zera tudo.
  if (!groupMatches.every(m => m.score_home !== null && m.score_away !== null)) {
    return zeroAll()
  }

  // Todos os grupos completos: calcula os 8 melhores thirds diretamente via rankThirds.
  // Não depende de third_place_scoring para decidir quem pontua.
  const slim: MatchSlim[] = groupMatches.map(m => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home, flag_away: m.flag_away,
  }))
  const betMap = new Map<string, BetSlim>(
    groupMatches.map(m => [m.id, { match_id: m.id, score_home: m.score_home!, score_away: m.score_away! }])
  )
  const standings = calcGroupStandings(slim, betMap)
  const thirds    = rankThirds(standings)

  // Mapa grupo → time que é o 3º colocado REAL e avança entre os 8 melhores
  const actualThirdByGroup = new Map<string, string>(
    thirds.filter(t => t.advances).map(t => [t.group, t.team])
  )

  const thirdPts = rules['terceiro_classificado'] ?? 3

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('third_place_bets').upsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (thirdBets as any[]).map((bet: any) => {
      const actualThird = actualThirdByGroup.get(bet.group_name)
      const pts = (actualThird && actualThird === bet.team) ? thirdPts : 0
      return {
        id:             bet.id,
        participant_id: bet.participant_id,
        group_name:     bet.group_name,
        team:           bet.team,
        points:         pts,
      }
    }),
    { onConflict: 'id' },
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return [...new Set((thirdBets as any[]).map((b: any) => b.participant_id as string))]
}

async function _updateTournamentBetPoints(admin: AdminClient, rules: RuleMap): Promise<string[]> {
  const { data: knockoutMatches } = await admin
    .from('matches')
    .select('id, phase, team_home, team_away, score_home, score_away, penalty_winner, match_number')
    .in('phase', ['quarterfinal', 'semifinal', 'third_place', 'final'])
    .order('match_number', { ascending: true })

  if (!knockoutMatches) return []

  const results: TournamentResults = {
    semifinalists:   [],
    finalists:       [],
    champion:        null,
    runnerUp:        null,
    third:           null,
    fourth:          null,
    officialScorers: [],
  }

  for (const m of knockoutMatches.filter(m => m.phase === 'quarterfinal')) {
    const w = matchWinner(m)
    if (w) results.semifinalists.push(w)
  }
  for (const m of knockoutMatches.filter(m => m.phase === 'semifinal')) {
    const w = matchWinner(m)
    if (w) results.finalists.push(w)
  }
  const thirdMatch = knockoutMatches.find(m => m.phase === 'third_place')
  if (thirdMatch) {
    results.third  = matchWinner(thirdMatch)
    const w = matchWinner(thirdMatch)
    results.fourth = w ? (w === thirdMatch.team_home ? thirdMatch.team_away : thirdMatch.team_home) : null
  }
  const finalMatch = knockoutMatches.find(m => m.phase === 'final')
  if (finalMatch) {
    results.champion = matchWinner(finalMatch)
    const w = matchWinner(finalMatch)
    results.runnerUp = w ? (w === finalMatch.team_home ? finalMatch.team_away : finalMatch.team_home) : null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scorerSetting } = await (admin as any)
    .from('tournament_settings')
    .select('value')
    .eq('key', 'official_top_scorer')
    .maybeSingle()
    .then((r: any) => r, () => ({ data: null }))

  if (scorerSetting?.value) {
    try { results.officialScorers = JSON.parse(scorerSetting.value) }
    catch { results.officialScorers = [scorerSetting.value] }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mappingRows } = await (admin as any)
    .from('top_scorer_mapping')
    .select('raw_name, standardized_name')
    .then((r: any) => r, () => ({ data: [] }))

  const scorerMapping: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((mappingRows ?? []) as any[]).map((m: any) => [m.raw_name.toLowerCase().trim(), m.standardized_name])
  )

  const { data: tournamentBets } = await admin
    .from('tournament_bets')
    .select('id, participant_id, champion, runner_up, semi1, semi2, top_scorer')

  if (!tournamentBets?.length) return []

  const threshold = rules['percentual_zebra'] ?? 15
  const isZebraChampion = results.champion
    ? tournamentBets.length > 0 &&
      (tournamentBets.filter(b => b.champion === results.champion).length / tournamentBets.length) * 100 <= threshold
    : false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('tournament_bets').upsert(
    tournamentBets.map(bet => ({
      id:             bet.id,
      participant_id: bet.participant_id,
      champion:       bet.champion,
      runner_up:      bet.runner_up,
      semi1:          bet.semi1,
      semi2:          bet.semi2,
      top_scorer:     bet.top_scorer,
      points: scoreTournamentBet(
        { champion: bet.champion, runner_up: bet.runner_up, semi1: bet.semi1, semi2: bet.semi2, top_scorer: bet.top_scorer },
        results, rules, isZebraChampion, scorerMapping,
      ),
    })),
    { onConflict: 'id' },
  )

  return [...new Set(tournamentBets.map(b => b.participant_id))]
}

// ── Match bets (public: updates + refreshes totals) ───────────────────────────

export async function recalculateMatchBets(matchId: string): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules(admin)
  const ids   = await _updateMatchBetPoints(matchId, admin, rules)
  await refreshParticipantTotals(ids)
}

// ── Group bets ────────────────────────────────────────────────────────────────

export async function recalculateGroupBets(groupName: string): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules(admin)
  const ids   = await _updateGroupBetPoints(groupName, admin, rules)
  await refreshParticipantTotals(ids)
}

// ── Third-place bets ──────────────────────────────────────────────────────────

export async function recalculateThirdBets(): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules(admin)
  const ids   = await _updateThirdBetPoints(admin, rules)
  await refreshParticipantTotals(ids)
}

/** Habilita apenas os 8 grupos cujos terceiros avançam (Art. 13 FIFA).
 *  Chamado automaticamente quando todos os jogos da fase de grupos têm placar. */
export async function autoEnableAllThirdScoring(preloadedGroupMatches?: GroupMatchRow[]): Promise<void> {
  const admin = createAuthAdminClient()

  const groupMatches: GroupMatchRow[] = preloadedGroupMatches ?? (await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')).data ?? []

  if (!groupMatches.length) return
  if (!groupMatches.every(m => m.score_home !== null && m.score_away !== null)) return

  const slim: MatchSlim[] = groupMatches.map(m => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home, flag_away: m.flag_away,
  }))
  const betMap = new Map<string, BetSlim>(
    groupMatches.map(m => [m.id, { match_id: m.id, score_home: m.score_home!, score_away: m.score_away! }])
  )
  const standings = calcGroupStandings(slim, betMap)
  const thirds    = rankThirds(standings)
  const advancing = new Set(thirds.filter(t => t.advances).map(t => t.group))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('third_place_scoring').upsert(
    ['A','B','C','D','E','F','G','H','I','J','K','L'].map(g => ({
      group_name: g,
      enabled: advancing.has(g),
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'group_name' },
  )
}

// ── Tournament bets ───────────────────────────────────────────────────────────

export async function recalculateTournamentBets(): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules(admin)
  const ids   = await _updateTournamentBetPoints(admin, rules)
  await refreshParticipantTotals(ids)
}

// ── Participant total ─────────────────────────────────────────────────────────
// Bulk fetch all participants at once → 4 reads + 1 upsert (vs 5N before).

export async function refreshParticipantTotals(participantIds: string[]): Promise<void> {
  if (!participantIds.length) return
  const admin = createAuthAdminClient()

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchFiltered(table: string, select: string): Promise<{ participant_id: string; points: number | null }[]> {
    const PAGE = 1000
    const rows: { participant_id: string; points: number | null }[] = []
    let from = 0
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).from(table).select(select).in('participant_id', participantIds).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [bRows, gRows, tpRows, tbRes] = await Promise.all([
    fetchFiltered('bets', 'participant_id, points'),
    fetchFiltered('group_bets', 'participant_id, points'),
    fetchFiltered('third_place_bets', 'participant_id, points'),
    admin.from('tournament_bets').select('participant_id, points').in('participant_id', participantIds),
  ])

  const sumFor = (rows: { participant_id: string; points: number | null }[] | null, pid: string) =>
    (rows ?? []).filter(r => r.participant_id === pid).reduce((acc, r) => acc + (r.points ?? 0), 0)

  const now = new Date().toISOString()
  const scores = participantIds.map(pid => {
    const ptsMatches    = sumFor(bRows, pid)
    const ptsGroups     = sumFor(gRows, pid)
    const ptsThirds     = sumFor(tpRows, pid)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ptsTournament = ((tbRes.data ?? []) as any[]).find((r: any) => r.participant_id === pid)?.points ?? 0
    const ptsTotal      = ptsMatches + ptsGroups + ptsThirds + ptsTournament
    return { participant_id: pid, pts_matches: ptsMatches, pts_groups: ptsGroups, pts_thirds: ptsThirds, pts_tournament: ptsTournament, pts_total: ptsTotal, updated_at: now }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('participant_scores').upsert(scores, { onConflict: 'participant_id' })
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

const KNOCKOUT_SCORING_PHASES = new Set(['quarterfinal', 'semifinal', 'third_place', 'final'])

export async function recalculateAfterMatchScore(matchId: string, isBrazilOverride?: boolean): Promise<void> {
  const admin = createAuthAdminClient()

  // Parallel: match (com todos os campos) + regras de pontuação
  const [matchRes, rules] = await Promise.all([
    (admin as any)
      .from('matches')
      .select('id, phase, group_name, score_home, score_away, is_brazil, team_home, team_away')
      .eq('id', matchId)
      .single() as Promise<{ data: (MatchScoreRow & { phase: string; group_name: string | null }) | null }>,
    loadRules(admin),
  ])

  const match = matchRes.data
  if (!match || match.score_home === null || match.score_away === null) return

  const allIds = new Set<string>()

  // Match bets — passa o match já carregado, evita re-fetch
  ;(await _updateMatchBetPoints(matchId, admin, rules, isBrazilOverride, match)).forEach(id => allIds.add(id))

  if (match.phase === 'group' && match.group_name) {
    // Busca todos os jogos de grupo UMA vez — reutilizado por group bets, third bets e auto-enable
    const { data: gmData } = await (admin as any)
      .from('matches')
      .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
      .eq('phase', 'group')
    const gm: GroupMatchRow[] = gmData ?? []
    const allGroupsComplete = gm.length > 0 && gm.every((m: GroupMatchRow) => m.score_home !== null && m.score_away !== null)

    // Group bets + third-place bets: tabelas independentes — roda em paralelo
    const [groupIds, thirdIds] = await Promise.all([
      _updateGroupBetPoints(match.group_name, admin, rules, gm),
      _updateThirdBetPoints(admin, rules, gm),
    ])
    groupIds.forEach(id => allIds.add(id))
    thirdIds.forEach(id => allIds.add(id))

    if (allGroupsComplete) await autoEnableAllThirdScoring(gm)
  }

  if (KNOCKOUT_SCORING_PHASES.has(match.phase)) {
    ;(await _updateTournamentBetPoints(admin, rules)).forEach(id => allIds.add(id))
  }

  // Único upsert em lote → único disparo do trigger → único REFRESH da MV
  await refreshParticipantTotals([...allIds])

  // Reconstrói participant_points_by_day em background — não bloqueia o save.
  const todayBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(new Date())
  recalculateDailyPoints({ upToDate: todayBR })
    .catch(e => console.error('[scoring/daily-points]', e))
}

// ── Full recalculation (admin reset) ─────────────────────────────────────────
// Optimised: loads rules once, bulk upserts, single refreshParticipantTotals at the end.

export async function recalculateAll(): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules(admin)

  const { data: scoredMatches } = await admin
    .from('matches')
    .select('id, phase, group_name')
    .not('score_home', 'is', null)

  if (!scoredMatches?.length) return

  const allIds = new Set<string>()

  // 1. Match bets (batches of 8 to avoid connection saturation)
  for (let i = 0; i < scoredMatches.length; i += 8) {
    const results = await Promise.all(
      scoredMatches.slice(i, i + 8).map(m => _updateMatchBetPoints(m.id, admin, rules))
    )
    results.flat().forEach(id => allIds.add(id))
  }

  // 2. Group bets — only groups with at least one scored match
  const groups = [...new Set(
    scoredMatches.filter(m => m.phase === 'group' && m.group_name).map(m => m.group_name as string)
  )]
  const groupResults = await Promise.all(groups.map(g => _updateGroupBetPoints(g, admin, rules)))
  groupResults.flat().forEach(id => allIds.add(id))

  // 3. Third-place bets — auto-enable se todos os jogos de grupo estão pontuados
  const { data: allGroupMatches } = await admin
    .from('matches')
    .select('score_home, score_away')
    .eq('phase', 'group')
  const allGroupsComplete =
    (allGroupMatches?.length ?? 0) > 0 &&
    allGroupMatches!.every(m => m.score_home !== null && m.score_away !== null)
  if (allGroupsComplete) await autoEnableAllThirdScoring()
  const thirdIds = await _updateThirdBetPoints(admin, rules)
  thirdIds.forEach(id => allIds.add(id))

  // 4. Tournament bets
  const tournamentIds = await _updateTournamentBetPoints(admin, rules)
  tournamentIds.forEach(id => allIds.add(id))

  // 5. Refresh participant totals once for all affected participants
  await refreshParticipantTotals([...allIds])

  // 6. Rebuild event-driven daily points history
  await recalculateDailyPoints()
}
