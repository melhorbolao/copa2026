// POST /api/scoring/recalculate
// Admin-only endpoint for triggering a full or partial score recalculation.
// Body (optional): { matchId?: string }
//   - matchId → recalculate only what changed after that match was scored
//   - (no body) → full recalculation of every scored match

export const maxDuration = 60  // extend Vercel function timeout to 60 s

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { recalculateAfterMatchScore, recalculateAll } from '@/lib/scoring/recalculate'

export async function POST(req: NextRequest) {
  // Auth: must be an admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const matchId: string | undefined = body?.matchId

  try {
    if (matchId) {
      await recalculateAfterMatchScore(matchId)
    } else {
      await recalculateAll()
    }
  } catch (err) {
    console.error('[scoring/recalculate]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { count: betsWithPts } = await admin.from('bets').select('*', { count: 'exact', head: true }).gt('points', 0)
  const { count: ppdRows }     = await admin.from('participant_points_by_day').select('*', { count: 'exact', head: true })
  const { data: ppdSample }    = await admin.from('participant_points_by_day').select('event_date').order('event_date').limit(5)

  return NextResponse.json({ ok: true, recalculated: matchId ?? 'all', diag: { betsWithPts, ppdRows, ppdDates: ppdSample?.map((r: any) => r.event_date) } })
}
