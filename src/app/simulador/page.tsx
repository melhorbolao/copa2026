export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { SimuladorClient } from './SimuladorClient'
import {
  getMatchResult, detectMatchZebra, scoreMatchBet, scoreTournamentBet,
} from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'

export const metadata = {}

function knockoutWinner(m: {
  team_home: string; team_away: string
  score_home: number | null; score_away: number | null
  penalty_winner: string | null
}): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  if (m.penalty_winner === 'H') return m.team_home
  if (m.penalty_winner === 'A') return m.team_away
  return null
}

function knockoutLoser(m: Parameters<typeof knockoutWinner>[0]): string | null {
  const w = knockoutWinner(m)
  if (!w) return null
  return w === m.team_home ? m.team_away : m.team_home
}

export default async function SimuladorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('simulador', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  const admin = createAuthAdminClient() as any
  const now = new Date().toISOString()

  const [
    participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes,
    thirdScoresRes, rulesRes, teamAbbrRes,
    scorerRes, scorerSettingRes, simRes,
  ] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, score_home, score_away, penalty_winner, is_brazil, match_datetime, betting_deadline, city')
      .order('match_datetime', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away'),
    admin.from('group_bets').select('participant_id, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('teams').select('name, abbr_br'),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
    (supabase as any).from('user_simulations')
      .select('match_id, score_home, score_away')
      .eq('user_id', user.id),
  ])

  const rules: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: any) => [r.key, r.points])
  )
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const teamAbbrs: Record<string, string> = Object.fromEntries(
    (teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? ''])
  )

  const allMatches    = (matchesRes.data ?? []) as any[]
  const allBets       = (betsRes.data    ?? []) as any[]
  const allGroupBets  = (groupBetsRes.data       ?? []) as any[]
  const allTBets      = (tournamentBetsRes.data   ?? []) as any[]
  const thirdScores   = (thirdScoresRes.data      ?? []) as any[]

  // ── Compute PTS Oficial live (mirrors ClassificacaoMB) ─────────────────────

  const completedMatches = allMatches.filter((m: any) => m.score_home !== null && m.score_away !== null)

  // Zebra per match
  const betsByMatch: Record<string, { score_home: number; score_away: number }[]> = {}
  for (const bet of allBets) {
    if (!betsByMatch[bet.match_id]) betsByMatch[bet.match_id] = []
    betsByMatch[bet.match_id].push(bet)
  }
  const isZebraMatch: Record<string, boolean> = {}
  for (const m of completedMatches) {
    isZebraMatch[m.id] = detectMatchZebra(
      betsByMatch[m.id] ?? [],
      getMatchResult(m.score_home, m.score_away),
      zebraThreshold,
    )
  }

  // pts from match bets (live)
  const completedMap: Record<string, any> = Object.fromEntries(completedMatches.map((m: any) => [m.id, m]))
  const ptsMatchesMap: Record<string, number> = {}
  for (const bet of allBets) {
    const m = completedMap[bet.match_id]
    if (!m) continue
    const pts = scoreMatchBet(
      bet.score_home, bet.score_away,
      m.score_home, m.score_away,
      isZebraMatch[bet.match_id] ?? false,
      m.is_brazil, rules,
    )
    ptsMatchesMap[bet.participant_id] = (ptsMatchesMap[bet.participant_id] ?? 0) + pts
  }

  // pts from group bets (stored in DB)
  const ptsGroupsMap: Record<string, number> = {}
  for (const gb of allGroupBets)
    ptsGroupsMap[gb.participant_id] = (ptsGroupsMap[gb.participant_id] ?? 0) + (gb.points ?? 0)

  // pts from third-place qualifiers (stored in participant_scores)
  const ptsThirdsMap: Record<string, number> = Object.fromEntries(
    thirdScores.map((s: any) => [s.participant_id, s.pts_thirds ?? 0])
  )

  // pts from tournament bets (live via scoreTournamentBet)
  const sfDone  = completedMatches.filter((m: any) => m.phase === 'semifinal')
  const qfDone  = completedMatches.filter((m: any) => m.phase === 'quarterfinal')
  const finDone = completedMatches.filter((m: any) => m.phase === 'final')
  const tpDone  = completedMatches.filter((m: any) => m.phase === 'third_place')

  const semifinalists = qfDone.map(knockoutWinner).filter(Boolean) as string[]
  const finalists     = sfDone.map(knockoutWinner).filter(Boolean) as string[]
  const champion      = finDone.length > 0 ? knockoutWinner(finDone[0]) : null
  const runnerUp      = finDone.length > 0 ? knockoutLoser(finDone[0])  : null
  const third         = tpDone.length > 0  ? knockoutWinner(tpDone[0])  : null
  const fourth        = tpDone.length > 0  ? knockoutLoser(tpDone[0])   : null

  const scorerMapping: Record<string, string> = {}
  for (const row of (scorerRes.data ?? []) as any[])
    if (row.standardized_name) scorerMapping[row.raw_name] = row.standardized_name

  let officialScorers: string[] = []
  if (scorerSettingRes.data?.value) {
    try { officialScorers = JSON.parse(scorerSettingRes.data.value) }
    catch { officialScorers = [scorerSettingRes.data.value] }
  }

  const tournamentResults: TournamentResults = {
    semifinalists, finalists,
    champion: champion ?? null, runnerUp: runnerUp ?? null,
    third: third ?? null, fourth: fourth ?? null,
    officialScorers,
  }

  const chamTotal    = allTBets.filter((b: any) => b.champion).length
  const chamWithPick = allTBets.filter((b: any) => b.champion && b.champion === champion).length
  const isZebraChamp = chamTotal > 0 && champion !== null
    && (chamWithPick / chamTotal) * 100 <= zebraThreshold

  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      { champion: tb.champion ?? '', runner_up: tb.runner_up ?? '', semi1: tb.semi1 ?? '', semi2: tb.semi2 ?? '', top_scorer: tb.top_scorer ?? '' },
      tournamentResults, rules, isZebraChamp, scorerMapping,
    )
  }

  // storedTotals = live sum of all four categories
  const participants = (participantsRes.data ?? []) as { id: string; apelido: string }[]
  const storedTotals: Record<string, number> = {}
  for (const p of participants) {
    storedTotals[p.id] =
      (ptsMatchesMap[p.id] ?? 0) +
      (ptsGroupsMap[p.id]  ?? 0) +
      (ptsThirdsMap[p.id]  ?? 0) +
      (ptsG4Map[p.id]      ?? 0)
  }

  // ── Filter visible matches ─────────────────────────────────────────────────
  const visibleMatches = isAdmin
    ? allMatches
    : allMatches.filter((m: any) => m.betting_deadline && m.betting_deadline <= now)

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 pb-16 pt-16 sm:pt-6">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
          <SimuladorClient
            userId={user.id}
            isAdmin={isAdmin}
            activeParticipantId={activeParticipantId ?? null}
            participants={participants as any[]}
            visibleMatches={visibleMatches}
            allBets={allBets}
            rules={rules}
            teamAbbrs={teamAbbrs}
            storedTotals={storedTotals}
            existingSimulations={(simRes.data ?? []) as any[]}
          />
        </div>
      </div>
    </>
  )
}
