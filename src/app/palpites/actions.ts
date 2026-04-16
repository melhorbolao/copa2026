'use server'

import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { calcGroupStandings, rankThirds } from '@/lib/bracket/engine'

async function resolveParticipant() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)
  return { supabase, participantId }
}

// ── Palpite de placar ─────────────────────────────────────────
export async function deleteBet(matchId: string) {
  let participantId: string
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    ;({ supabase, participantId } = await resolveParticipant())
  } catch (e) {
    console.error('[deleteBet] resolveParticipant falhou:', e)
    throw e
  }

  const { data: match, error: matchError } = await supabase.from('matches').select('betting_deadline').eq('id', matchId).single()
  if (matchError) console.error('[deleteBet] erro ao buscar partida:', matchError)
  if (!match) throw new Error('Partida não encontrada')
  if (new Date() > new Date(match.betting_deadline)) throw new Error('Prazo encerrado')

  const admin = createAuthAdminClient()
  const { error } = await admin.from('bets')
    .delete()
    .eq('participant_id', participantId)
    .eq('match_id', matchId)
  if (error) {
    console.error('[deleteBet] erro no delete:', error)
    throw new Error(error.message)
  }
}

export async function saveBet(matchId: string, scoreHome: number, scoreAway: number) {
  if (!Number.isInteger(scoreHome) || !Number.isInteger(scoreAway) || scoreHome < 0 || scoreAway < 0) {
    throw new Error('Placar inválido')
  }

  let participantId: string
  let supabase: Awaited<ReturnType<typeof createClient>>
  try {
    ;({ supabase, participantId } = await resolveParticipant())
  } catch (e) {
    console.error('[saveBet] resolveParticipant falhou:', e)
    throw e
  }

  const { data: match, error: matchError } = await supabase.from('matches').select('betting_deadline').eq('id', matchId).single()
  if (matchError) console.error('[saveBet] erro ao buscar partida:', matchError)
  if (!match) throw new Error('Partida não encontrada')
  if (new Date() > new Date(match.betting_deadline)) throw new Error('Prazo encerrado')

  // Usa admin client para contornar possíveis restrições de RLS na tabela bets
  const admin = createAuthAdminClient()
  const { error } = await admin.from('bets').upsert(
    { participant_id: participantId, match_id: matchId, score_home: scoreHome, score_away: scoreAway },
    { onConflict: 'participant_id,match_id' },
  )
  if (error) {
    console.error('[saveBet] erro no upsert:', error)
    throw new Error(error.message)
  }
}

