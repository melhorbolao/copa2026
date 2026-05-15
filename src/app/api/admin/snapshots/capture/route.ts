// POST /api/admin/snapshots/capture
// Admin-only: tira um snapshot do ranking atual e persiste em daily_rankings_snapshot.
// Body (opcional): { date?: "YYYY-MM-DD" }  — padrão: hoje (horário de Brasília).

export const dynamic   = 'force-dynamic'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

function todayBR(): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // Data alvo (padrão: hoje no Brasil)
  let targetDate = todayBR()
  try {
    const body = await req.json()
    if (body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) targetDate = body.date
  } catch { /* usa hoje */ }

  // 1. Lê scores atuais
  const { data: scores, error: scoresErr } = await admin
    .from('participant_scores')
    .select('participant_id, pts_total, pts_matches, pts_groups, pts_thirds, pts_tournament')

  if (scoresErr || !scores?.length) {
    return NextResponse.json({ error: scoresErr?.message ?? 'Nenhum score encontrado' }, { status: 500 })
  }

  // 2. Calcula rank (competição padrão: 1, 1, 3, 4…)
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

  // 3. Upsert
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
