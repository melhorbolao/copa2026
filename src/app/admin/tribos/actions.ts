'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

async function requireTribosAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!profile?.role || !['admin', 'master'].includes(profile.role))
    throw new Error('Acesso negado')
}

export interface Tribe {
  id: string
  name: string
  created_at: string
}

export interface Participant {
  id: string
  apelido: string
}

export async function getTribos(): Promise<Tribe[]> {
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('tribes')
    .select('id, name, created_at')
    .order('name')
  return (data ?? []) as Tribe[]
}

export async function getParticipantsForTribos(): Promise<Participant[]> {
  const admin = createAuthAdminClient()
  const { data } = await admin
    .from('participants')
    .select('id, apelido')
    .order('apelido')
  return (data ?? []) as Participant[]
}

export async function getTribeMemberIds(tribeId: string): Promise<string[]> {
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('participant_tribes')
    .select('participant_id')
    .eq('tribe_id', tribeId)
  return ((data ?? []) as { participant_id: string }[]).map(r => r.participant_id)
}

export async function createTribo(name: string): Promise<{ error?: string }> {
  try { await requireTribosAdmin() } catch { return { error: 'Acesso negado' } }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Nome obrigatório' }
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('tribes').insert({ name: trimmed })
  if (error) return { error: error.message }
  revalidatePath('/admin/tribos')
  return {}
}

export async function renameTribo(id: string, name: string): Promise<{ error?: string }> {
  try { await requireTribosAdmin() } catch { return { error: 'Acesso negado' } }
  const trimmed = name.trim()
  if (!trimmed) return { error: 'Nome obrigatório' }
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('tribes').update({ name: trimmed }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tribos')
  return {}
}

export async function deleteTribo(id: string): Promise<{ error?: string }> {
  try { await requireTribosAdmin() } catch { return { error: 'Acesso negado' } }
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('tribes').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/tribos')
  return {}
}

export async function saveTribeMembers(
  tribeId: string,
  participantIds: string[],
): Promise<{ error?: string }> {
  try { await requireTribosAdmin() } catch { return { error: 'Acesso negado' } }
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any
  const { error: delError } = await a
    .from('participant_tribes')
    .delete()
    .eq('tribe_id', tribeId)
  if (delError) return { error: delError.message }
  if (participantIds.length > 0) {
    const rows = participantIds.map(pid => ({ tribe_id: tribeId, participant_id: pid }))
    const { error: insError } = await a.from('participant_tribes').insert(rows)
    if (insError) return { error: insError.message }
  }
  revalidatePath('/admin/tribos')
  return {}
}
