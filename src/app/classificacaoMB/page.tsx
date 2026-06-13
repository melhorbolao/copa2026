export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess, getPageVisibility, isPageVisible } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ClassificacaoMBClient } from './ClassificacaoMBClient'
import { getMatchResult, detectMatchZebra } from '@/lib/scoring/engine'
import { getVisibilitySettings, isBonusVisible, isMatchBetsVisible } from '@/lib/production-mode'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'

export const metadata = {}

export default async function ClassificacaoMBPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  const role = profile?.role ?? 'user'
  await requirePageAccess('classificacaoMB', role)

  const visibilityRows = await getPageVisibility()
  const minhaPanelaEnabled = isPageVisible(visibilityRows, 'minhaPanela', role)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  let panelaMemberIds: string[] = []
  if (activeParticipantId) {
    try {
      const { data: panelaData } = await admin
        .from('user_panela')
        .select('member_participant_id')
        .eq('owner_participant_id', activeParticipantId)
      panelaMemberIds = ((panelaData ?? []) as { member_participant_id: string }[])
        .map(r => r.member_participant_id)
    } catch { /* tabela pode não existir */ }
  }

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string, matchIds?: string[]): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (admin as any).from(table).select(select).range(from, from + PAGE - 1)
      if (matchIds) q = q.in('match_id', matchIds)
      const { data, error } = await q
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [visibilitySettings] = await Promise.all([getVisibilitySettings()])

  // Tribos para destaque (admin/master only — lista simples de id+nome)
  let tribes: { id: string; name: string }[] = []
  if (isAdmin) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tribesData } = await (admin as any).from('tribes').select('id, name').order('name')
      tribes = (tribesData ?? []) as { id: string; name: string }[]
    } catch { /* tabela ainda não criada */ }
  }

  // ── Fetch #1: dados base via Materialized View ────────────────────────────
  // mv_general_ranking (~100 linhas) substitui: participants + bets (completo)
  // + group_bets + participant_scores — redução de ~7.500 para ~100 linhas.
  const [rankingRes, matchesRes, tournamentBetsRes, rulesRes] = await Promise.all([
    admin.from('mv_general_ranking').select('*').order('posicao'),
    supabase.from('matches')
      .select('id, match_number, match_datetime, betting_deadline, team_home, team_away, score_home, score_away, phase, round, group_name, penalty_winner, is_brazil')
      .order('match_datetime', { ascending: true }),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    supabase.from('scoring_rules').select('key, points'),
  ])

  // ── Fetch #2: dados auxiliares ─────────────────────────────────────────────
  let teamAbbrs: Record<string, string> = {}
  let eliminatedTeams: string[] = []
  let scorerMapping: Record<string, string> = {}
  let eliminatedStdScorers: string[] = []
  let officialScorers: string[] = []
  let prizeSpots = 8
  let premioSpots = 10
  let sobeDesceVisible = true
  let artillaryPointsActive = false
  let lastDataDate: string | null = null
  const colVisibility: Record<string, boolean> = {
    premio:        false,
    last_match:    true,
    next_match:    true,
    delta_premio:  true,
    delta_corte1:  true,
    delta_corte2:  true,
    pts_jg:        true,
    pts_cl:        true,
    pts_g4:        true,
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamsData } = await admin.from('teams').select('name, abbr_br, is_eliminated') as any
    if (teamsData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of teamsData as any[]) {
        if (t.abbr_br) teamAbbrs[t.name] = t.abbr_br
        if (t.is_eliminated) eliminatedTeams.push(t.name)
      }
    }
  } catch { /* tabela não tem a coluna ainda */ }

  try {
    const COL_KEYS = [
      'classif_col_premio', 'classif_col_last_match', 'classif_col_next_match',
      'classif_col_delta_premio', 'classif_col_delta_corte1', 'classif_col_delta_corte2',
      'classif_col_pts_jg', 'classif_col_pts_cl', 'classif_col_pts_g4',
    ]
    const [scorerRes, scorerSetting, settingsRes, premioSpotsRes, colSettingsRes, sobeDesceRow, dailyRunRow, artillaryRow] = await Promise.all([
      admin.from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
      admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'prize_spots').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'premio_spots').maybeSingle(),
      admin.from('tournament_settings').select('key, value').in('key', COL_KEYS),
      admin.from('tournament_settings').select('value').eq('key', 'sobe_desce_visible').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'daily_points_last_run').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle(),
    ])
    // padrão: visível (true) se a chave ainda não existir
    sobeDesceVisible = sobeDesceRow?.data?.value !== 'false'
    artillaryPointsActive = artillaryRow?.data?.value === 'true'

    // ── Auto-recalc de pontos diários ────────────────────────────────────────
    const nowBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
    const lastRunDate = dailyRunRow?.data?.value ?? null
    if (lastRunDate !== nowBR) {
      const yday = new Date(); yday.setDate(yday.getDate() - 1)
      const yesterdayBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(yday)
      try {
        await recalculateDailyPoints({ upToDate: yesterdayBR })
        await admin.from('tournament_settings').upsert(
          { key: 'daily_points_last_run', value: nowBR },
          { onConflict: 'key' },
        )
      } catch { /* tabela ainda não criada — ignora */ }
    }

    // Última data com dados históricos (para limite do Sobe e Desce)
    try {
      const lastDataRow = await admin
        .from('participant_points_by_day')
        .select('event_date')
        .order('event_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      lastDataDate = lastDataRow?.data?.event_date ?? null
    } catch { /* tabela ainda não criada */ }

    if (scorerRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of scorerRes.data as any[]) {
        if (row.standardized_name) scorerMapping[row.raw_name.toLowerCase().trim()] = row.standardized_name
        if (row.is_eliminated && row.standardized_name)
          eliminatedStdScorers.push(row.standardized_name.trim().toLowerCase())
      }
    }
    if (scorerSetting.data?.value) {
      try { officialScorers = JSON.parse(scorerSetting.data.value) }
      catch { officialScorers = [scorerSetting.data.value] }
    }
    // Quando o flag está ativo, deriva artilheiros do banco (todos empatados no topo).
    if (artillaryPointsActive) {
      try {
        const { data: topScorersData } = await admin
          .from('top_scorers')
          .select('player_name, goals_count')
          .order('goals_count', { ascending: false })
        if (topScorersData && topScorersData.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maxGoals = (topScorersData[0] as any).goals_count as number
          if (maxGoals > 0) {
            officialScorers = (topScorersData as { player_name: string; goals_count: number }[])
              .filter(s => s.goals_count === maxGoals)
              .map(s => s.player_name)
          }
        }
      } catch { /* tabela ainda não populada */ }
    }
    if (settingsRes.data?.value) {
      const n = parseInt(settingsRes.data.value, 10)
      if (!isNaN(n) && n > 0) prizeSpots = n
    }
    if (premioSpotsRes.data?.value) {
      const n = parseInt(premioSpotsRes.data.value, 10)
      if (!isNaN(n) && n > 0) premioSpots = n
    }
    if (colSettingsRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of colSettingsRes.data as any[]) {
        const short = (r.key as string).replace('classif_col_', '')
        colVisibility[short] = r.value === 'true'
      }
    }
  } catch { /* tabelas opcionais */ }

  // ── Processar dados base ───────────────────────────────────────────────────
  type MvRow = {
    participant_id: string; apelido: string
    pts_matches: number; pts_groups: number; pts_thirds: number
    pts_tournament: number; pts_total: number
    cravadas: number; pontuados: number; jogos_finalizados: number; posicao: number
  }
  const ranking = (rankingRes.data ?? []) as MvRow[]
  const matches = (matchesRes.data ?? []) as {
    id: string; match_number: number; match_datetime: string; betting_deadline: string
    team_home: string; team_away: string
    score_home: number | null; score_away: number | null
    phase: string; round: number | null; group_name: string | null; penalty_winner: string | null
    is_brazil: boolean
  }[]
  const allTBets = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string; runner_up: string
    semi1: string; semi2: string; top_scorer: string
  }[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Visibilidade em Modo Produção ─────────────────────────────────────────
  const now = new Date()
  const bonusDeadline = matches.find(m => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusVis = isBonusVisible(bonusDeadline, now, visibilitySettings, isAdmin)

  const completedMatches = matches.filter(m => m.score_home !== null)
  const pendingMatches   = matches.filter(m => m.score_home === null)

  const lastMatch = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1] : null
  const nextMatch = pendingMatches.length > 0   ? pendingMatches[0] : null

  // ── Fetch #3: apostas alvejadas (zebras + palpite do último/próximo jogo) ──
  // Filtra a tabela bets apenas para jogos encerrados + próximo jogo,
  // eliminando apostas de jogos futuros ainda não encerrados.
  const targetMatchIds = [
    ...completedMatches.map(m => m.id),
    ...(nextMatch ? [nextMatch.id] : []),
  ]
  const allBets = targetMatchIds.length > 0
    ? await fetchAll('bets', 'participant_id, match_id, score_home, score_away, points', targetMatchIds)
    : []

  // ── Distribuição de resultados por jogo (para detectar apostas em possível zebra) ──
  const matchResultDist: Record<string, { H: number; D: number; A: number; total: number }> = {}
  for (const bet of allBets) {
    const d = matchResultDist[bet.match_id] ?? { H: 0, D: 0, A: 0, total: 0 }
    const r = getMatchResult(bet.score_home, bet.score_away)
    d[r]++; d.total++
    matchResultDist[bet.match_id] = d
  }

  // Resultado oficial por jogo
  const matchResultMap: Record<string, { score_home: number; score_away: number }> = {}
  for (const m of completedMatches)
    matchResultMap[m.id] = { score_home: m.score_home!, score_away: m.score_away! }

  // Zebra real por jogo
  const isZebraMatch: Record<string, boolean> = {}
  for (const m of completedMatches) {
    const actual      = getMatchResult(m.score_home!, m.score_away!)
    const betsForMatch = allBets.filter(b => b.match_id === m.id)
    isZebraMatch[m.id] = detectMatchZebra(betsForMatch, actual, zebraThreshold)
  }

  const zebraApostMap: Record<string, number> = {}
  const zebraPontMap:  Record<string, number> = {}
  const lastMatchBets: Record<string, { score_home: number; score_away: number }> = {}
  const nextMatchBets: Record<string, { score_home: number; score_away: number }> = {}

  const deadlineByMatchId = new Map<string, string>(matches.map(m => [m.id, m.betting_deadline]))

  for (const bet of allBets) {
    const pid = bet.participant_id

    // 🦓 pontuada: acertou zebra real em jogo encerrado
    if (isZebraMatch[bet.match_id]) {
      const official = matchResultMap[bet.match_id]
      if (official) {
        const betRes = getMatchResult(bet.score_home, bet.score_away)
        const actRes = getMatchResult(official.score_home, official.score_away)
        if (betRes === actRes) zebraPontMap[pid] = (zebraPontMap[pid] ?? 0) + 1
      }
    }

    // 🦓 apostada: apostou em resultado minoritário em jogos com prazo já passado
    const betDeadline = deadlineByMatchId.get(bet.match_id)
    const betDeadlinePassed = betDeadline && new Date(betDeadline) <= now
    const dist = matchResultDist[bet.match_id]
    if (dist && dist.total > 0 && betDeadlinePassed) {
      const betRes = getMatchResult(bet.score_home, bet.score_away)
      if ((dist[betRes] / dist.total) * 100 <= zebraThreshold)
        zebraApostMap[pid] = (zebraApostMap[pid] ?? 0) + 1
    }

    if (lastMatch && bet.match_id === lastMatch.id) {
      const vis = isMatchBetsVisible(lastMatch.phase, lastMatch.round, lastMatch.betting_deadline, now, visibilitySettings, isAdmin)
      if (vis || pid === activeParticipantId) lastMatchBets[pid] = bet
    }
    if (nextMatch && bet.match_id === nextMatch.id) {
      const vis = isMatchBetsVisible(nextMatch.phase, nextMatch.round, nextMatch.betting_deadline, now, visibilitySettings, isAdmin)
      if (vis || pid === activeParticipantId) nextMatchBets[pid] = bet
    }
  }

  // ── Montar linhas ──────────────────────────────────────────────────────────
  const tBetMap: Record<string, typeof allTBets[0]> = Object.fromEntries(allTBets.map(b => [b.participant_id, b]))

  const rows = ranking.map(mv => ({
    id:            mv.participant_id,
    apelido:       mv.apelido,
    pts:           mv.pts_total,
    ptsMatches:    mv.pts_matches,
    ptsClassif:    mv.pts_groups + mv.pts_thirds,
    ptsG4:         mv.pts_tournament,
    cravados:      mv.cravadas,
    pontuados:     mv.pontuados,
    zebraApostada: zebraApostMap[mv.participant_id] ?? 0,
    zebraPontuada: zebraPontMap[mv.participant_id]  ?? 0,
    tournamentBet: (bonusVis || mv.participant_id === activeParticipantId) ? (tBetMap[mv.participant_id] ?? null) : null,
    lastMatchBet:  lastMatchBets[mv.participant_id] ?? null,
    nextMatchBet:  nextMatchBets[mv.participant_id] ?? null,
  }))

  const matchesRegistered = completedMatches.length

  // Group is "defined" when every match in that group has a score
  const groupTotals: Record<string, { total: number; done: number }> = {}
  for (const m of matches.filter(m => m.phase === 'group' && m.group_name)) {
    const g = m.group_name!
    if (!groupTotals[g]) groupTotals[g] = { total: 0, done: 0 }
    groupTotals[g].total++
    if (m.score_home !== null) groupTotals[g].done++
  }
  const groupsDefined = Object.values(groupTotals).filter(v => v.total > 0 && v.done === v.total).length

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()

  // ── Datas para "Sobe e Desce" ─────────────────────────────────────────────
  const toBRDate = (isoStr: string) =>
    new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(isoStr))

  // Data do resultado mais recente (para modo "Último dia")
  const lastResultDate = completedMatches.length > 0
    ? toBRDate(completedMatches[completedMatches.length - 1].match_datetime)
    : null

  // Fase mais avançada com resultados (para modo "Rodada em andamento")
  const PHASE_ORDER = ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final']
  const phasesWithResults = new Set(completedMatches.map(m => m.phase))
  let currentPhase = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1].phase : null
  for (const ph of PHASE_ORDER) {
    if (phasesWithResults.has(ph)) currentPhase = ph
  }
  const currentPhaseMatches = currentPhase
    ? completedMatches.filter(m => m.phase === currentPhase)
    : []
  const currentPhaseStartDate = currentPhaseMatches.length > 0
    ? toBRDate(currentPhaseMatches[0].match_datetime) // já ordenado por match_datetime asc
    : null

  // suppress unused-variable warning for officialScorers (kept for future use)
  void officialScorers

  return (
    <>
      <Navbar />
      <ClassificacaoMBClient
        rows={rows}
        lastMatch={lastMatch ? {
          id: lastMatch.id,
          abbr_home: abbr(lastMatch.team_home),
          abbr_away: abbr(lastMatch.team_away),
        } : null}
        nextMatch={nextMatch ? {
          id: nextMatch.id,
          abbr_home: abbr(nextMatch.team_home),
          abbr_away: abbr(nextMatch.team_away),
        } : null}
        eliminatedTeams={eliminatedTeams}
        eliminatedStdScorers={[...new Set(eliminatedStdScorers)]}
        scorerMapping={scorerMapping}
        teamAbbrs={teamAbbrs}
        prizeSpots={prizeSpots}
        premioSpots={premioSpots}
        activeParticipantId={activeParticipantId ?? ''}
        panelaMemberIds={panelaMemberIds}
        colVisibility={colVisibility}
        renderedAt={new Date().toISOString()}
        matchesRegistered={matchesRegistered}
        groupsDefined={groupsDefined}
        lastResultDate={lastResultDate}
        currentPhaseStartDate={currentPhaseStartDate}
        sobeDesceVisible={sobeDesceVisible}
        isAdmin={isAdmin}
        lastDataDate={lastDataDate}
        minhaPanelaEnabled={minhaPanelaEnabled}
        tribes={tribes}
      />
    </>
  )
}
