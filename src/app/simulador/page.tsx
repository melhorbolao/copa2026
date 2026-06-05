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
import {
  calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap,
  computeGroupCompletion,
} from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'
import { getVisibilitySettings, filterBetsByDeadline } from '@/lib/production-mode'

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
  const visibilitySettings = await getVisibilitySettings()
  const isTestModeAdmin = isAdmin

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [
    participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes,
    thirdScoresRes, thirdBetsRes, rulesRes, teamAbbrRes,
    scorerRes, scorerSettingRes, simRes,
    groupSimRes, thirdSimRes, tournamentSimRes,
  ] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, score_home, score_away, penalty_winner, is_brazil, match_datetime, betting_deadline, city')
      .order('match_datetime', { ascending: true }),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    fetchAll('group_bets', 'participant_id, group_name, first_place, second_place, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('teams').select('name, abbr_br, group_name'),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
    (supabase as any).from('user_simulations')
      .select('match_id, score_home, score_away')
      .eq('user_id', user.id),
    (supabase as any).from('user_group_simulations')
      .select('group_name, first_place, second_place')
      .eq('user_id', user.id)
      .then((r: any) => r, () => ({ data: [] })),
    (supabase as any).from('user_third_simulations')
      .select('group_name, team, qualifies')
      .eq('user_id', user.id)
      .then((r: any) => r, () => ({ data: [] })),
    (supabase as any).from('user_tournament_simulations')
      .select('champion, runner_up, semi1, semi2, top_scorer')
      .eq('user_id', user.id)
      .maybeSingle()
      .then((r: any) => r, () => ({ data: null })),
  ])

  const rules: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: any) => [r.key, r.points])
  )
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const teamAbbrs: Record<string, string> = Object.fromEntries(
    (teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? ''])
  )

  const allMatches    = (matchesRes.data ?? []) as any[]
  // Filtrar palpites por prazo antes de expor ao cliente
  const deadlineByMatch: Record<string, string> = Object.fromEntries(
    allMatches.map((m: any) => [m.id, m.betting_deadline])
  )
  const allBets = filterBetsByDeadline(
    betsRes as any[],
    deadlineByMatch,
    new Date(now),
    isTestModeAdmin,
    activeParticipantId,
  )
  const allGroupBets  = groupBetsRes as any[]
  const allTBets      = (tournamentBetsRes.data   ?? []) as any[]
  const thirdScores   = (thirdScoresRes.data      ?? []) as any[]
  const allThirdBets  = thirdBetsRes as any[]

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

  // ── Resolve knockout team names via bracket engine ────────────────────────
  // Knockout matches in the DB often store placeholder names (e.g. "Vencedor Q1").
  // The bracket engine derives the real teams from group standings + previous results.
  const groupMatches = allMatches.filter((m: any) => m.phase === 'group')
  const scoreMap = new Map<string, BetSlim>()
  for (const m of groupMatches) {
    if (m.score_home !== null && m.score_away !== null)
      scoreMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
  }
  const matchSlims: MatchSlim[] = groupMatches.map((m: any) => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home, flag_away: m.flag_away,
  }))
  const officialStandings = calcGroupStandings(matchSlims, scoreMap)
  const officialThirds    = rankThirds(officialStandings)
  const thirdSlots        = resolveThirdSlots(officialThirds)
  const officialCompletion = computeGroupCompletion(matchSlims, scoreMap)
  const knockoutTeamMap   = thirdSlots
    ? buildKnockoutTeamMap(
        buildR32Teams(
          officialStandings, officialThirds, thirdSlots, undefined,
          officialCompletion.completeGroups,
          officialCompletion.allGroupsComplete,
        ),
        allMatches.filter((m: any) => m.phase !== 'group'),
      )
    : new Map<string, { team_home: string; flag_home: string; team_away: string; flag_away: string }>()

  // ── Filter visible matches and apply team overrides ───────────────────────
  // Regra: só aparece para simulação se o prazo de envio de palpite já passou.
  // Vale para todos (inclusive admin).
  const visibleMatches = allMatches
    .filter((m: any) => m.betting_deadline && m.betting_deadline <= now)
    .map((m: any) => {
      const ov = knockoutTeamMap.get(m.id)
      if (!ov) return m
      return {
        ...m,
        team_home: ov.team_home || m.team_home,
        team_away: ov.team_away || m.team_away,
        flag_home: ov.flag_home || m.flag_home,
        flag_away: ov.flag_away || m.flag_away,
      }
    })

  // ── Bonus deadlines (group_bets / third_place_bets / tournament_bets) ─────
  // Mesmo prazo: menor betting_deadline da rodada 1 da fase de grupos.
  const round1Group = allMatches.filter((m: any) => m.phase === 'group' && m.round === 1)
  const bonusDeadlineIso: string | null = round1Group.length > 0
    ? round1Group.map((m: any) => m.betting_deadline as string).sort()[0]
    : null
  const bonusUnlocked = isAdmin || !!(bonusDeadlineIso && bonusDeadlineIso <= now)

  // Times por grupo (para os pickers do simulador). Vem de teams ou, se a
  // tabela teams não estiver populada, de matches.
  const teamsByGroup: Record<string, { name: string; flag: string }[]> = {}
  for (const t of (teamAbbrRes.data ?? []) as any[]) {
    if (!t.group_name) continue
    if (!teamsByGroup[t.group_name]) teamsByGroup[t.group_name] = []
    if (!teamsByGroup[t.group_name].find(x => x.name === t.name)) {
      teamsByGroup[t.group_name].push({ name: t.name, flag: '' })
    }
  }
  // Preenche flags a partir de matches (teams.name pode não ter flag)
  for (const m of allMatches) {
    if (!m.group_name) continue
    const list = teamsByGroup[m.group_name]
    if (!list) continue
    for (const [team, flag] of [[m.team_home, m.flag_home], [m.team_away, m.flag_away]] as [string, string][]) {
      const t = list.find(x => x.name === team)
      if (t && !t.flag) t.flag = flag
    }
  }
  for (const g of Object.keys(teamsByGroup)) {
    teamsByGroup[g].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

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
            allGroupBets={allGroupBets}
            allThirdBets={allThirdBets}
            allTournamentBets={allTBets}
            rules={rules}
            teamAbbrs={teamAbbrs}
            teamsByGroup={teamsByGroup}
            storedTotals={storedTotals}
            existingSimulations={(simRes.data ?? []) as any[]}
            existingGroupSims={(groupSimRes.data ?? []) as any[]}
            existingThirdSims={(thirdSimRes.data ?? []) as any[]}
            existingTournamentSim={tournamentSimRes.data ?? null}
            bonusUnlocked={bonusUnlocked}
            officialScorers={officialScorers}
            scorerMapping={scorerMapping}
          />
        </div>
      </div>
    </>
  )
}
