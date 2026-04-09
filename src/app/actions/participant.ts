'use server'

import { createClient } from '@/lib/supabase/server'
import { setActiveParticipantCookie } from '@/lib/participant'

/** Troca o participante ativo (valida que o participante pertence ao usuário). */
export async function switchParticipant(participantId: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data } = await supabase
    .from('user_participants')
    .select('participant_id')
    .eq('user_id', user.id)
    .eq('participant_id', participantId)
    .maybeSingle()

  if (!data) return // Não autorizado — ignora silenciosamente
  await setActiveParticipantCookie(participantId)
}
