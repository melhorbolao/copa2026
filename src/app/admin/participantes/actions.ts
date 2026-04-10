'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

export async function createParticipant(data: {
  userId: string
  apelido: string
  bio?: string
}): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }

  const supabase = createAuthAdminClient()
  const apelidoTrimmed = data.apelido.trim()
  if (!apelidoTrimmed) return { error: 'Nome no Bolão é obrigatório.' }

  // Verifica unicidade do apelido
  const { data: existing } = await supabase
    .from('participants').select('id').eq('apelido', apelidoTrimmed).maybeSingle()
  if (existing) return { error: `O nome "${apelidoTrimmed}" já está em uso por outro participante.` }

  // Cria participante
  const { data: p, error: pErr } = await supabase
    .from('participants')
    .insert({ apelido: apelidoTrimmed, bio: data.bio?.trim() || null, paid: false })
    .select('id')
    .single()
  if (pErr || !p?.id) return { error: pErr?.message ?? 'Erro ao criar participante.' }

  // Usuário selecionado é sempre o dono/primário deste participante
  const { error: linkErr } = await supabase.from('user_participants').insert({
    user_id: data.userId,
    participant_id: p.id,
    is_primary: true,
  })
  if (linkErr) return { error: linkErr.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function deleteParticipant(participantId: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const { error } = await supabase.from('participants').delete().eq('id', participantId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/participantes')
}

export async function setPrimaryUser(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Verifica que o usuário está vinculado ao participante
  const { data: link } = await supabase
    .from('user_participants').select('id').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (!link) return { error: 'Usuário não vinculado a este participante.' }

  // Remove is_primary de todos os usuários deste participante
  await supabase.from('user_participants').update({ is_primary: false }).eq('participant_id', participantId)
  // Define o novo primário
  const { error } = await supabase.from('user_participants').update({ is_primary: true })
    .eq('participant_id', participantId).eq('user_id', userId)
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function updateParticipantApelido(participantId: string, apelido: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const trimmed = apelido.trim()
  if (!trimmed) return

  // Verifica unicidade
  const { data: existing } = await supabase
    .from('participants').select('id').eq('apelido', trimmed).neq('id', participantId).maybeSingle()
  if (existing) throw new Error(`O nome "${trimmed}" já está em uso.`)

  await supabase.from('participants').update({ apelido: trimmed }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function updateParticipantBio(participantId: string, bio: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  await supabase.from('participants').update({ bio: bio.trim() || null }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function toggleParticipantPaid(participantId: string, current: boolean): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  await supabase.from('participants').update({ paid: !current }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function linkUserToParticipant(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Verifica se já está vinculado
  const { data: existing } = await supabase
    .from('user_participants').select('id').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (existing) return { error: 'Usuário já vinculado a este participante.' }

  const { error } = await supabase.from('user_participants').insert({
    participant_id: participantId,
    user_id: userId,
    is_primary: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function unlinkUserFromParticipant(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Não permite remover o usuário primário
  const { data: link } = await supabase
    .from('user_participants').select('is_primary').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (link?.is_primary) return { error: 'Não é possível remover o usuário principal.' }

  const { error } = await supabase
    .from('user_participants').delete().eq('participant_id', participantId).eq('user_id', userId)
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}
