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

async function loadRules(): Promise<RuleMap> {
  const admin = createAuthAdminClient()
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

// ── Match bets ────────────────────────────────────────────────────────────────

export async function recalculateMatchBets(matchId: string): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules()

  const { data: match } = await admin
    .from('matches')
    .select('id, score_home, score_away, is_brazil')
    .eq('id', matchId)
    .single()

  if (!match || match.score_home === null || match.score_away === null) return

  const { data: bets } = await admin
    .from('bets')
    .select('id, participant_id, score_home, score_away')
    .eq('match_id', matchId)

  if (!bets?.length) return

  const actualResult = getMatchResult(match.score_home, match.score_away)
  const threshold    = rules['percentual_zebra'] ?? 15
  const isZebra      = detectMatchZebra(
    bets as { score_home: number; score_away: number }[],
    actualResult,
    threshold,
  )

  await Promise.all(
    bets.map(bet =>
      admin.from('bets').update({
        points: scoreMatchBet(
          bet.score_home, bet.score_away,
          match.score_home!, match.score_away!,
          isZebra, match.is_brazil, rules,
        ),
      }).eq('id', bet.id)
    )
  )

  await refreshParticipantTotals([...new Set(bets.map(b => b.participant_id))])
}

// ── Group bets ────────────────────────────────────────────────────────────────

export async function recalculateGroupBets(groupName: string): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules()

  const { data: groupMatches } = await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')
    .eq('group_name', groupName)

  if (!groupMatches?.length) return
  if (!groupMatches.every(m => m.score_home !== null && m.score_away !== null)) return

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
  const standings    = calcGroupStandings(slimMatches, betMap)
  const groupStanding = standings.find(s => s.group === groupName)
  if (!groupStanding || groupStanding.teams.length < 2) return

  const actual1st = groupStanding.teams[0].team
  const actual2nd = groupStanding.teams[1].team

  const { data: groupBets } = await admin
    .from('group_bets')
    .select('id, participant_id, first_place, second_place')
    .eq('group_name', groupName)

  if (!groupBets?.length) return

  const threshold = rules['percentual_zebra'] ?? 15
  const isZebra1  = detectGroupZebra(
    groupBets.map(b => ({ first_place: b.first_place })),
    actual1st,
    threshold,
  )

  await Promise.all(
    groupBets.map(bet =>
      admin.from('group_bets').update({
        points: scoreGroupBet(
          bet.first_place, bet.second_place,
          actual1st, actual2nd,
          isZebra1, rules,
        ),
      }).eq('id', bet.id)
    )
  )

  await refreshParticipantTotals([...new Set(groupBets.map(b => b.participant_id))])
}

// ── Third-place bets ──────────────────────────────────────────────────────────

export async function recalculateThirdBets(): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules()

  const { data: groupMatches } = await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away, score_home, score_away')
    .eq('phase', 'group')

  if (!groupMatches?.length) return
  if (!groupMatches.every(m => m.score_home !== null && m.score_away !== null)) return

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

  if (!thirdBets?.length) return

  const thirdPts = rules['terceiro_classificado'] ?? 3

  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (thirdBets as any[]).map((bet: any) => {
      const actual = thirds.find(t => t.group === bet.group_name)
      const pts    = (actual?.advances && actual.team === bet.team) ? thirdPts : 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (admin as any).from('third_place_bets').update({ points: pts }).eq('id', bet.id)
    })
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await refreshParticipantTotals([...new Set((thirdBets as any[]).map((b: any) => b.participant_id))])
}

// ── Tournament bets ───────────────────────────────────────────────────────────

