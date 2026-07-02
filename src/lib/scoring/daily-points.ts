// Server-only. Rebuilds participant_points_by_day from current bet data.
//
// A agregação + swap (DELETE de toda a tabela + INSERT dos novos totais)
// roda inteiramente dentro de fn_recalculate_daily_points (Postgres), como
// uma única transação serializada por advisory lock. Isso evita a condição
// de corrida da versão anterior (delete + reinsert em lotes via várias
// chamadas HTTP separadas), que podia deixar leitores (fn_get_ranking_snapshot)
// verem a tabela parcialmente vazia, ou fazer uma execução concorrente
// sobrescrever com dados desatualizados.

import { createAuthAdminClient } from '@/lib/supabase/server'

export async function recalculateDailyPoints(options?: { upToDate?: string }): Promise<{ count: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const { data, error } = await admin.rpc('fn_recalculate_daily_points', {
    p_up_to_date: options?.upToDate ?? null,
  })
  if (error) throw new Error(error.message)

  return { count: Number(data ?? 0) }
}
