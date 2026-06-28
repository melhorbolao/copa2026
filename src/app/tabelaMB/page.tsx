export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { TabelaMBClient } from './TabelaMBClient'
import { getVisibilitySettings, isMatchBetsVisible, isBonusVisible, getServerNow } from '@/lib/production-mode'
import type { MatchFull, Participant, BetRaw, GroupBetRaw, ThirdBetRaw, TournamentBetRaw } from './TabelaMBClient'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

export const metadata = {}

export default async function ClassificacaoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('tabelaMB', profile?.role ?? 'user')

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

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

  const [visibilitySettings, serverNow] = await Promise.all([
    getVisibilitySettings(),
    getServerNow(),
  ])

  const [matchesRes, participantsRes, betsRes, rulesRes, groupBetsRes, thirdBetsRes, totalsRes, tournamentBetsRes, thirdScoringRes] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, city, score_home, score_away, penalty_winner, is_brazil, betting_deadline')
      .order('match_number', { ascending: true }),
    supabase.from('participants')
      .select('id, apelido')
      .order('apelido', { ascending: true }),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away, points'),
    supabase.from('scoring_rules').select('key, points'),
    fetchAll('group_bets', 'participant_id, group_name, first_place, second_place, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer, points'),
    admin.from('third_place_scoring').select('group_name, enabled'),
  ])

  // ── Production mode filtering (server-side, before data reaches the client) ──
  // Usa o timestamp do banco (serverNow) para garantir consistência com RLS e
  // impedir que manipulação do relógio do cliente burle a blindagem.
  const now = serverNow
  const allMatches = (matchesRes.data ?? []) as MatchFull[]

  // ── Bracket engine: derivar is_brazil para jogos de mata-mata ─────────────
  const gmsSlim: MatchSlim[] = allMatches
    .filter(m => m.phase === 'group' && m.group_name)
    .map(m => ({ id: m.id, group_name: m.group_name ?? '', phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: '', flag_away: '' }))
  const officialScoreMap = new Map<string, BetSlim>()
  for (const m of allMatches) {
    if (m.score_home !== null && m.score_away !== null)
      officialScoreMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
  }
  const officialGroupStandings = calcGroupStandings(gmsSlim, officialScoreMap)
  const officialThirds     = rankThirds(officialGroupStandings)
  const officialThirdSlots = resolveThirdSlots(officialThirds)
  const groupMatchByGroup  = new Map<string, { total: number; scored: number }>()
  for (const m of gmsSlim) {
    if (!m.group_name) continue
    const e = groupMatchByGroup.get(m.group_name) ?? { total: 0, scored: 0 }
    e.total++
    if (officialScoreMap.has(m.id)) e.scored++
    groupMatchByGroup.set(m.group_name, e)
  }
  const completeGroups = new Set(
    [...groupMatchByGroup.entries()].filter(([, v]) => v.total > 0 && v.scored === v.total).map(([g]) => g)
  )
  const allGroupsComplete = groupMatchByGroup.size > 0 && completeGroups.size === groupMatchByGroup.size
  const officialR32Slots = buildR32Teams(officialGroupStandings, officialThirds, officialThirdSlots, undefined, completeGroups, allGroupsComplete)
  const knockoutMatchesFull = allMatches
    .filter(m => ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
    .map(m => ({ ...m, flag_home: m.flag_home ?? '', flag_away: m.flag_away ?? '' }))
  const knockoutTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatchesFull)
  const allMatchesWithOverrides: MatchFull[] = allMatches.map(m => {
    const ov = knockoutTeamMap.get(m.id)
    if (!ov) return m
    const effHome = ov.team_home || m.team_home
    const effAway = ov.team_away || m.team_away
    return {
      ...m,
      team_home: effHome,
      team_away: effAway,
      flag_home: ov.flag_home || m.flag_home,
      flag_away: ov.flag_away || m.flag_away,
      is_brazil: effHome === 'Brasil' || effAway === 'Brasil',
    }
  })

  const bonusDeadlineStr = allMatches.find(m => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusViz = isBonusVisible(bonusDeadlineStr, now, visibilitySettings, isAdmin)

  // Partidas cujo prazo ainda está aberto → outras apostas mostram 🔒 na UI
  const deadlineLockedIds = allMatches
    .filter(m => new Date(m.betting_deadline) > now)
    .map(m => m.id)
  const bonusIsLocked = bonusDeadlineStr ? new Date(bonusDeadlineStr) > now : false

  const visibleMatchIds = new Set<string>(
    allMatches
      .filter(m => isMatchBetsVisible(m.phase, m.round ?? null, m.betting_deadline, now, visibilitySettings, isAdmin))
      .map(m => m.id),
  )

  const filteredBets     = (betsRes as BetRaw[]).filter(b => visibleMatchIds.has(b.match_id))
  const filteredGroupBets    = bonusViz ? (groupBetsRes    as GroupBetRaw[])    : []
  const filteredThirdBets    = bonusViz ? (thirdBetsRes    as ThirdBetRaw[])    : []
  const filteredTournamentBets = bonusViz ? ((tournamentBetsRes.data ?? []) as TournamentBetRaw[]) : []

  const rulesMap: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: { key: string; points: number }) => [r.key, r.points])
  )

  const participantTotals: Record<string, number> = Object.fromEntries(
    (totalsRes.data ?? []).map((r: { participant_id: string; pts_total: number }) => [r.participant_id, r.pts_total])
  )

  // Artilheiro oficial e mapeamento de nomes — tabelas opcionais
  let officialTopScorers: string[] = []
  let scorerMapping: Record<string, string> = {}
  try {
    const [scorerSetting, mappingRows] = await Promise.all([
      admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
      admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    ])
    if (scorerSetting.data?.value) {
      try { officialTopScorers = JSON.parse(scorerSetting.data.value) }
      catch { officialTopScorers = [scorerSetting.data.value] }
    }
    if (mappingRows.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scorerMapping = Object.fromEntries(mappingRows.data.map((m: any) => [m.raw_name.toLowerCase().trim(), m.standardized_name]))
    }
  } catch { /* tabelas ainda não criadas */ }

  const thirdScoring: Record<string, boolean> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((thirdScoringRes.data ?? []) as any[]).map((r: any) => [r.group_name, r.enabled])
  )

  // Query separada para evitar crash se a tabela teams ainda não existir
  let teamAbbrs: Record<string, string> = {}
  try {
    const { data: teamsData } = await admin.from('teams').select('name, abbr_br')
    if (teamsData) {
      teamAbbrs = Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        teamsData.map((t: any) => [t.name, t.abbr_br])
      )
    }
  } catch { /* tabela ainda não criada — sem siglas */ }

  return (
    <>
      <Navbar />
      <TabelaMBClient
        initialMatches={allMatchesWithOverrides}
        participants={(participantsRes.data ?? []) as Participant[]}
        initialBets={filteredBets}
        initialGroupBets={filteredGroupBets}
        initialThirdBets={filteredThirdBets}
        initialTournamentBets={filteredTournamentBets}
        productionMode={visibilitySettings.productionMode}
        participantTotals={participantTotals}
        rules={rulesMap}
        isAdmin={isAdmin}
        activeParticipantId={activeParticipantId ?? ''}
        teamAbbrs={teamAbbrs}
        officialTopScorers={officialTopScorers}
        scorerMapping={scorerMapping}
        lockedMatchIds={deadlineLockedIds}
        bonusIsLocked={bonusIsLocked}
        thirdScoring={thirdScoring}
      />
    </>
  )
}
