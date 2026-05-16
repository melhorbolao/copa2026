// POST /api/scoring/recalculate-daily
// Admin-only. Rebuilds participant_points_by_day from current scored bets.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const result = await recalculateDailyPoints()
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro inesperado' },
      { status: 500 },
    )
  }
}
