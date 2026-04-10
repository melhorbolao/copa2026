'use server'

import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'

/**
 * Busca os palpites atuais do grupo diretamente do banco.
 * Usado para detectar conflitos com dados frescos no momento do save.
 */
export async function getGroupBets(groupName: string): Promise<{
  groupBet: { first_place: string; second_place: string } | null
  thirdBet:  { team: string } | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { groupBet: null, thirdBet: null }
  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) return { groupBet: null, thirdBet: null }

  const [{ data: gb }, { data: tb }] = await Promise.all([
    supabase.from('group_bets')
      .select('first_place, second_place')
      .eq('participant_id', participantId)
      .eq('group_name', groupName)
      .maybeSingle(),
    supabase.from('third_place_bets')
      .select('team')
      .eq('participant_id', participantId)
      .eq('group_name', groupName)
      .maybeSingle(),
  ])

  return {
    groupBet: gb ? { first_place: gb.first_place, second_place: gb.second_place } : null,
    thirdBet:  tb ? { team: tb.team } : null,
  }
}

/**
 * Salva os palpites conflitantes após resolução manual de empate.
 * Atualiza apenas o que for passado (groupBet e/ou thirdBet).
 */
export async function updateGroupBetFromReorder(
  groupName: string,
  groupBetUpdate: { firstPlace: string; secondPlace: string } | null,
  thirdBetUpdate: { team: string } | null,
) {
  if (!groupBetUpdate && !thirdBetUpdate) return

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)

  const admin = createAuthAdminClient()

  if (groupBetUpdate) {
    const { error } = await admin
      .from('group_bets')
      .upsert(
        {
          participant_id: participantId,
          group_name: groupName,
          first_place: groupBetUpdate.firstPlace,
          second_place: groupBetUpdate.secondPlace,
        },
        { onConflict: 'participant_id,group_name' },
      )
    if (error) throw new Error(error.message)
  }

  if (thirdBetUpdate) {
    const { error } = await admin
      .from('third_place_bets')
      .upsert(
        { participant_id: participantId, group_name: groupName, team: thirdBetUpdate.team },
        { onConflict: 'participant_id,group_name' },
      )
    if (error) throw new Error(error.message)
  }
}
