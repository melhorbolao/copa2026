'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { assertNotArchived } from '@/lib/tournament-lock'

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
    assertNotArchived('updateGoalsCount')
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

export async function setArtillaryPointsActive(
  active: boolean,
): Promise<{ error?: string }> {
  try {
    assertNotArchived('setArtillaryPointsActive')
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }

    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Acesso negado' }

    const admin = createAuthAdminClient()
    const { error } = await admin
      .from('tournament_settings')
      .upsert({ key: 'artillary_points_active', value: active ? 'true' : 'false' }, { onConflict: 'key' })

    if (error) return { error: error.message }
    revalidatePath('/copa2026/classificacaoMB')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function deleteTopScorer(id: string): Promise<{ error?: string }> {
  try {
    assertNotArchived('deleteTopScorer')
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }

    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Acesso negado' }

    const admin = createAuthAdminClient()
    const { error } = await admin.from('top_scorers').delete().eq('id', id)
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function updateTopScorerTeam(
  id: string,
  team: string,
): Promise<{ error?: string }> {
  try {
    assertNotArchived('updateTopScorerTeam')
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }

    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Acesso negado' }

    const { error } = await supabase
      .from('top_scorers')
      .update({ team: team || '', updated_at: new Date().toISOString(), updated_by: user.id })
      .eq('id', id)

    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function updateTopScorerPhoto(
  id: string,
  photoUrl: string,
): Promise<{ error?: string }> {
  try {
    assertNotArchived('updateTopScorerPhoto')
    const user = await getAuthUser()
    if (!user) return { error: 'Não autenticado' }

    const supabase = await createClient()
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Acesso negado' }

    const { error } = await supabase
      .from('top_scorers')
      .update({ photo_url: photoUrl || null, updated_at: new Date().toISOString(), updated_by: user.id })
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
    assertNotArchived('insertTopScorer')
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

    if (error) {
      if (error.code === '23505') return { error: 'Já existe um artilheiro com esse nome.' }
      return { error: error.message }
    }
    return { id: data.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
