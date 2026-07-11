export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess, getPageVisibility, isPageVisible } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ClassificacaoMBClient } from './ClassificacaoMBClient'
import { getMatchResult, detectMatchZebra, detectG4ZebraTeams, scoreTournamentBet, scoreMatchBet } from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim, KnockoutTeamOverride } from '@/lib/bracket/engine'
import { getVisibilitySettings, isBonusVisible, isMatchBetsVisible } from '@/lib/production-mode'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'
import { getPrizeAmounts } from '@/lib/prizes'

export const metadata = {}

// team_home/team_away crus de jogos de mata-mata ficam como placeholder ("Venc. Jogo N")
// até o fim do torneio — por isso recebem home/away já resolvidos via buildKnockoutTeamMap
// (mesmo motor de chaveamento usado para o multiplicador do Brasil, mais abaixo).
function knockoutWinner(
  m: { score_home: number | null; score_away: number | null; penalty_winner: string | null },
  home: string,
  away: string,
): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return home
  if (m.score_away > m.score_home) return away
  return m.penalty_winner ?? null
}

function resolveKnockout(
  m: { id: string; team_home: string; team_away: string; score_home: number | null; score_away: number | null; penalty_winner: string | null },
  teamMap: Map<string, KnockoutTeamOverride>,
): { winner: string | null; loser: string | null } {
  const ov = teamMap.get(m.id)
  const home = ov?.team_home || m.team_home
  const away = ov?.team_away || m.team_away
  const winner = knockoutWinner(m, home, away)
  const loser  = winner ? (winner === home ? away : home) : null
  return { winner, loser }
}

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

  // ── Fetch #1: dados base ───────────────────────────────────────────────────
  const [participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes, scoresRes, rulesRes, thirdBetsRes, thirdScoringRes, paidParticipantsRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, match_datetime, betting_deadline, team_home, team_away, score_home, score_away, phase, round, group_name, penalty_winner, is_brazil')
      .order('match_datetime', { ascending: true }),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away, points'),
    fetchAll('group_bets', 'participant_id, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    supabase.from('scoring_rules').select('key, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    admin.from('third_place_scoring').select('group_name, enabled'),
    admin.from('participants').select('paid'),
  ])

  // Premiação (mesma fonte usada na página Premiação) — valor em R$ por posição.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pagos = ((paidParticipantsRes.data ?? []) as any[]).filter(p => p.paid).length

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
  let corte1Executado = false
  let corte2Executado = false
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
    const [scorerRes, scorerSetting, settingsRes, premioSpotsRes, colSettingsRes, sobeDesceRow, dailyRunRow, artillaryRow, cortesRow] = await Promise.all([
      admin.from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
      admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'prize_spots').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'premio_spots').maybeSingle(),
      admin.from('tournament_settings').select('key, value').in('key', COL_KEYS),
      admin.from('tournament_settings').select('value').eq('key', 'sobe_desce_visible').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'daily_points_last_run').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle(),
      admin.from('tournament_settings').select('key, value').in('key', ['corte1_participantes', 'corte2_participantes']),
    ])
    // padrão: visível (true) se a chave ainda não existir
    sobeDesceVisible = sobeDesceRow?.data?.value !== 'false'
    artillaryPointsActive = artillaryRow?.data?.value === 'true'

    // Corte "executado" = admin já congelou a lista de qualificados (ver getQualifiedSets em phase-availability.ts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (cortesRow.data ?? []) as any[]) {
      try {
        const arr = JSON.parse(r.value ?? '[]')
        const executado = Array.isArray(arr) && arr.length > 0
        if (r.key === 'corte1_participantes') corte1Executado = executado
        if (r.key === 'corte2_participantes') corte2Executado = executado
      } catch { /* ignore */ }
    }

    // ── Auto-recalc de pontos diários ────────────────────────────────────────
    // UTC-6: consistente com daily-points.ts — dia bolão começa às 06:00 UTC
    const nowBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(new Date())
    const lastRunDate = dailyRunRow?.data?.value ?? null
    if (lastRunDate !== nowBR) {
      const yday = new Date(); yday.setDate(yday.getDate() - 1)
      const yesterdayBR = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(yday)
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

  const prizeAmounts = getPrizeAmounts(pagos, premioSpots)

  // ── Processar dados base ───────────────────────────────────────────────────
  const participants = (participantsRes.data ?? []) as { id: string; apelido: string }[]
  const matches = (matchesRes.data ?? []) as {
    id: string; match_number: number; match_datetime: string; betting_deadline: string
    team_home: string; team_away: string
    score_home: number | null; score_away: number | null
    phase: string; round: number | null; group_name: string | null; penalty_winner: string | null
    is_brazil: boolean
  }[]
  const allBets = betsRes as {
    participant_id: string; match_id: string
    score_home: number; score_away: number; points: number | null
  }[]
  const allGroupBets = groupBetsRes as { participant_id: string; points: number | null }[]
  const allTBets     = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string; runner_up: string
    semi1: string; semi2: string; top_scorer: string
  }[]
  const scoresData = (scoresRes.data ?? []) as { participant_id: string; pts_total: number | null }[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Visibilidade em Modo Produção ─────────────────────────────────────────
  const now = new Date()
  const bonusDeadline = matches.find(m => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusVis = isBonusVisible(bonusDeadline, now, visibilitySettings, isAdmin)

  const completedMatches = matches.filter(m => m.score_home !== null)
  const pendingMatches   = matches.filter(m => m.score_home === null)

  // ── Chaveamento: nomes reais dos jogos de mata-mata ────────────────────────
  // team_home/team_away crus ficam como placeholder ("Venc. Jogo N") até o fim do
  // torneio — precisa encadear os resultados oficiais das rodadas anteriores (mesmo
  // motor usado em recalculate.ts) para saber quem realmente joga em cada fase,
  // tanto para o multiplicador do Brasil quanto para o G4 mais abaixo.
  const gmsSlim: MatchSlim[] = matches
    .filter(m => m.phase === 'group' && m.group_name)
    .map(m => ({ id: m.id, group_name: m.group_name, phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: '', flag_away: '' }))
  const officialScoreMap = new Map<string, BetSlim>()
  for (const m of matches) {
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
  const knockoutMatchesFull = matches.filter(m =>
    ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase)
  ).map(m => ({ ...m, flag_home: '', flag_away: '' }))
  const derivedTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatchesFull)

  const isBrazilByMatchId = new Map<string, boolean>()
  for (const m of matches) {
    const ov = derivedTeamMap.get(m.id)
    const effHome = ov?.team_home || m.team_home
    const effAway = ov?.team_away || m.team_away
    isBrazilByMatchId.set(m.id, m.is_brazil || effHome === 'Brasil' || effAway === 'Brasil')
  }

  // ── Resultados do torneio (G4) ─────────────────────────────────────────────
  const qfDone  = completedMatches.filter(m => m.phase === 'quarterfinal')
  const sfDone  = completedMatches.filter(m => m.phase === 'semifinal')
  const finDone = completedMatches.filter(m => m.phase === 'final')
  const tpDone  = completedMatches.filter(m => m.phase === 'third_place')

  const semifinalists = qfDone.map(m => resolveKnockout(m, derivedTeamMap).winner).filter(Boolean) as string[]
  const finalists     = sfDone.map(m => resolveKnockout(m, derivedTeamMap).winner).filter(Boolean) as string[]
  const finalResolved = finDone.length > 0 ? resolveKnockout(finDone[0], derivedTeamMap) : null
  const thirdResolved = tpDone.length > 0  ? resolveKnockout(tpDone[0],  derivedTeamMap) : null
  const champion      = finalResolved?.winner ?? null
  const runnerUp       = finalResolved?.loser  ?? null
  const third         = thirdResolved?.winner ?? null
  const fourth        = thirdResolved?.loser  ?? null

  const tournamentResults: TournamentResults = {
    semifinalists, finalists,
    champion: champion ?? null, runnerUp: runnerUp ?? null,
    third: third ?? null, fourth: fourth ?? null,
    officialScorers,
  }

  const zebraTeams = detectG4ZebraTeams(
    allTBets.map(b => ({
      champion: b.champion ?? '', runner_up: b.runner_up ?? '',
      semi1: b.semi1 ?? '', semi2: b.semi2 ?? '',
    })),
    zebraThreshold,
  )

  // Pontos G4 + artilheiro por participante (calculados ao vivo)
  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: artillaryPointsActive ? (tb.top_scorer ?? '') : '',
      },
      tournamentResults,
      rules,
      zebraTeams,
      scorerMapping,
    )
  }

  // ── Últimos/próximos jogos ─────────────────────────────────────────────────
  const lastMatch = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1] : null
  const nextMatch = pendingMatches.length > 0   ? pendingMatches[0] : null

  // ── Estatísticas por participante ──────────────────────────────────────────
  const storedPtsMap: Record<string, number> = Object.fromEntries(
    scoresData.map(s => [s.participant_id, s.pts_total ?? 0])
  )

  // Pontos de 3º calculados ao vivo (mesma lógica da TabelaMB)
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
    const third = standing.teams[2]?.team
    if (third) actualThirdByGroup.set(g, third)
  }
  const thirdPts = rules['terceiro_classificado'] ?? 3
  const ptsThirdsMap: Record<string, number> = {}
  for (const bet of (thirdBetsRes as { participant_id: string; group_name: string; team: string }[])) {
    const actualThird = actualThirdByGroup.get(bet.group_name)
    if (actualThird && bet.team === actualThird)
      ptsThirdsMap[bet.participant_id] = (ptsThirdsMap[bet.participant_id] ?? 0) + thirdPts
  }

  // Distribuição de resultados por jogo (para detectar apostas em possível zebra)
  const matchResultDist: Record<string, { H: number; D: number; A: number; total: number }> = {}
  for (const bet of allBets) {
    const d = matchResultDist[bet.match_id] ?? { H: 0, D: 0, A: 0, total: 0 }
    const r = getMatchResult(bet.score_home, bet.score_away)
    d[r]++; d.total++
    matchResultDist[bet.match_id] = d
  }

  // Mapa de resultado oficial por jogo
  const matchResultMap: Record<string, { score_home: number; score_away: number }> = {}
  for (const m of completedMatches)
    matchResultMap[m.id] = { score_home: m.score_home!, score_away: m.score_away! }

  // Zebra real por jogo
  const isZebraMatch: Record<string, boolean> = {}
  for (const m of completedMatches) {
    const actual = getMatchResult(m.score_home!, m.score_away!)
    isZebraMatch[m.id] = detectMatchZebra(
      (matchResultDist[m.id] ? Object.values(matchResultDist[m.id]).slice(0, 3) : []) as never,
      actual,
      zebraThreshold,
    )
    // Re-check usando a lista real de bets
    const betsForMatch = allBets.filter(b => b.match_id === m.id)
    isZebraMatch[m.id] = detectMatchZebra(betsForMatch, actual, zebraThreshold)
  }

  const ptsMatchesMap: Record<string, number> = {}
  const cravadosMap:   Record<string, number> = {}
  const pontuadosMap:  Record<string, number> = {}
  const zebraApostMap: Record<string, number> = {}
  const zebraPontMap:  Record<string, number> = {}
  const lastMatchBets: Record<string, { score_home: number; score_away: number }> = {}
  const nextMatchBets: Record<string, { score_home: number; score_away: number }> = {}

  const deadlineByMatchId = new Map<string, string>(matches.map(m => [m.id, m.betting_deadline]))

  for (const bet of allBets) {
    const pid = bet.participant_id
    const official = matchResultMap[bet.match_id]

    if (official) {
      const match = matches.find(m => m.id === bet.match_id)
      const pts = scoreMatchBet(
        bet.score_home, bet.score_away,
        official.score_home, official.score_away,
        isZebraMatch[bet.match_id] ?? false,
        isBrazilByMatchId.get(bet.match_id) ?? false,
        rules,
      )
      // Pontos e estatísticas de jogos encerrados
      ptsMatchesMap[pid] = (ptsMatchesMap[pid] ?? 0) + pts
      if (pts > 0) pontuadosMap[pid] = (pontuadosMap[pid] ?? 0) + 1
      if (bet.score_home === official.score_home && bet.score_away === official.score_away)
        cravadosMap[pid] = (cravadosMap[pid] ?? 0) + 1

      // 🦓 pontuada: acertou zebra real
      if (isZebraMatch[bet.match_id]) {
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
    // nextMatchBet: só mostra se rodada liberada ou próprio palpite
    if (nextMatch && bet.match_id === nextMatch.id) {
      const vis = isMatchBetsVisible(nextMatch.phase, nextMatch.round, nextMatch.betting_deadline, now, visibilitySettings, isAdmin)
      if (vis || pid === activeParticipantId) nextMatchBets[pid] = bet
    }
  }

  const ptsGroupsMap: Record<string, number> = {}
  for (const bet of allGroupBets)
    ptsGroupsMap[bet.participant_id] = (ptsGroupsMap[bet.participant_id] ?? 0) + (bet.points ?? 0)

  // ── Montar linhas ──────────────────────────────────────────────────────────
  const tBetMap: Record<string, typeof allTBets[0]> = Object.fromEntries(allTBets.map(b => [b.participant_id, b]))

  const rows = participants.map(p => {
    const ptsMatches = ptsMatchesMap[p.id] ?? 0
    const ptsGroups  = ptsGroupsMap[p.id]  ?? 0
    const ptsThirds  = ptsThirdsMap[p.id]  ?? 0
    const ptsG4      = ptsG4Map[p.id]      ?? 0
    return {
      id: p.id,
      apelido: p.apelido,
      pts:        ptsMatches + ptsGroups + ptsThirds + ptsG4,
      ptsMatches,
      ptsClassif: ptsGroups + ptsThirds,
      ptsG4,
      cravados:       cravadosMap[p.id]    ?? 0,
      pontuados:      pontuadosMap[p.id]   ?? 0,
      zebraApostada:  zebraApostMap[p.id]  ?? 0,
      zebraPontuada:  zebraPontMap[p.id]   ?? 0,
      storedPts:      storedPtsMap[p.id]   ?? 0,
      tournamentBet:  (bonusVis || p.id === activeParticipantId) ? (tBetMap[p.id] ?? null) : null,
      lastMatchBet:   lastMatchBets[p.id]  ?? null,
      nextMatchBet:   nextMatchBets[p.id]  ?? null,
    }
  })

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
  // UTC-6: jogos às 1h/2h BRT são do dia anterior no bolão
  const toBRDate = (isoStr: string) =>
    new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(new Date(isoStr))

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

  return (
    <>
      <Navbar />
      <ClassificacaoMBClient
        rows={rows}
        lastMatch={lastMatch ? {
          id: lastMatch.id,
          abbr_home: abbr(derivedTeamMap.get(lastMatch.id)?.team_home ?? lastMatch.team_home),
          abbr_away: abbr(derivedTeamMap.get(lastMatch.id)?.team_away ?? lastMatch.team_away),
          score_home: lastMatch.score_home ?? 0,
          score_away: lastMatch.score_away ?? 0,
          penalty_winner: lastMatch.penalty_winner ?? null,
        } : null}
        nextMatch={nextMatch ? {
          id: nextMatch.id,
          abbr_home: abbr(derivedTeamMap.get(nextMatch.id)?.team_home ?? nextMatch.team_home),
          abbr_away: abbr(derivedTeamMap.get(nextMatch.id)?.team_away ?? nextMatch.team_away),
          score_home: nextMatch.score_home ?? 0,
          score_away: nextMatch.score_away ?? 0,
          penalty_winner: nextMatch.penalty_winner ?? null,
        } : null}
        eliminatedTeams={eliminatedTeams}
        eliminatedStdScorers={[...new Set(eliminatedStdScorers)]}
        scorerMapping={scorerMapping}
        teamAbbrs={teamAbbrs}
        prizeSpots={prizeSpots}
        premioSpots={premioSpots}
        prizeAmounts={prizeAmounts}
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
        cutsExecuted={{ corte1: corte1Executado, corte2: corte2Executado }}
      />
    </>
  )
}
