// GET /api/rankings/snapshots?date=YYYY-MM-DD
// Delega a agregação e o rank para fn_get_ranking_snapshot (PL/pgSQL STABLE).
// Antes: baixava N×dias linhas de participant_points_by_day para agregar no Node.js.
// Agora: retorna ~100 linhas (uma por participante) já rankeadas pelo banco.

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('fn_get_ranking_snapshot', { p_date: date })
  if (error) {
    console.error('[snapshots] rpc error', date, error)
    return NextResponse.json({ error: error.message, date }, { status: 500 })
  }

  // Injeta snapshot_date para compatibilidade com SnapshotEntry no cliente
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (data ?? []).map((row: any) => ({ ...row, snapshot_date: date }))
  return NextResponse.json(result)
}
