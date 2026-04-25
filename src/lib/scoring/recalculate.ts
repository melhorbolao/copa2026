// DB-aware recalculation logic.
// All functions use the service-role admin client and are server-only.

import { createAuthAdminClient } from '@/lib/supabase/server'
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

// ── Internal: update points without refreshing totals ─────────────────────────
// These return the participant IDs they touched, so the caller can batch-refresh.

async function _updateMatchBetPoints(matchId: string, admin: AdminClient, rules: RuleMap): Promise<string[]> {
  const { data: match } = await admin
    .from('matches')
    .select('id, score_home, score_away, is_brazil')
    .eq('id', matchId)
    .single()

  if (!match || match.score_home === null || match.score_away === null) return []

  const { data: bets } = await admin
    .from('bets')
    .select('id, participant_id, score_home, score_away')
    .eq('match_id', matchId)

  if (!bets?.length) return []

  const actualResult = getMatchResult(match.score_home, match.score_away)
  const threshold    = rules['percentual_zebra'] ?? 15
  const isZebra      = detectMatchZebra(
    bets as { score_home: number; score_away: number }[],
    actualResult,
    threshold,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('bets').upsert(
    bets.map(bet => ({
      id: bet.id,
      points: scoreMatchBet(
        bet.score_home, bet.score_away,
        match.score_home!, match.score_away!,
        isZebra, match.is_brazil, rules,
      ),
    })),
    { onConflict: 'id' },
  )

  return [...new Set(bets.map(b => b.participant_id))]
}

async function _updateGroupBetPoints(groupName: string, admin: AdminClient, rules: RuleMap): Promise<string[]> {
  const { data: groupMatches } = await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')
    .eq('group_name', groupName)

  if (!groupMatches?.length) return []
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
      id: bet.id,
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

async function _updateThirdBetPoints(admin: AdminClient, rules: RuleMap): Promise<string[]> {
  const { data: groupMatches } = await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')

  if (!groupMatches?.length) return []
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
  const standings = calcGroupStandings(slimMatches, betMap)
  const thirds    = rankThirds(standings)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thirdBets } = await (admin as any)
    .from('third_place_bets')
    .select('id, participant_id, group_name, team')

  if (!thirdBets?.length) return []

  const thirdPts = rules['terceiro_classificado'] ?? 3

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('third_place_bets').upsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (thirdBets as any[]).map((bet: any) => {
      const actual = thirds.find(t => t.group === bet.group_name)
      const pts    = (actual?.advances && actual.team === bet.team) ? thirdPts : 0
      return { id: bet.id, points: pts }
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
    ((mappingRows ?? []) as any[]).map((m: any) => [m.raw_name, m.standardized_name])
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
      id: bet.id,
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

  const [bRes, gRes, tpRes, tbRes] = await Promise.all([
    admin.from('bets').select('participant_id, points').in('participant_id', participantIds),
    admin.from('group_bets').select('participant_id, points').in('participant_id', participantIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from('third_place_bets').select('participant_id, points').in('participant_id', participantIds),
    admin.from('tournament_bets').select('participant_id, points').in('participant_id', participantIds),
  ])

  const sumFor = (rows: { participant_id: string; points: number | null }[] | null, pid: string) =>
    (rows ?? []).filter(r => r.participant_id === pid).reduce((acc, r) => acc + (r.points ?? 0), 0)

  const now = new Date().toISOString()
  const scores = participantIds.map(pid => {
    const ptsMatches    = sumFor(bRes.data as { participant_id: string; points: number | null }[] | null, pid)
    const ptsGroups     = sumFor(gRes.data as { participant_id: string; points: number | null }[] | null, pid)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ptsThirds     = sumFor(tpRes.data as any, pid)
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

export async function recalculateAfterMatchScore(matchId: string): Promise<void> {
  const admin = createAuthAdminClient()

  const { data: match } = await admin
    .from('matches')
    .select('id, phase, group_name, score_home, score_away')
    .eq('id', matchId)
    .single()

  if (!match || match.score_home === null || match.score_away === null) return

  await recalculateMatchBets(matchId)

  if (match.phase === 'group' && match.group_name) {
    await recalculateGroupBets(match.group_name)
    await recalculateThirdBets()
  }

  if (KNOCKOUT_SCORING_PHASES.has(match.phase)) {
    await recalculateTournamentBets()
  }
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

  // 3. Third-place bets (fires only when all group matches are scored internally)
  const thirdIds = await _updateThirdBetPoints(admin, rules)
  thirdIds.forEach(id => allIds.add(id))

  // 4. Tournament bets
  const tournamentIds = await _updateTournamentBetPoints(admin, rules)
  tournamentIds.forEach(id => allIds.add(id))

  // 5. Refresh participant totals once for all affected participants
  await refreshParticipantTotals([...allIds])
}
