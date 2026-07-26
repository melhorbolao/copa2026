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
  scoreGroupBet, detectGroupZebra, detectG4ZebraTeams,
} from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'
import {
  calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap,
  computeGroupCompletion,
} from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'
import { getVisibilitySettings, filterBetsByDeadline, isBonusVisible, getServerNow } from '@/lib/production-mode'
import { computeBlockedScorers } from '@/lib/scoring/eligibleScorers'

export const metadata = {}

// team_home/team_away aqui já vêm resolvidos via allMatchesWithOverrides (chaveamento
// aplicado mais acima), então basta usar penalty_winner como o nome do time direto —
// é assim que a coluna é preenchida no banco, nunca como 'H'/'A'.
function knockoutWinner(m: {
  team_home: string; team_away: string
  score_home: number | null; score_away: number | null
  penalty_winner: string | null
}): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  return m.penalty_winner ?? null
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

  const { data: profile } = await supabase.from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('simulador', profile?.role ?? 'user')

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  const admin = createAuthAdminClient() as any
  const serverNow = await getServerNow()
  const now = serverNow.toISOString()
  const visibilitySettings = await getVisibilitySettings()

  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
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

  const [
    participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes,
    thirdBetsRes, rulesRes, teamAbbrRes,
    scorerRes, scorerSettingRes, topScorersGoalsRes, simRes,
    groupSimRes, thirdSimRes, tournamentSimRes,
  ] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, score_home, score_away, penalty_winner, is_brazil, match_datetime, betting_deadline, city')
      .order('match_datetime', { ascending: true }),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    fetchAll('group_bets', 'participant_id, group_name, first_place, second_place, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('teams').select('name, abbr_br, group_name'),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
    admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
    admin.from('top_scorers').select('player_name, goals_count'),
    (supabase as any).from('user_simulations')
      .select('match_id, score_home, score_away')
      .eq('user_id', user.id),
    (supabase as any).from('user_group_simulations')
      .select('group_name, first_place, second_place')
      .eq('user_id', user.id)
      .then((r: any) => r, () => ({ data: [] })),
    (supabase as any).from('user_third_simulations')
      .select('group_name, team')
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
  const deadlineByMatch: Record<string, string> = Object.fromEntries(
    allMatches.map((m: any) => [m.id, m.betting_deadline])
  )
  const allBets = filterBetsByDeadline(
    betsRes as any[],
    deadlineByMatch,
    serverNow,
    isAdmin,
    activeParticipantId,
  )
  const allGroupBets  = groupBetsRes as any[]
  const allTBets      = (tournamentBetsRes.data   ?? []) as any[]
  const allThirdBets  = thirdBetsRes as any[]

  // ── Resolve knockout team names via bracket engine ────────────────────────
  // Feito antes de qualquer cálculo de pontos: times/is_brazil de mata-mata
  // (round_of_32 em diante) dependem do chaveamento, não só do valor cru salvo
  // no banco (que fica desatualizado enquanto os times ainda são "Venc. Jogo N").
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

  // Chamado incondicionalmente (mesmo se thirdSlots vier null) — resolve o que
  // for possível do chaveamento em vez de descartar tudo. Mesmo padrão usado em
  // /classificacaoMB, /jogos e recalculate.ts.
  const knockoutTeamMap = buildKnockoutTeamMap(
    buildR32Teams(
      officialStandings, officialThirds, thirdSlots, undefined,
      officialCompletion.completeGroups,
      officialCompletion.allGroupsComplete,
    ),
    allMatches.filter((m: any) => m.phase !== 'group'),
  )

  // ── Todos os jogos com overrides de times aplicados ───────────────────────
  const allMatchesWithOverrides = allMatches.map((m: any) => {
    const ov = knockoutTeamMap.get(m.id)
    const effHome = ov?.team_home || m.team_home
    const effAway = ov?.team_away || m.team_away
    return {
      ...m,
      team_home: effHome,
      team_away: effAway,
      flag_home: ov?.flag_home || m.flag_home,
      flag_away: ov?.flag_away || m.flag_away,
      // OR com o valor cru: preserva is_brazil=true já salvo mesmo que o
      // chaveamento não tenha (ainda) resolvido esse jogo específico.
      is_brazil: m.is_brazil || effHome === 'Brasil' || effAway === 'Brasil',
    }
  })

  // ── Bonus deadline + visibility ────────────────────────────────────────────
  const round1Group = allMatches.filter((m: any) => m.phase === 'group' && m.round === 1)
  const bonusDeadlineIso: string | null = round1Group.length > 0
    ? round1Group.map((m: any) => m.betting_deadline as string).sort()[0]
    : null
  const bonusViz = isBonusVisible(bonusDeadlineIso, serverNow, visibilitySettings, isAdmin)
  const bonusIsLocked = !bonusViz

  // ── Matches com prazo ainda aberto (bloqueados para simulação) ─────────────
  const deadlineLockedIds = allMatches
    .filter((m: any) => m.betting_deadline && m.betting_deadline > now)
    .map((m: any) => m.id as string)

  // ── Filtrar bets de bônus por visibilidade ─────────────────────────────────
  const visGroupBets = bonusViz ? allGroupBets : allGroupBets.filter((b: any) => b.participant_id === activeParticipantId)
  const visThirdBets = bonusViz ? allThirdBets : allThirdBets.filter((b: any) => b.participant_id === activeParticipantId)
  const visTBets     = bonusViz ? allTBets     : allTBets.filter((b: any) => b.participant_id === activeParticipantId)

  // ── Compute PTS Oficial live (base para split Oficial/+Sim na aba Classificação) ─

  const completedMatches = allMatchesWithOverrides.filter((m: any) => m.score_home !== null && m.score_away !== null)

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
    if (row.standardized_name) scorerMapping[row.raw_name.toLowerCase().trim()] = row.standardized_name

  const blockedScorers = [...computeBlockedScorers(
    (scorerRes.data ?? []) as { standardized_name: string | null; is_eliminated?: boolean | null }[],
    (topScorersGoalsRes.data ?? []) as { player_name: string; goals_count: number | null }[],
  )]

  let officialTopScorers: string[] = []
  if (scorerSettingRes.data?.value) {
    try { officialTopScorers = JSON.parse(scorerSettingRes.data.value) }
    catch { officialTopScorers = [scorerSettingRes.data.value] }
  }

  const tournamentResults: TournamentResults = {
    semifinalists, finalists,
    champion: champion ?? null, runnerUp: runnerUp ?? null,
    third: third ?? null, fourth: fourth ?? null,
    officialScorers: officialTopScorers,
  }

  const zebraTeams = detectG4ZebraTeams(
    allTBets.map((b: any) => ({
      champion: b.champion ?? '', runner_up: b.runner_up ?? '',
      semi1: b.semi1 ?? '', semi2: b.semi2 ?? '',
    })),
    zebraThreshold,
  )

  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      { champion: tb.champion ?? '', runner_up: tb.runner_up ?? '', semi1: tb.semi1 ?? '', semi2: tb.semi2 ?? '', top_scorer: tb.top_scorer ?? '' },
      tournamentResults, rules, zebraTeams, scorerMapping,
    )
  }

  // ── Prize spot settings ────────────────────────────────────────────────────
  let prizeSpots = 8
  let premioSpots = 10
  try {
    const prizeRes = await admin.from('tournament_settings')
      .select('key, value')
      .in('key', ['prize_spots', 'premio_spots'])
    for (const r of (prizeRes.data ?? []) as { key: string; value: string }[]) {
      const n = parseInt(r.value, 10)
      if (!isNaN(n) && n > 0) {
        if (r.key === 'prize_spots') prizeSpots = n
        if (r.key === 'premio_spots') premioSpots = n
      }
    }
  } catch { /* opcional */ }

  // ── ptsGroupsMap: recalculo ao vivo (mesma lógica do cliente) ─────────────
  const officialGroupZebras = new Set<string>()
  for (const s of officialStandings) {
    const g    = (s as any).group as string
    const first = (s as any).teams[0]?.team ?? ''
    if (!officialCompletion.completeGroups.has(g) || !first) continue
    const picks = allGroupBets.filter((b: any) => b.group_name === g).map((b: any) => b.first_place as string).filter(Boolean)
    if (picks.length > 0 && detectGroupZebra(picks.map(fp => ({ first_place: fp })), first, zebraThreshold))
      officialGroupZebras.add(g)
  }
  const ptsGroupsMap: Record<string, number> = {}
  for (const gb of allGroupBets) {
    if (!gb.first_place) continue
    const standing = officialStandings.find((s: any) => s.group === gb.group_name)
    if (!officialCompletion.completeGroups.has(gb.group_name) || !(standing as any)?.teams[0]?.team) continue
    const first  = (standing as any).teams[0].team as string
    const second = (standing as any).teams[1]?.team ?? ''
    const pts    = scoreGroupBet(gb.first_place, gb.second_place, first, second, officialGroupZebras.has(gb.group_name), rules)
    ptsGroupsMap[gb.participant_id] = (ptsGroupsMap[gb.participant_id] ?? 0) + pts
  }

  // ── ptsThirdsMap: recalculo ao vivo (mesma lógica do cliente) ─────────────
  const thirdPtsVal = rules['terceiro_classificado'] ?? 3
  const ptsThirdsMap: Record<string, number> = {}
  if (officialCompletion.allGroupsComplete) {
    for (const tb of allThirdBets) {
      const advancing = officialThirds.find((t: any) => t.group === tb.group_name && t.advances)?.team
      if (advancing && tb.team === advancing) {
        ptsThirdsMap[tb.participant_id] = (ptsThirdsMap[tb.participant_id] ?? 0) + thirdPtsVal
      }
    }
  }

  const participants = (participantsRes.data ?? []) as { id: string; apelido: string }[]
  const storedTotals: Record<string, number> = {}
  for (const p of participants) {
    storedTotals[p.id] =
      (ptsMatchesMap[p.id] ?? 0) +
      (ptsGroupsMap[p.id]  ?? 0) +
      (ptsThirdsMap[p.id]  ?? 0) +
      (ptsG4Map[p.id]      ?? 0)
  }

  return (
    <>
      <Navbar />
      <SimuladorClient
        userId={user.id}
        isAdmin={isAdmin}
        activeParticipantId={activeParticipantId ?? ''}
        participants={participants}
        initialMatches={allMatchesWithOverrides}
        initialBets={allBets}
        initialGroupBets={visGroupBets}
        initialThirdBets={visThirdBets}
        initialTournamentBets={visTBets}
        participantTotals={storedTotals}
        rules={rules}
        teamAbbrs={teamAbbrs}
        lockedMatchIds={deadlineLockedIds}
        bonusIsLocked={bonusIsLocked}
        existingSimulations={(simRes.data ?? []) as any[]}
        existingGroupSims={(groupSimRes.data ?? []) as any[]}
        existingThirdSims={(thirdSimRes.data ?? []) as any[]}
        existingTournamentSim={tournamentSimRes.data ?? null}
        officialTopScorers={officialTopScorers}
        scorerMapping={scorerMapping}
        blockedScorers={blockedScorers}
        prizeSpots={prizeSpots}
        premioSpots={premioSpots}
      />
    </>
  )
}
