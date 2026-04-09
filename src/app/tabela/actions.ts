'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'

/**
 * Atualiza (ou insere) o palpite de classificados de um grupo a partir
 * de uma reordenação manual de empate feita na Minha Tabela.
 */
export async function updateGroupBetFromReorder(
  groupName: string,
  firstPlace: string,
  secondPlace: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)

  const { error } = await supabase
    .from('group_bets')
    .upsert(
      { participant_id: participantId, group_name: groupName, first_place: firstPlace, second_place: secondPlace },
      { onConflict: 'participant_id,group_name' },
    )
  if (error) throw new Error(error.message)

  revalidatePath('/tabela')
  revalidatePath('/palpites')
}
