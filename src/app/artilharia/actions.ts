'use server'

import { createClient } from '@/lib/supabase/server'

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function updateGoalsCount(
  id: string,
  goalsCount: number,
): Promise<{ error?: string }> {
  try {
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }
    if (goalsCount < 0) return { error: 'Gols não podem ser negativos' }

    const supabase = await createClient()
    const { error } = await supabase
      .from('top_scorers')
      .update({
        goals_count: goalsCount,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('id', id)

    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function insertTopScorer(
  playerName: string,
  team: string,
  goalsCount: number,
): Promise<{ id?: string; error?: string }> {
  try {
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }
    if (!playerName.trim()) return { error: 'Nome do jogador é obrigatório' }
    if (goalsCount < 0) return { error: 'Gols não podem ser negativos' }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('top_scorers')
      .insert({
        player_name: playerName.trim(),
        team: team.trim(),
        goals_count: goalsCount,
        updated_by: user.id,
      })
      .select('id')
      .single()

    if (error) return { error: error.message }
    return { id: data.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
