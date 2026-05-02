'use server'

import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('users').select('is_admin, name').eq('id', user.id).single()
  return { user, profile, isAdmin: profile?.is_admin ?? false }
}

// ── Stadium Attendance ─────────────────────────────────────────────────────

export async function upsertAttendance(
  matchId: string,
  participantIds: string[],
  present: boolean,
): Promise<{ error?: string }> {
  try {
    const ctx = await getUser()
    if (!ctx) return { error: 'Não autenticado' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any

    if (!present) {
      await admin.from('stadium_attendance').delete().match({ match_id: matchId, user_id: ctx.user.id })
    } else {
      await admin.from('stadium_attendance').upsert(
        { match_id: matchId, user_id: ctx.user.id, participant_ids: participantIds },
        { onConflict: 'match_id,user_id' },
      )
    }
    revalidatePath('/jogos')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro' }
  }
}

// ── Stadium Photos ─────────────────────────────────────────────────────────

export async function addStadiumPhoto(
  matchId: string,
  storagePath: string,
  participantIds: string[],
  caption: string,
): Promise<{ error?: string }> {
  try {
    const ctx = await getUser()
    if (!ctx) return { error: 'Não autenticado' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { error } = await admin.from('stadium_photos').insert({
      match_id: matchId, user_id: ctx.user.id,
      storage_path: storagePath, participant_ids: participantIds, caption,
    })
    if (error) return { error: error.message }
    revalidatePath('/jogos')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro' }
  }
}

export async function tagStadiumPhoto(
  photoId: string,
  participantIds: string[],
): Promise<{ error?: string }> {
  try {
    const ctx = await getUser()
    if (!ctx) return { error: 'Não autenticado' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data: photo } = await admin.from('stadium_photos').select('participant_ids').eq('id', photoId).single()
    if (!photo) return { error: 'Foto não encontrada' }
    const merged = [...new Set([...(photo.participant_ids ?? []), ...participantIds])]
    const { error } = await admin.from('stadium_photos').update({ participant_ids: merged }).eq('id', photoId)
    if (error) return { error: error.message }
    revalidatePath('/jogos')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro' }
  }
}

export async function deleteStadiumPhoto(
  photoId: string,
): Promise<{ error?: string }> {
  try {
    const ctx = await getUser()
    if (!ctx) return { error: 'Não autenticado' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data: photo } = await admin.from('stadium_photos').select('user_id, storage_path').eq('id', photoId).single()
    if (!photo) return { error: 'Foto não encontrada' }
    if (!ctx.isAdmin && photo.user_id !== ctx.user.id) return { error: 'Sem permissão' }
    await admin.from('stadium_photos').delete().eq('id', photoId)
    // also delete from storage
    await admin.storage.from('stadium-photos').remove([photo.storage_path])
    revalidatePath('/jogos')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro' }
  }
}
