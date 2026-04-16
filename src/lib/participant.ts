import { cache }  from 'react'
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

// Cache interno por request: a chave é userId (o argumento _supabase é ignorado).
// React.cache() deduplicata chamadas com o mesmo userId dentro da mesma árvore
// de render — Navbar e page.tsx não fazem mais 2 round-trips separados.
const _resolveParticipantId = cache(async (userId: string): Promise<string> => {
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

  // Fallback: primeiro participante vinculado
  const { data: first } = await admin
    .from('user_participants')
    .select('participant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()

  if (!first?.participant_id) throw new Error('Nenhum participante vinculado a este usuário.')
  return first.participant_id
})

/**
 * Resolve o participante ativo para um usuário.
 * Prioridade: cookie → participante primário.
 * Lança erro se o usuário não tiver nenhum participante vinculado.
 */
export async function getActiveParticipantId(
  _supabase: AnySupabase,
  userId: string,
): Promise<string> {
  return _resolveParticipantId(userId)
}

// Cache interno para a lista de participantes do usuário
const _resolveUserParticipants = cache(async (
  userId: string,
  activeParticipantId: string,
): Promise<{ id: string; apelido: string; is_primary: boolean; is_active: boolean }[]> => {
  const admin = createAuthAdminClient()

  // Uma única query com join via FK (user_participants.participant_id → participants.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await admin
    .from('user_participants')
    .select('participant_id, is_primary, participants(id, apelido)')
    .eq('user_id', userId) as { data: any[] | null }

  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.participants)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((l: any) => ({
      id:         l.participant_id as string,
      apelido:    l.participants.apelido as string,
      is_primary: l.is_primary as boolean,
      is_active:  l.participant_id === activeParticipantId,
    }))
})

/**
 * Retorna todos os participantes vinculados ao usuário,
 * com flag indicando qual está ativo.
 */
export async function getUserParticipants(
  _supabase: AnySupabase,
  userId: string,
  activeParticipantId: string,
): Promise<{ id: string; apelido: string; is_primary: boolean; is_active: boolean }[]> {
  return _resolveUserParticipants(userId, activeParticipantId)
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
