// GET /api/rankings/snapshots?date=YYYY-MM-DD
// Retorna o snapshot mais recente (≤ date) de cada participante.
// Autenticação: usuário logado.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = new URL(req.url)
  const date = url.searchParams.get('date')

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
  }

  // Tenta usar a função SQL DISTINCT ON para eficiência
  const { data, error } = await supabase
    .rpc('get_rankings_at_date', { p_date: date })

  if (!error) {
    return NextResponse.json(data ?? [])
  }

  // Fallback: query simples + deduplicação em JS
  // (funciona antes de rodar a migration)
  const { data: rows, error: e2 } = await supabase
    .from('daily_rankings_snapshot')
    .select(
      'participant_id, rank, pts_total, pts_matches, pts_groups, pts_thirds, pts_tournament, snapshot_date'
    )
    .lte('snapshot_date', date)
    .order('snapshot_date', { ascending: false })
    .limit(5000)

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  // Manter apenas o snapshot mais recente por participante
  const latest: Record<string, (typeof rows)[0]> = {}
  for (const row of rows ?? []) {
    if (!latest[row.participant_id]) latest[row.participant_id] = row
  }
  return NextResponse.json(Object.values(latest))
}
