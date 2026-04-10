import { cookies } from 'next/headers'

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
  supabase: AnySupabase,
  userId: string,
): Promise<string> {
  const cookieStore   = await cookies()
  const cookieId      = cookieStore.get(COOKIE)?.value

  if (cookieId) {
    const { data } = await supabase
      .from('user_participants')
      .select('participant_id')
      .eq('user_id', userId)
      .eq('participant_id', cookieId)
      .maybeSingle()
    if (data) return cookieId
  }

  // Fallback: primeiro participante vinculado (qualquer)
  const { data: first } = await supabase
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
  supabase: AnySupabase,
  userId: string,
  activeParticipantId: string,
): Promise<{ id: string; apelido: string; is_primary: boolean; is_active: boolean }[]> {
  const { data } = await supabase
    .from('user_participants')
    .select('participant_id, is_primary, participants(id, apelido)')
    .eq('user_id', userId)

  return (data ?? []).map((row: AnySupabase) => ({
    id:         row.participants.id as string,
    apelido:    row.participants.apelido as string,
    is_primary: row.is_primary as boolean,
    is_active:  row.participants.id === activeParticipantId,
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
