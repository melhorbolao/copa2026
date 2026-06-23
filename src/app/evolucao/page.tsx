export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { getServerNow } from '@/lib/production-mode'
import { Navbar } from '@/components/layout/Navbar'
import { EvolucaoClient } from './EvolucaoClient'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'
import { scoreTournamentBet } from '@/lib/scoring/engine'

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
        .range(from, from + PAGE - 1)
      if (!data || data.length === 0) break
      rawDailyPoints.push(...(data as typeof rawDailyPoints))
      if (data.length < PAGE) break
      from += PAGE
    }
  }

  const [
    participantsRes, panelaRes, liveScoresRawRes, matchesTodayRes,
    artillarySettingRes, rulesRes, scorerMappingRes, tournamentBetsRes, topScorersRes, knockoutMatchesRes,
  ] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    // Pontuação ao vivo (total acumulado) de todos os participantes
    admin.from('participant_scores').select('participant_id, pts_total'),
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
    // Palpites de torneio completos + pontos armazenados (para ajuste G4)
    admin.from('tournament_bets')
      .select('participant_id, champion, runner_up, semi1, semi2, top_scorer, points')
      .then((r: { data: { participant_id: string; champion: string | null; runner_up: string | null; semi1: string | null; semi2: string | null; top_scorer: string | null; points: number | null }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
      .then((r: { data: { player_name: string; goals_count: number }[] | null }) => r, () => ({ data: [] })),
    // Resultados do mata-mata (para calcular ptsG4 ao vivo)
    admin.from('matches')
      .select('phase, team_home, team_away, score_home, score_away, penalty_winner')
      .in('phase', ['quarterfinal', 'semifinal', 'third_place', 'final'])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((r: any) => r, () => ({ data: [] })),
  ])

  const participants: { id: string; apelido: string }[] = participantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map((r: { member_participant_id: string }) => r.member_participant_id)

  // ── Ajuste G4 nos live scores (espelha classificacaoMB) ──────────────────────
  // participant_scores.pts_total usa tournament_bets.points (armazenado, pode estar desatualizado).
  // classificacaoMB recalcula ptsG4 ao vivo com scoreTournamentBet. Replicamos aqui.
  const artillaryActive = artillarySettingRes?.data?.value === 'true'
  const rules: Record<string, number> = Object.fromEntries(
    ((rulesRes.data ?? []) as { key: string; points: number }[]).map(r => [r.key, r.points])
  )
  const scorerMapping: Record<string, string> = Object.fromEntries(
    ((scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string }[])
      .map(m => [m.raw_name.toLowerCase().trim(), m.standardized_name])
  )

  // Resultados do mata-mata
  function koWinner(m: {
    team_home: string; team_away: string
    score_home: number | null; score_away: number | null; penalty_winner: string | null
  }): string | null {
    if (m.score_home == null || m.score_away == null) return null
    if (m.score_home > m.score_away) return m.team_home
    if (m.score_away > m.score_home) return m.team_away
    if (m.penalty_winner === 'H') return m.team_home
    if (m.penalty_winner === 'A') return m.team_away
    return null
  }
  function koLoser(m: Parameters<typeof koWinner>[0]): string | null {
    const w = koWinner(m); if (!w) return null
    return w === m.team_home ? m.team_away : m.team_home
  }

  const koMatches = (knockoutMatchesRes.data ?? []) as {
    phase: string; team_home: string; team_away: string
    score_home: number | null; score_away: number | null; penalty_winner: string | null
  }[]
  const koDone = koMatches.filter(m => m.score_home !== null)
  const qfDone  = koDone.filter(m => m.phase === 'quarterfinal')
  const sfDone  = koDone.filter(m => m.phase === 'semifinal')
  const finDone = koDone.filter(m => m.phase === 'final')
  const tpDone  = koDone.filter(m => m.phase === 'third_place')

  const semifinalists = qfDone.map(koWinner).filter(Boolean) as string[]
  const finalists     = sfDone.map(koWinner).filter(Boolean) as string[]
  const champion      = finDone.length > 0 ? koWinner(finDone[0]) : null
  const runnerUp      = finDone.length > 0 ? koLoser(finDone[0])  : null
  const third         = tpDone.length > 0  ? koWinner(tpDone[0])  : null
  const fourth        = tpDone.length > 0  ? koLoser(tpDone[0])   : null

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

  // Pontos G4 ao vivo (liveG4) e armazenados (storedG4) por participante
  const liveG4PtsMap:   Record<string, number> = {}
  const storedG4PtsMap: Record<string, number> = {}
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
    storedG4PtsMap[tb.participant_id] = tb.points ?? 0
  }

  const rawLiveScores = (liveScoresRawRes.data ?? []) as { participant_id: string; pts_total: number }[]
  const liveScores: { participant_id: string; pts_total: number }[] = rawLiveScores.map(ls => ({
    participant_id: ls.participant_id,
    pts_total: ls.pts_total
      - (storedG4PtsMap[ls.participant_id] ?? 0)
      + (liveG4PtsMap[ls.participant_id]   ?? 0),
  }))

  const adjustedRawDailyPoints = rawDailyPoints.map(r => {
    const stored = storedG4PtsMap[r.participant_id] ?? 0
    const live   = liveG4PtsMap[r.participant_id]   ?? 0
    if (stored === live) return r
    return { ...r, pts_tournament: r.pts_tournament - stored + live }
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
