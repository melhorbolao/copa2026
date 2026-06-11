export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { TabelaMBClient } from './TabelaMBClient'
import { getVisibilitySettings, isMatchBetsVisible, isBonusVisible, getServerNow } from '@/lib/production-mode'
import type { MatchFull, Participant, BetRaw, GroupBetRaw, ThirdBetRaw, TournamentBetRaw } from './TabelaMBClient'

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

  const [matchesRes, participantsRes, betsRes, rulesRes, groupBetsRes, thirdBetsRes, totalsRes, tournamentBetsRes] = await Promise.all([
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
  ])

  // ── Production mode filtering (server-side, before data reaches the client) ──
  // Usa o timestamp do banco (serverNow) para garantir consistência com RLS e
  // impedir que manipulação do relógio do cliente burle a blindagem.
  const now = serverNow
  const allMatches = (matchesRes.data ?? []) as MatchFull[]

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
        initialMatches={allMatches}
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
      />
    </>
  )
}
