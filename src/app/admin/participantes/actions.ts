'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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

  const supabase = await createAdminClient()
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

  // Vincula ao usuário (não é primary se já tem um)
  const { data: existingLink } = await supabase
    .from('user_participants').select('id').eq('user_id', data.userId).eq('is_primary', true).maybeSingle()

  const { error: linkErr } = await supabase.from('user_participants').insert({
    user_id: data.userId,
    participant_id: p.id,
    is_primary: !existingLink,
  })
  if (linkErr) return { error: linkErr.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function deleteParticipant(participantId: string): Promise<void> {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from('participants').delete().eq('id', participantId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/participantes')
}

export async function updateParticipantApelido(participantId: string, apelido: string): Promise<void> {
  await requireAdmin()
  const supabase = await createAdminClient()
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
  const supabase = await createAdminClient()
  await supabase.from('participants').update({ bio: bio.trim() || null }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function toggleParticipantPaid(participantId: string, current: boolean): Promise<void> {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase.from('participants').update({ paid: !current }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}
