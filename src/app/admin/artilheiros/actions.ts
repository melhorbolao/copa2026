'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  return data?.is_admin ? true : null
}

export async function upsertTopScorerMapping(
  rawName: string,
  standardizedName: string,
): Promise<{ error?: string }> {
  try {
    if (!(await requireAdmin())) return { error: 'Sem permissão' }
    const admin = await createAdminClient()
    const { error } = await admin
      .from('top_scorer_mapping')
      .upsert({ raw_name: rawName, standardized_name: standardizedName.trim() }, { onConflict: 'raw_name' })
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function deleteTopScorerMapping(rawName: string): Promise<{ error?: string }> {
  try {
    if (!(await requireAdmin())) return { error: 'Sem permissão' }
    const admin = await createAdminClient()
    const { error } = await admin
      .from('top_scorer_mapping')
      .delete()
      .eq('raw_name', rawName)
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function updateScorerElimination(
  rawName: string,
  isEliminated: boolean,
): Promise<{ error?: string }> {
  try {
    if (!(await requireAdmin())) return { error: 'Sem permissão' }
    const admin = await createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('top_scorer_mapping')
      .update({ is_eliminated: isEliminated })
      .eq('raw_name', rawName)
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
