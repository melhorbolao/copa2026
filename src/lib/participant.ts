import { cookies } from 'next/headers'
import { createAuthAdminClient } from '@/lib/supabase/server'

const COOKIE = 'activeParticipantId'
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax'  as const,
  path:     '/',
  maxAge:   60 * 60 * 24 * 30,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

/**
 * Resolve o participante ativo para um usuário.
 * Prioridade: cookie → participante primário.
 * Lança erro se o usuário não tiver nenhum participante vinculado.
 */
export async function getActiveParticipantId(
  _supabase: AnySupabase,
  userId: string,
): Promise<string> {
  // Usa admin client para ignorar RLS em user_participants
  // A segurança é garantida pelo filtro user_id = userId (vem de auth.getUser())
  const admin = createAuthAdminClient()
  const cookieStore = await cookies()
  const cookieId    = cookieStore.get(COOKIE)?.value

  if (cookieId) {
    const { data } = await admin
      .from('user_participants')
      .select('participant_id')
      .eq('user_id', userId)
      .eq('participant_id', cookieId)
      .maybeSingle()
    if (data) return cookieId
  }

  // Fallback: primeiro participante vinculado (qualquer)
  const { data: first } = await admin
    .from('user_participants')
    .select('participant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (!first?.participant_id) throw new Error('Nenhum participante vinculado a este usuário.')
  return first.participant_id
}

/**
 * Retorna todos os participantes vinculados ao usuário,
 * com flag indicando qual está ativo.
 */
export async function getUserParticipants(
  _supabase: AnySupabase,
  userId: string,
  activeParticipantId: string,
): Promise<{ id: string; apelido: string; is_primary: boolean; is_active: boolean }[]> {
  const admin = createAuthAdminClient()
  const { data: links } = await admin
    .from('user_participants')
    .select('participant_id, is_primary')
    .eq('user_id', userId)

  if (!links?.length) return []

  const ids = links.map((l: AnySupabase) => l.participant_id as string)

  const { data: parts } = await admin
    .from('participants')
    .select('id, apelido')
    .in('id', ids)

  const partMap = new Map((parts ?? []).map((p: AnySupabase) => [p.id as string, p.apelido as string]))

  return links
    .filter((l: AnySupabase) => partMap.has(l.participant_id))
    .map((l: AnySupabase) => ({
      id:         l.participant_id as string,
      apelido:    partMap.get(l.participant_id) as string,
      is_primary: l.is_primary as boolean,
      is_active:  l.participant_id === activeParticipantId,
    }))
}

/** Escreve o cookie de participante ativo. */
export async function setActiveParticipantCookie(participantId: string) {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE, participantId, COOKIE_OPTS)
}

/** Remove o cookie (volta para o primário na próxima requisição). */
export async function clearActiveParticipantCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE)
}
