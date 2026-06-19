// POST /api/scoring/recalculate-daily[?mode=auto]
// Admin-only. Rebuilds participant_points_by_day from current scored bets.
// mode=auto  → apenas dados até D-1 (evita parcialidade do dia corrente)
// mode=manual → todos os dados (padrão do botão admin)

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { recalculateDailyPoints } from '@/lib/scoring/daily-points'

export const dynamic = 'force-dynamic'

// UTC-6: consistente com daily-points.ts (jogos às 1h/2h BRT = dia anterior no bolão)
function toBRDate(d: Date): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(d)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const mode = new URL(req.url).searchParams.get('mode') ?? 'manual'
  const isAuto = mode === 'auto'

  const now       = new Date()
  const todayBR   = toBRDate(now)
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayBR = toBRDate(yesterday)

  try {
    const result = await recalculateDailyPoints(isAuto ? { upToDate: yesterdayBR } : undefined)

    // Registra data do último recalc para evitar chamadas redundantes no mesmo dia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    await admin.from('tournament_settings').upsert(
      [
        { key: 'daily_points_last_run',   value: todayBR },
        { key: 'evolucao_daily_last_run', value: todayBR },
      ],
      { onConflict: 'key' },
    )

    return NextResponse.json({ ...result, lastRun: todayBR })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro inesperado' },
      { status: 500 },
    )
  }
}
