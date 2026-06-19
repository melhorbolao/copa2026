export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { getServerNow } from '@/lib/production-mode'
import { Navbar } from '@/components/layout/Navbar'
import { EvolucaoClient } from './EvolucaoClient'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'

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
    artillarySettingRes, officialScorerSettingRes, rulesRes, scorerMappingRes, tournamentBetsRes, topScorersRes,
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
    // Configurações de artilharia (para alinhar live scores com a classificação)
    admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle()
      .then((r: { data: { value: string } | null }) => r, () => ({ data: null })),
    admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle()
      .then((r: { data: { value: string } | null }) => r, () => ({ data: null })),
    admin.from('scoring_rules').select('key, points')
      .then((r: { data: { key: string; points: number }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name')
      .then((r: { data: { raw_name: string; standardized_name: string }[] | null }) => r, () => ({ data: [] })),
    admin.from('tournament_bets').select('participant_id, top_scorer')
      .then((r: { data: { participant_id: string; top_scorer: string | null }[] | null }) => r, () => ({ data: [] })),
    admin.from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
      .then((r: { data: { player_name: string; goals_count: number }[] | null }) => r, () => ({ data: [] })),
  ])

  const participants: { id: string; apelido: string }[] = participantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map((r: { member_participant_id: string }) => r.member_participant_id)

  // ── Ajuste de artilharia nos live scores ─────────────────────────────────────
  // participant_scores.pts_total inclui artilharia de tournament_bets.points (sempre).
  // classificacaoMB calcula ptsG4 ao vivo e zera artilharia quando o flag está off.
  // Aqui replicamos essa lógica para que o ponto "Hoje" do gráfico seja consistente.
  const artillaryActive = artillarySettingRes?.data?.value === 'true'
  const artilheiroPts = ((rulesRes.data ?? []) as { key: string; points: number }[])
    .find(r => r.key === 'artilheiro')?.points ?? 18

  const scorerMapping: Record<string, string> = Object.fromEntries(
    ((scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string }[])
      .map(m => [m.raw_name.toLowerCase().trim(), m.standardized_name])
  )

  // Artilheiros ARMAZENADOS em tournament_bets.points: baseados em official_top_scorer setting
  let storedOfficialScorers: string[] = []
  if (officialScorerSettingRes?.data?.value) {
    try { storedOfficialScorers = JSON.parse(officialScorerSettingRes.data.value) }
    catch { storedOfficialScorers = [officialScorerSettingRes.data.value] }
  }

  // Artilheiros CORRETOS para a classificação atual (espelha classificacaoMB)
  let currentOfficialScorers: string[] = []
  if (artillaryActive) {
    const topScorersData = (topScorersRes?.data ?? []) as { player_name: string; goals_count: number }[]
    if (topScorersData.length > 0) {
      const maxGoals = topScorersData[0].goals_count
      if (maxGoals > 0) {
        currentOfficialScorers = topScorersData.filter(s => s.goals_count === maxGoals).map(s => s.player_name)
      }
    }
  }

  const storedArtilhariaSet  = new Set<string>()
  const currentArtilhariaSet = new Set<string>()
  const tourBets = (tournamentBetsRes.data ?? []) as { participant_id: string; top_scorer: string | null }[]
  for (const tb of tourBets) {
    if (!tb.top_scorer) continue
    const norm = (scorerMapping[tb.top_scorer.toLowerCase().trim()] ?? tb.top_scorer).trim().toLowerCase()
    if (storedOfficialScorers.some(s => s.trim().toLowerCase() === norm))  storedArtilhariaSet.add(tb.participant_id)
    if (currentOfficialScorers.some(s => s.trim().toLowerCase() === norm)) currentArtilhariaSet.add(tb.participant_id)
  }

  const rawLiveScores = (liveScoresRawRes.data ?? []) as { participant_id: string; pts_total: number }[]
  const liveScores: { participant_id: string; pts_total: number }[] = rawLiveScores.map(ls => ({
    participant_id: ls.participant_id,
    pts_total: ls.pts_total
      - (storedArtilhariaSet.has(ls.participant_id)  ? artilheiroPts : 0)
      + (currentArtilhariaSet.has(ls.participant_id) ? artilheiroPts : 0),
  }))

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
        rawDailyPoints={rawDailyPoints}
        liveScores={liveScores}
        todayStr={todayStr}
        hasMatchToday={hasMatchToday}
      />
    </>
  )
}
