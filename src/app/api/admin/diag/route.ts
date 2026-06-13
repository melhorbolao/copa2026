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
    { data: ppdDates },
    { data: scoredMatches },
  ] = await Promise.all([
    admin.from('bets').select('*', { count: 'exact', head: true }),
    admin.from('bets').select('*', { count: 'exact', head: true }).gt('points', 0),
    admin.from('bets').select('*', { count: 'exact', head: true }).is('points', null),
    admin.from('participant_points_by_day').select('*', { count: 'exact', head: true }),
    admin.from('participant_points_by_day').select('event_date').order('event_date').limit(10),
    admin.from('matches').select('id, score_home, score_away, match_datetime').not('score_home', 'is', null),
  ])

  return NextResponse.json({
    betsTotal,
    betsWithPts,
    betsNullPts,
    ppdRows,
    ppdDates: ppdDates?.map((r: any) => r.event_date),
    scoredMatchDates: scoredMatches?.map((m: any) => ({
      id: m.id.slice(0, 8),
      datetime: m.match_datetime?.slice(0, 10),
    })),
  })
}
