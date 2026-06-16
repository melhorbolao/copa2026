export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { getServerNow } from '@/lib/production-mode'
import { Navbar } from '@/components/layout/Navbar'
import { EvolucaoClient } from './EvolucaoClient'

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

  // Janela UTC correspondente ao dia bolão: meia-noite UTC-6 = 06:00 UTC
  const todayStartUTC   = `${todayStr}T06:00:00.000Z`
  const tomorrowStartUTC = new Date(new Date(todayStartUTC).getTime() + 24 * 60 * 60 * 1000).toISOString()

  const [participantsRes, panelaRes, dailyPointsRes, liveScoresRes, matchesTodayRes] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    // Apenas histórico: exclui hoje para que o ponto "Hoje" venha exclusivamente do live
    admin.from('participant_points_by_day')
      .select('event_date, participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament')
      .lt('event_date', todayStr)
      .order('event_date', { ascending: true }),
    // Pontuação ao vivo (total acumulado) de todos os participantes
    admin.from('participant_scores').select('participant_id, pts_total'),
    // Jogos de hoje: verifica se há ao menos um iniciado ou finalizado
    admin.from('matches')
      .select('match_datetime, score_home')
      .gte('match_datetime', todayStartUTC)
      .lt('match_datetime', tomorrowStartUTC),
  ])

  const participants: { id: string; apelido: string }[] = participantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map((r: { member_participant_id: string }) => r.member_participant_id)

  const rawDailyPoints: {
    event_date: string
    participant_id: string
    pts_matches: number
    pts_groups: number
    pts_thirds: number
    pts_tournament: number
  }[] = dailyPointsRes.data ?? []

  const liveScores: { participant_id: string; pts_total: number }[] = liveScoresRes.data ?? []

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