export async function recalculateTournamentBets(): Promise<void> {
  const admin = createAuthAdminClient()
  const rules = await loadRules()

  // Determine actual tournament results from knockout match data
  const { data: knockoutMatches } = await admin
    .from('matches')
    .select('id, phase, team_home, team_away, score_home, score_away, penalty_winner, match_number')
    .in('phase', ['quarterfinal', 'semifinal', 'third_place', 'final'])
    .order('match_number', { ascending: true })

  if (!knockoutMatches) return

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

  // Official top scorer(s) from tournament_settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scorerSetting } = await (admin as any)
    .from('tournament_settings')
    .select('value')
    .eq('key', 'official_top_scorer')
    .maybeSingle()
    .catch(() => ({ data: null }))

  if (scorerSetting?.value) {
    try { results.officialScorers = JSON.parse(scorerSetting.value) }
    catch { results.officialScorers = [scorerSetting.value] }
  }

  // Top-scorer name mapping (raw → standardized)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mappingRows } = await (admin as any)
    .from('top_scorer_mapping')
    .select('raw_name, standardized_name')
    .catch(() => ({ data: [] }))

  const scorerMapping: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((mappingRows ?? []) as any[]).map((m: any) => [m.raw_name, m.standardized_name])
  )

  const { data: tournamentBets } = await admin
    .from('tournament_bets')
    .select('id, participant_id, champion, runner_up, semi1, semi2, top_scorer')

  if (!tournamentBets?.length) return

  // Zebra for champion prediction
  const threshold = rules['percentual_zebra'] ?? 15
  const isZebraChampion = results.champion
    ? tournamentBets.length > 0 &&
      (tournamentBets.filter(b => b.champion === results.champion).length / tournamentBets.length) * 100 <= threshold
    : false

  await Promise.all(
    tournamentBets.map(bet =>
      admin.from('tournament_bets').update({
        points: scoreTournamentBet(
          { champion: bet.champion, runner_up: bet.runner_up, semi1: bet.semi1, semi2: bet.semi2, top_scorer: bet.top_scorer },
          results, rules, isZebraChampion, scorerMapping,
        ),
      }).eq('id', bet.id)
    )
  )

  await refreshParticipantTotals([...new Set(tournamentBets.map(b => b.participant_id))])
}

// ── Participant total ─────────────────────────────────────────────────────────

export async function refreshParticipantTotals(participantIds: string[]): Promise<void> {
  if (!participantIds.length) return
  const admin = createAuthAdminClient()

  await Promise.all(participantIds.map(async pid => {
    const [bRes, gRes, tpRes, tbRes] = await Promise.all([
      admin.from('bets').select('points').eq('participant_id', pid),
      admin.from('group_bets').select('points').eq('participant_id', pid),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from('third_place_bets').select('points').eq('participant_id', pid),
      admin.from('tournament_bets').select('points').eq('participant_id', pid).maybeSingle(),
    ])

    const sum = (rows: { points: number | null }[] | null) =>
      (rows ?? []).reduce((acc, r) => acc + (r.points ?? 0), 0)

    const ptsMatches    = sum(bRes.data)
    const ptsGroups     = sum(gRes.data)
    const ptsThirds     = sum(tpRes.data)
    const ptsTournament = tbRes.data?.points ?? 0
    const ptsTotal      = ptsMatches + ptsGroups + ptsThirds + ptsTournament

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('participant_scores').upsert(
      { participant_id: pid, pts_matches: ptsMatches, pts_groups: ptsGroups, pts_thirds: ptsThirds, pts_tournament: ptsTournament, pts_total: ptsTotal, updated_at: new Date().toISOString() },
      { onConflict: 'participant_id' },
    )
  }))
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
    // Check if group is now fully scored
    await recalculateGroupBets(match.group_name)
    // Check if ALL group matches are done → score thirds
    await recalculateThirdBets()
  }

  if (KNOCKOUT_SCORING_PHASES.has(match.phase)) {
    await recalculateTournamentBets()
  }
}

// ── Full recalculation (admin reset) ─────────────────────────────────────────

export async function recalculateAll(): Promise<void> {
  const admin = createAuthAdminClient()

  // All scored matches
  const { data: scoredMatches } = await admin
    .from('matches')
    .select('id, phase, group_name')
    .not('score_home', 'is', null)

  if (!scoredMatches?.length) return

  // 1. Match bets for every scored match (parallelized in batches of 8)
  for (let i = 0; i < scoredMatches.length; i += 8) {
    await Promise.all(
      scoredMatches.slice(i, i + 8).map(m => recalculateMatchBets(m.id))
    )
  }

  // 2. Group bets for each unique group that's fully scored
  const groups = [...new Set(
    scoredMatches.filter(m => m.phase === 'group' && m.group_name).map(m => m.group_name as string)
  )]
  await Promise.all(groups.map(g => recalculateGroupBets(g)))

  // 3. Thirds (fires only when all 72 group matches are scored internally)
  await recalculateThirdBets()

  // 4. Tournament
  await recalculateTournamentBets()
}
