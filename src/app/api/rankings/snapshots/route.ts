// GET /api/rankings/snapshots?date=YYYY-MM-DD
// Agrega participant_points_by_day até a data solicitada e retorna com rank.

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
  const { data, error } = await (supabase as any)
    .from('participant_points_by_day')
    .select('participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament')
    .lte('event_date', date)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((error as any)?.message) return NextResponse.json({ error: (error as any).message }, { status: 500 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return NextResponse.json([])

  // Aggregate by participant
  const totals = new Map<string, {
    pts_matches: number; pts_groups: number; pts_thirds: number; pts_tournament: number; pts_total: number
  }>()

  for (const row of rows) {
    let t = totals.get(row.participant_id)
    if (!t) {
      t = { pts_matches: 0, pts_groups: 0, pts_thirds: 0, pts_tournament: 0, pts_total: 0 }
      totals.set(row.participant_id, t)
    }
    const m  = row.pts_matches    ?? 0
    const g  = row.pts_groups     ?? 0
    const th = row.pts_thirds     ?? 0
    const to = row.pts_tournament ?? 0
    t.pts_matches    += m
    t.pts_groups     += g
    t.pts_thirds     += th
    t.pts_tournament += to
    t.pts_total      += m + g + th + to
  }

  // Sort desc and assign dense rank (ties share the same rank)
  const sorted = [...totals.entries()].sort(([, a], [, b]) => b.pts_total - a.pts_total)

  const result = []
  let rank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1].pts_total < sorted[i - 1][1].pts_total) rank = i + 1
    const [pid, t] = sorted[i]
    result.push({
      participant_id: pid,
      rank,
      pts_total:      t.pts_total,
      pts_matches:    t.pts_matches,
      pts_groups:     t.pts_groups,
      pts_thirds:     t.pts_thirds,
      pts_tournament: t.pts_tournament,
      snapshot_date:  date,
    })
  }

  return NextResponse.json(result)
}