// ── Classificação de grupo ────────────────────────────────────
export async function deleteGroupBet(
  groupName: string,
  field: 'first' | 'second',
  otherValue: string,
): Promise<{ error?: string }> {
  try {
    const { participantId } = await resolveParticipant()
    const admin = createAuthAdminClient()

    if (!otherValue) {
      // Outro campo também vazio — apaga a linha inteira
      const { error } = await admin
        .from('group_bets')
        .delete()
        .eq('participant_id', participantId)
        .eq('group_name', groupName)
      if (error) return { error: error.message }
    } else {
      // Mantém o outro campo, limpa apenas o removido
      const updateData = field === 'first'
        ? { first_place: '', second_place: otherValue }
        : { first_place: otherValue, second_place: '' }
      const { error } = await admin
        .from('group_bets')
        .update(updateData)
        .eq('participant_id', participantId)
        .eq('group_name', groupName)
      if (error) return { error: error.message }
    }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function saveGroupBet(groupName: string, firstPlace: string, secondPlace: string) {
  if (!firstPlace || !secondPlace) throw new Error('Selecione os dois times.')
  if (firstPlace === secondPlace) throw new Error('1º e 2º devem ser times diferentes.')

  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { error } = await admin.from('group_bets').upsert(
    { participant_id: participantId, group_name: groupName, first_place: firstPlace, second_place: secondPlace },
    { onConflict: 'participant_id,group_name' },
  )
  if (error) {
    console.error('[saveGroupBet] erro no upsert:', error)
    throw new Error(error.message)
  }
}

// ── Terceiros classificados ───────────────────────────────────
export async function saveThirdPlaceBets(
  bets: { group_name: string; team: string }[]
) {
  if (bets.length !== 8)
    throw new Error('Selecione exatamente 8 grupos.')
  if (new Set(bets.map(b => b.group_name)).size !== 8)
    throw new Error('Os grupos devem ser diferentes.')
  if (bets.some(b => !b.team))
    throw new Error('Selecione o time para cada grupo escolhido.')

  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { data: deadline } = await supabase
    .from('matches')
    .select('betting_deadline')
    .eq('phase', 'group')
    .eq('round', 1)
    .order('betting_deadline', { ascending: true })
    .limit(1)
    .single()
  if (deadline && new Date() > new Date(deadline.betting_deadline))
    throw new Error('Prazo encerrado.')

  await admin.from('third_place_bets').delete().eq('participant_id', participantId)
  const { error } = await admin.from('third_place_bets').insert(
    bets.map(b => ({ participant_id: participantId, group_name: b.group_name, team: b.team }))
  )
  if (error) throw new Error(error.message)
}

// ── Terceiro classificado individual (autosave) ───────────────
export async function saveThirdPlaceBet(groupName: string, team: string) {
  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  const { error } = await admin.from('third_place_bets').upsert(
    { participant_id: participantId, group_name: groupName, team },
    { onConflict: 'participant_id,group_name' }
  )
  if (error) throw new Error(error.message)
}

export async function deleteThirdPlaceBet(groupName: string) {
  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { error } = await admin.from('third_place_bets')
    .delete().eq('participant_id', participantId).eq('group_name', groupName)
  if (error) throw new Error(error.message)
}

// ── Auto-preenchimento de classificados ──────────────────────
export async function autoFillGroupBets() {
  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away')
    .eq('phase', 'group')

  const matchIds = (matchRows ?? []).map(m => m.id)

  const { data: betRows } = await supabase
    .from('bets')
    .select('match_id, score_home, score_away')
    .eq('participant_id', participantId)
    .in('match_id', matchIds)

  const betMap = new Map((betRows ?? []).map(b => [b.match_id, b as { match_id: string; score_home: number; score_away: number }]))

  const standings = calcGroupStandings(matchRows ?? [], betMap)
  const thirds = rankThirds(standings)

  for (const s of standings) {
    if (s.teams.length < 2) continue
    const { error } = await admin.from('group_bets').upsert(
      { participant_id: participantId, group_name: s.group, first_place: s.teams[0].team, second_place: s.teams[1].team },
      { onConflict: 'participant_id,group_name' },
    )
    if (error) throw new Error(error.message)
  }

  const advancingThirds = thirds.filter(t => t.advances)
  await admin.from('third_place_bets').delete().eq('participant_id', participantId)
  if (advancingThirds.length > 0) {
    const { error } = await admin.from('third_place_bets').insert(
      advancingThirds.map(t => ({ participant_id: participantId, group_name: t.group, team: t.team })),
    )
    if (error) throw new Error(error.message)
  }
}

// ── Preencher G4 a partir do chaveamento ─────────────────────
export async function fillG4FromBracket(data: {
  champion: string
  runner_up: string
  semi1: string
  semi2: string
}) {
  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  const { champion, runner_up, semi1, semi2 } = data
  if (!champion || !runner_up || !semi1 || !semi2) throw new Error('Chaveamento incompleto.')

  const { data: existing } = await supabase
    .from('tournament_bets').select('top_scorer').eq('participant_id', participantId).maybeSingle()

  const { error } = await admin.from('tournament_bets').upsert(
    { participant_id: participantId, champion, runner_up, semi1, semi2, top_scorer: existing?.top_scorer ?? '' },
    { onConflict: 'participant_id' },
  )
  if (error) throw new Error(error.message)
}

// ── Aposta de torneio ─────────────────────────────────────────
export async function saveTournamentBet(data: {
  champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string
}): Promise<{ error?: string }> {
  try {
    const { champion, runner_up, semi1, semi2, top_scorer } = data

    const filled = [champion, runner_up, semi1, semi2].filter(Boolean)
    if (new Set(filled).size < filled.length)
      return { error: 'Os semifinalistas devem ser diferentes.' }

    const { participantId } = await resolveParticipant()
    const admin = createAuthAdminClient()

    // Se G4 incompleto, apenas atualiza top_scorer na linha existente
    // (evita violar constraint champion <> runner_up com strings vazias)
    if (!champion || !runner_up) {
      const { error } = await admin
        .from('tournament_bets')
        .update({ top_scorer })
        .eq('participant_id', participantId)
      if (error) return { error: error.message }
      return {}
    }

    const { error } = await admin.from('tournament_bets').upsert(
      { participant_id: participantId, champion, runner_up, semi1, semi2, top_scorer },
      { onConflict: 'participant_id' },
    )
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro ao salvar.' }
  }
}
