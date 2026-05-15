// GET /api/cron/snapshot
// Cron diário às 6h (Brasília) — captura ranking em daily_rankings_snapshot.
// Só executa quando productionMode = true (Copa em andamento).

export const dynamic    = 'force-dynamic'
export const maxDuration = 30

import { NextResponse } from 'next/server'
import { createAuthAdminClient } from '@/lib/supabase/server'
import { getVisibilitySettings } from '@/lib/production-mode'

function todayBR(): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const settings = await getVisibilitySettings()
  if (!settings.productionMode) {
    return NextResponse.json({ skipped: true, reason: 'Copa não está em andamento (productionMode=false)' })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const targetDate = todayBR()

  const { data: scores, error: scoresErr } = await admin
    .from('participant_scores')
    .select('participant_id, pts_total, pts_matches, pts_groups, pts_thirds, pts_tournament')

  if (scoresErr || !scores?.length) {
    return NextResponse.json({ error: scoresErr?.message ?? 'Nenhum score encontrado' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sorted = [...(scores as any[])].sort((a, b) => b.pts_total - a.pts_total)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withRanks: Array<typeof sorted[0] & { rank: number }> = []
  for (let i = 0; i < sorted.length; i++) {
    const rank = i > 0 && sorted[i].pts_total === sorted[i - 1].pts_total
      ? withRanks[i - 1].rank
      : i + 1
    withRanks.push({ ...sorted[i], rank })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = withRanks.map((s: any) => ({
    snapshot_date:  targetDate,
    participant_id: s.participant_id,
    rank:           s.rank,
    pts_total:      s.pts_total      ?? 0,
    pts_matches:    s.pts_matches    ?? 0,
    pts_groups:     s.pts_groups     ?? 0,
    pts_thirds:     s.pts_thirds     ?? 0,
    pts_tournament: s.pts_tournament ?? 0,
  }))

  const { error: upsertErr } = await admin
    .from('daily_rankings_snapshot')
    .upsert(rows, { onConflict: 'snapshot_date,participant_id' })

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, captured: rows.length, date: targetDate })
}
