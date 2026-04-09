'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'

// ── Aposta de classificação de grupo ─────────────────────────
export async function saveGroupBet(
  groupName: string,
  firstPlace: string,
  secondPlace: string,
) {
  if (!firstPlace || !secondPlace) throw new Error('Selecione os dois times.')
  if (firstPlace === secondPlace) throw new Error('1º e 2º lugar devem ser times diferentes.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)

  const { error } = await supabase.from('group_bets').upsert(
    { participant_id: participantId, group_name: groupName, first_place: firstPlace, second_place: secondPlace },
    { onConflict: 'participant_id,group_name' },
  )
  if (error) throw new Error(error.message)

  revalidatePath('/apostas-especiais')
}

// ── Aposta de torneio ─────────────────────────────────────────
export async function saveTournamentBet(data: {
  champion: string
  runner_up: string
  semi1: string
  semi2: string
  top_scorer: string
}) {
  const { champion, runner_up, semi1, semi2, top_scorer } = data

  if (!champion || !runner_up || !semi1 || !semi2 || !top_scorer) {
    throw new Error('Preencha todos os campos.')
  }
  if (champion === runner_up) throw new Error('Campeão e vice devem ser diferentes.')
  if (new Set([champion, runner_up, semi1, semi2]).size < 4) {
    throw new Error('Os quatro semifinalistas devem ser seleções diferentes.')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)

  const { error } = await supabase.from('tournament_bets').upsert(
    { participant_id: participantId, champion, runner_up, semi1, semi2, top_scorer },
    { onConflict: 'participant_id' },
  )
  if (error) throw new Error(error.message)

  revalidatePath('/apostas-especiais')
}
