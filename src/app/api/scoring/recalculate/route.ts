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

  // Invalida o cache de pontos diários: a próxima visita à evolução/classificacaoMB
  // vai recalcular participant_points_by_day com os resultados recém-inseridos.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    await admin.from('tournament_settings').upsert(
      [
        { key: 'daily_points_last_run',   value: 'stale' },
        { key: 'evolucao_daily_last_run', value: 'stale' },
      ],
      { onConflict: 'key' },
    )
  } catch { /* tournament_settings pode não existir — ignora */ }

  return NextResponse.json({ ok: true, recalculated: matchId ?? 'all' })
}
