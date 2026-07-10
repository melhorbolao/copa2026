export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { getServerNow } from '@/lib/production-mode'
import { Navbar } from '@/components/layout/Navbar'
import { EvolucaoClient } from './EvolucaoClient'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'
import { scoreTournamentBet, scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap, computeGroupCompletion } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim, KnockoutTeamOverride } from '@/lib/bracket/engine'

export default async function EvolucaoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  await requirePageAccess('evolucao', profile?.role ?? 'user')

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now   = await getServerNow()

  // Dia bolão = UTC-6 (BRT - 3h): jogos às 1h/2h BRT pertencem ao dia anterior
  // meia-noite UTC-6 = 06:00 UTC; subtrai 6h para obter a data correta
  const todayStr = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  // Auto-recalc de pontos diários — garante que participant_points_by_day está
  // atualizado até D-1. Usa chave própria (evolucao_daily_last_run) independente
  // de classificacaoMB para não ser afetado por recalcs anteriores nesse dia.
  // O scoring de partidas (/api/scoring/recalculate) reseta essa chave para 'stale',
  // forçando um novo recalc na próxima visita mesmo que já tenha rodado hoje.
  {
    const nowBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(now)
    const lastRunRow = await admin
      .from('tournament_settings').select('value').eq('key', 'evolucao_daily_last_run').maybeSingle()
    if (lastRunRow?.data?.value !== nowBR) {
      const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const yesterdayBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(yesterdayDate)
      try {
        await recalculateDailyPoints({ upToDate: yesterdayBR })
        await admin.from('tournament_settings').upsert(
          { key: 'evolucao_daily_last_run', value: nowBR },
          { onConflict: 'key' },
        )
      } catch { /* tabela ainda não criada — ignora */ }
    }
  }

  // Janela UTC correspondente ao dia bolão: meia-noite UTC-6 = 06:00 UTC
  const todayStartUTC   = `${todayStr}T06:00:00.000Z`
  const tomorrowStartUTC = new Date(new Date(todayStartUTC).getTime() + 24 * 60 * 60 * 1000).toISOString()

  // participant_points_by_day pode ter >1000 linhas — busca paginada obrigatória
  // (PostgREST retorna no máximo 1000 por request sem paginação explícita)
  const rawDailyPoints: {
    event_date: string; participant_id: string
    pts_matches: number; pts_groups: number; pts_thirds: number; pts_tournament: number
  }[] = []
  {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data } = await admin
        .from('participant_points_by_day')
        .select('event_date, participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament')
        .lt('event_date', todayStr)
        .order('event_date', { ascending: true })
        .order('participant_id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (!data || data.length === 0) break
      rawDailyPoints.push(...(data as typeof rawDailyPoints))
      if (data.length < PAGE) break
      from += PAGE
    }
  }

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

  const [
    participantsRes, panelaRes, allMatchesRes, matchesTodayRes,
    artillarySettingRes, rulesRes, scorerMappingRes, tournamentBetsRes, topScorersRes,
    thirdBetsRaw, thirdScoringRes,
    allBetsRaw, groupBetsRaw,
  ] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    // Todos os jogos (para calcular ptsMatches e ptsThirds ao vivo)
    admin.from('matches')
      .select('id, phase, group_name, team_home, team_away, score_home, score_away, penalty_winner, is_brazil, match_datetime, match_number'),
    // Jogos de hoje: verifica se há ao menos um iniciado ou finalizado
    admin.from('matches')
      .select('match_datetime, score_home')
      .gte('match_datetime', todayStartUTC)
      .lt('match_datetime', tomorrowStartUTC),
    // Flag de artilharia
    admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle()
      .then((r: { data: { value: string } | null }) => r, () => ({ data: null })),
    admin.from('scoring_rules').select('key, points')
      .then((r: { data: { key: string; points: number }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name')
      .then((r: { data: { raw_name: string; standardized_name: string }[] | null }) => r, () => ({ data: [] })),
    // Palpites de torneio completos (para G4 ao vivo)
    admin.from('tournament_bets')
      .select('participant_id, champion, runner_up, semi1, semi2, top_scorer, points')
      .then((r: { data: { participant_id: string; champion: string | null; runner_up: string | null; semi1: string | null; semi2: string | null; top_scorer: string | null; points: number | null }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
      .then((r: { data: { player_name: string; goals_count: number }[] | null }) => r, () => ({ data: [] })),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    admin.from('third_place_scoring').select('group_name, enabled'),
    // Todos os palpites e group_bets (paginados) — para calcular ptsMatches e ptsGroups ao vivo
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    fetchAll('group_bets', 'participant_id, points'),
  ])

  const participants: { id: string; apelido: string }[] = participantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map((r: { member_participant_id: string }) => r.member_participant_id)

  // ── Live G4 ao vivo (espelha classificacaoMB) ────────────────────────────────
  const artillaryActive = artillarySettingRes?.data?.value === 'true'
  const rules: Record<string, number> = Object.fromEntries(
    ((rulesRes.data ?? []) as { key: string; points: number }[]).map(r => [r.key, r.points])
  )
  const scorerMapping: Record<string, string> = Object.fromEntries(
    ((scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string }[])
      .map(m => [m.raw_name.toLowerCase().trim(), m.standardized_name])
  )

  // ── Chaveamento: nomes reais dos jogos de mata-mata ────────────────────────
  // team_home/team_away crus ficam como placeholder ("Venc. Jogo N") até o fim do
  // torneio — precisa encadear os resultados oficiais das rodadas anteriores (mesmo
  // motor usado em classificacaoMB/recalculate.ts) para saber quem realmente joga,
  // tanto para o multiplicador do Brasil quanto para o G4 mais abaixo.
  const allMatchesList = (allMatchesRes.data ?? []) as {
    id: string; phase: string; group_name: string | null; team_home: string; team_away: string
    score_home: number | null; score_away: number | null
    penalty_winner: string | null; is_brazil: boolean; match_datetime: string; match_number: number
  }[]
  const gmsSlim: MatchSlim[] = allMatchesList
    .filter(m => m.phase === 'group' && m.group_name)
    .map(m => ({ id: m.id, group_name: m.group_name!, phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: '', flag_away: '' }))
  const officialScoreMap = new Map<string, BetSlim>()
  for (const m of allMatchesList) {
    if (m.score_home !== null && m.score_away !== null)
      officialScoreMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
  }
  const officialGroupStandings = calcGroupStandings(gmsSlim, officialScoreMap)
  const officialThirds     = rankThirds(officialGroupStandings)
  const officialThirdSlots = resolveThirdSlots(officialThirds)
  const officialCompletion = computeGroupCompletion(gmsSlim, officialScoreMap)
  const officialR32Slots = buildR32Teams(
    officialGroupStandings, officialThirds, officialThirdSlots, undefined,
    officialCompletion.completeGroups, officialCompletion.allGroupsComplete,
  )
  const knockoutMatchesFull = allMatchesList
    .filter(m => ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
    .map(m => ({ ...m, flag_home: '', flag_away: '' }))
  const derivedTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatchesFull)

  const isBrazilByMatchId = new Map<string, boolean>()
  for (const m of allMatchesList) {
    const ov = derivedTeamMap.get(m.id)
    const effHome = ov?.team_home || m.team_home
    const effAway = ov?.team_away || m.team_away
    isBrazilByMatchId.set(m.id, m.is_brazil || effHome === 'Brasil' || effAway === 'Brasil')
  }

  // Resultados do mata-mata (G4)
  function koWinner(
    m: { score_home: number | null; score_away: number | null; penalty_winner: string | null },
    home: string, away: string,
  ): string | null {
    if (m.score_home == null || m.score_away == null) return null
    if (m.score_home > m.score_away) return home
    if (m.score_away > m.score_home) return away
    return m.penalty_winner ?? null
  }
  function resolveKo(m: { id: string; team_home: string; team_away: string; score_home: number | null; score_away: number | null; penalty_winner: string | null }) {
    const ov = derivedTeamMap.get(m.id)
    const home = ov?.team_home || m.team_home
    const away = ov?.team_away || m.team_away
    const winner = koWinner(m, home, away)
    const loser  = winner ? (winner === home ? away : home) : null
    return { winner, loser }
  }

  const koDone  = allMatchesList.filter(m => m.score_home !== null &&
    ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
  const qfDone  = koDone.filter(m => m.phase === 'quarterfinal')
  const sfDone  = koDone.filter(m => m.phase === 'semifinal')
  const finDone = koDone.filter(m => m.phase === 'final')
  const tpDone  = koDone.filter(m => m.phase === 'third_place')

  const semifinalists = qfDone.map(m => resolveKo(m).winner).filter(Boolean) as string[]
  const finalists     = sfDone.map(m => resolveKo(m).winner).filter(Boolean) as string[]
  const finResolved   = finDone.length > 0 ? resolveKo(finDone[0]) : null
  const tpResolved    = tpDone.length > 0  ? resolveKo(tpDone[0])  : null
  const champion      = finResolved?.winner ?? null
  const runnerUp      = finResolved?.loser  ?? null
  const third         = tpResolved?.winner  ?? null
  const fourth        = tpResolved?.loser   ?? null

  // Artilheiros corretos (ao vivo, mesma lógica de classificacaoMB)
  let officialScorers: string[] = []
  if (artillaryActive) {
    const topScorersData = (topScorersRes?.data ?? []) as { player_name: string; goals_count: number }[]
    if (topScorersData.length > 0 && topScorersData[0].goals_count > 0) {
      const maxGoals = topScorersData[0].goals_count
      officialScorers = topScorersData.filter(s => s.goals_count === maxGoals).map(s => s.player_name)
    }
  }

  const tournamentResults = { semifinalists, finalists, champion, runnerUp, third, fourth, officialScorers }

  // Zebra do campeão
  const fullTourBets = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string | null; runner_up: string | null
    semi1: string | null; semi2: string | null; top_scorer: string | null; points: number | null
  }[]
  const zebraThreshold = rules['percentual_zebra'] ?? 15
  const chamBetsWithPick = fullTourBets.filter(b => b.champion && b.champion === champion)
  const chamBetsTotal    = fullTourBets.filter(b => b.champion).length
  const isZebraChampion  = chamBetsTotal > 0 && champion !== null
    && (chamBetsWithPick.length / chamBetsTotal) * 100 <= zebraThreshold

  // Pontos G4 ao vivo por participante
  const liveG4PtsMap: Record<string, number> = {}
  for (const tb of fullTourBets) {
    liveG4PtsMap[tb.participant_id] = scoreTournamentBet(
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

  // ── Live scores: mesma fórmula da classificacaoMB ───────────────────────────
  // ptsMatches ao vivo (não usa participant_scores.pts_matches que pode estar stale)
  const scoredMatches = allMatchesList.filter(m => m.score_home !== null && m.score_away !== null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredById = new Map<string, any>(scoredMatches.map(m => [m.id, m]))

  const betsByMatch: Record<string, Array<{ score_home: number; score_away: number }>> = {}
  for (const b of allBetsRaw) {
    ;(betsByMatch[b.match_id] ??= []).push({ score_home: b.score_home, score_away: b.score_away })
  }
  const isZebraMatch: Record<string, boolean> = {}
  for (const m of scoredMatches) {
    const actual = getMatchResult(m.score_home!, m.score_away!)
    isZebraMatch[m.id] = detectMatchZebra(betsByMatch[m.id] ?? [], actual, zebraThreshold)
  }

  const ptsMatchesMap: Record<string, number> = {}
  for (const b of allBetsRaw) {
    const m = scoredById.get(b.match_id)
    if (!m) continue
    const pts = scoreMatchBet(
      b.score_home, b.score_away,
      m.score_home, m.score_away,
      isZebraMatch[b.match_id] ?? false,
      isBrazilByMatchId.get(b.match_id) ?? false,
      rules,
    )
    ptsMatchesMap[b.participant_id] = (ptsMatchesMap[b.participant_id] ?? 0) + pts
  }

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

  const liveScores: { participant_id: string; pts_total: number }[] = participants.map(p => ({
    participant_id: p.id,
    pts_total:
      (ptsMatchesMap[p.id]  ?? 0) +
      (ptsGroupsMap[p.id]   ?? 0) +
      (ptsThirdsMap[p.id]   ?? 0) +
      (liveG4PtsMap[p.id]   ?? 0),
  }))

  // Histórico: substitui pts_tournament de cada linha pelo valor ao vivo.
  // Usa o próprio r.pts_tournament como referência (não tournament_bets.points),
  // pois participant_points_by_day pode ter sido construído com um valor diferente.
  const adjustedRawDailyPoints = rawDailyPoints.map(r => {
    if (r.pts_tournament === 0) return r
    const live = liveG4PtsMap[r.participant_id] ?? 0
    if (r.pts_tournament === live) return r
    return { ...r, pts_tournament: live }
  })

  // Ao menos 1 jogo finalizado (score_home != null) ou já iniciado (match_datetime <= now)
  const hasMatchToday: boolean = (matchesTodayRes.data ?? []).some(
    (m: { match_datetime: string; score_home: number | null }) =>
      m.score_home !== null || new Date(m.match_datetime) <= now,
  )

  return (
    <>
      <Navbar />
      <EvolucaoClient
        participants={participants}
        panelaIds={panelaIds}
        currentParticipantId={participantId}
        rawDailyPoints={adjustedRawDailyPoints}
        liveScores={liveScores}
        todayStr={todayStr}
        hasMatchToday={hasMatchToday}
      />
    </>
  )
}
