// GET /api/admin/diag  — diagnóstico temporário do estado de pontuação
import { NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [
    { count: betsTotal },
    { count: betsWithPts },
    { count: betsNullPts },
    { count: ppdRows },
    { data: scoredMatches },
  ] = await Promise.all([
    admin.from('bets').select('*', { count: 'exact', head: true }),
    admin.from('bets').select('*', { count: 'exact', head: true }).gt('points', 0),
    admin.from('bets').select('*', { count: 'exact', head: true }).is('points', null),
    admin.from('participant_points_by_day').select('*', { count: 'exact', head: true }),
    admin.from('matches').select('id, score_home, score_away, match_datetime').not('score_home', 'is', null).order('match_datetime'),
  ])

  // Datas distintas em participant_points_by_day
  const { data: ppdDistinct } = await admin
    .from('participant_points_by_day')
    .select('event_date')
    .order('event_date')
    .limit(1000)
  const distinctDates = [...new Set((ppdDistinct ?? []).map((r: any) => r.event_date as string))]

  // Testar fn_get_ranking_snapshot para as datas disponíveis
  const snapshotChecks: Record<string, number> = {}
  for (const d of distinctDates.slice(0, 3)) {
    const { data: snap, error: snapErr } = await (admin as any).rpc('fn_get_ranking_snapshot', { p_date: d })
    snapshotChecks[d] = snapErr ? -1 : (snap?.length ?? 0)
  }

  // Amostra de 3 linhas de participant_points_by_day
  const { data: ppdSample } = await admin
    .from('participant_points_by_day')
    .select('participant_id, event_date, pts_matches')
    .limit(3)

  // Converter datetimes para BR (UTC-3)
  const toBR = (iso: string) =>
    new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

  return NextResponse.json({
    betsTotal,
    betsWithPts,
    betsNullPts,
    ppdRows,
    ppdDistinctDates: distinctDates,
    ppdSample,
    snapshotChecks,
    scoredMatches: scoredMatches?.map((m: any) => ({
      id: m.id.slice(0, 8),
      utcDate:  m.match_datetime?.slice(0, 10),
      brDate:   toBR(m.match_datetime),
    })),
  })
}
