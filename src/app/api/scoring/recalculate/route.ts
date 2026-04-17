// POST /api/scoring/recalculate
// Admin-only endpoint for triggering a full or partial score recalculation.
// Body (optional): { matchId?: string }
//   - matchId → recalculate only what changed after that match was scored
//   - (no body) → full recalculation of every scored match

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  // Run async without blocking the response
  const work = matchId
    ? recalculateAfterMatchScore(matchId)
    : recalculateAll()

  work.catch(err => console.error('[scoring/recalculate]', err))

  return NextResponse.json({ ok: true, queued: matchId ?? 'all' })
}
