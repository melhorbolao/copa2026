'use server'

import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { calcGroupStandings, rankThirds } from '@/lib/bracket/engine'
import { assertCanFillForMatch } from '@/lib/phase-availability'

async function resolveParticipant() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const participantId = await getActiveParticipantId(supabase, user.id)
  return { supabase, participantId }
}

/**
 * Erros do PostgREST quando a função RPC não existe ainda. Permite que
 * o action faça fallback para o caminho antigo (2 roundtrips) até a
 * migration `add_save_bet_rpcs.sql` rodar em produção.
 */
function isMissingRpc(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === 'PGRST202' || /could not find the function/i.test(err.message ?? '')
}

// ── Helper: valida disponibilidade da etapa do match para o participante ──
async function assertStageOpen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  matchId: string,
  participantId: string,
): Promise<void> {
  const { data: m } = await supabase.from('matches').select('phase, round').eq('id', matchId).maybeSingle()
  if (!m) throw new Error('Partida não encontrada')
  await assertCanFillForMatch(m.phase, m.round ?? null, participantId)
}

// ── Palpite de placar ─────────────────────────────────────────
export async function deleteBet(matchId: string) {
  const { supabase, participantId } = await resolveParticipant()
  await assertStageOpen(supabase, matchId, participantId)

  // Caminho rápido: 1 roundtrip via RPC (deadline-check + delete)
  const rpc = await supabase.rpc('delete_bet', { p_participant_id: participantId, p_match_id: matchId })
  if (rpc.error && !isMissingRpc(rpc.error)) {
    throw new Error(rpc.error.message)
  }
  if (!rpc.error) return

  // Fallback (migration ainda não rodou)
  const { data: match } = await supabase.from('matches').select('betting_deadline').eq('id', matchId).single()
  if (!match) throw new Error('Partida não encontrada')
  if (new Date() > new Date(match.betting_deadline)) throw new Error('Prazo encerrado')
  const admin = createAuthAdminClient()
  const { error } = await admin.from('bets').delete().eq('participant_id', participantId).eq('match_id', matchId)
  if (error) throw new Error(error.message)
}

export async function saveBet(matchId: string, scoreHome: number, scoreAway: number) {
  if (!Number.isInteger(scoreHome) || !Number.isInteger(scoreAway) || scoreHome < 0 || scoreAway < 0) {
    throw new Error('Placar inválido')
  }
  const { supabase, participantId } = await resolveParticipant()
  await assertStageOpen(supabase, matchId, participantId)

  // Caminho rápido: 1 roundtrip via RPC
  const rpc = await supabase.rpc('save_bet', {
    p_participant_id: participantId, p_match_id: matchId,
    p_score_home: scoreHome, p_score_away: scoreAway,
  })
  if (rpc.error && !isMissingRpc(rpc.error)) {
    throw new Error(rpc.error.message)
  }
  if (!rpc.error) return

  // Fallback (migration ainda não rodou)
  const { data: match } = await supabase.from('matches').select('betting_deadline').eq('id', matchId).single()
  if (!match) throw new Error('Partida não encontrada')
  if (new Date() > new Date(match.betting_deadline)) throw new Error('Prazo encerrado')
  const admin = createAuthAdminClient()
  const { error } = await admin.from('bets').upsert(
    { participant_id: participantId, match_id: matchId, score_home: scoreHome, score_away: scoreAway },
    { onConflict: 'participant_id,match_id' },
  )
  if (error) throw new Error(error.message)
}

// ── Batch save de palpites de placar ──────────────────────────
export interface BatchBetItem {
  matchId:    string
  scoreHome?: number
  scoreAway?: number
  delete?:    boolean
}

export async function saveBetsBatch(
  items: BatchBetItem[],
): Promise<{ saved: number; deleted: number; skippedExpired: number }> {
  if (items.length === 0) return { saved: 0, deleted: 0, skippedExpired: 0 }
  const { supabase, participantId } = await resolveParticipant()

  // Valida etapas dos matches do batch (1 query agregada)
  const matchIds = items.map(it => it.matchId)
  const { data: phaseRows } = await supabase
    .from('matches').select('id, phase, round').in('id', matchIds)
  const stagesToCheck = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (phaseRows ?? []) as any[]) {
    stagesToCheck.add(`${r.phase}|${r.round ?? ''}`)
  }
  for (const sig of stagesToCheck) {
    const [phase, round] = sig.split('|')
    await assertCanFillForMatch(phase, round ? parseInt(round, 10) : null, participantId)
  }

  const payload = items.map(it => it.delete
    ? { match_id: it.matchId, delete: true }
    : { match_id: it.matchId, score_home: it.scoreHome, score_away: it.scoreAway },
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = await supabase.rpc('save_bets_batch', { p_participant_id: participantId, p_bets: payload as any })
  if (rpc.error) {
    if (isMissingRpc(rpc.error)) {
      // Fallback: dispara saves individuais (caminho lento até a migration rodar)
      let saved = 0, deleted = 0
      for (const it of items) {
        try {
          if (it.delete) { await deleteBet(it.matchId); deleted++ }
          else if (it.scoreHome != null && it.scoreAway != null) {
            await saveBet(it.matchId, it.scoreHome, it.scoreAway); saved++
          }
        } catch (e) {
          console.error('[saveBetsBatch fallback]', it.matchId, e)
        }
      }
      return { saved, deleted, skippedExpired: 0 }
    }
    throw new Error(rpc.error.message)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = rpc.data as any
  return { saved: data?.saved ?? 0, deleted: data?.deleted ?? 0, skippedExpired: data?.skipped_expired ?? 0 }
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

  // Caminho rápido: 1 roundtrip via RPC
  const rpc = await supabase.rpc('save_group_bet', {
    p_participant_id: participantId, p_group_name: groupName,
    p_first_place: firstPlace, p_second_place: secondPlace,
  })
  if (rpc.error && !isMissingRpc(rpc.error)) {
    throw new Error(rpc.error.message)
  }
  if (!rpc.error) return

  // Fallback (migration ainda não rodou)
  const admin = createAuthAdminClient()
  const { error } = await admin.from('group_bets').upsert(
    { participant_id: participantId, group_name: groupName, first_place: firstPlace, second_place: secondPlace },
    { onConflict: 'participant_id,group_name' },
  )
  if (error) throw new Error(error.message)
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

  // Caminho rápido: 1 roundtrip via RPC
  const rpc = await supabase.rpc('save_third_place_bet', {
    p_participant_id: participantId, p_group_name: groupName, p_team: team,
  })
  if (rpc.error && !isMissingRpc(rpc.error)) {
    throw new Error(rpc.error.message)
  }
  if (!rpc.error) return

  // Fallback (migration ainda não rodou)
  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')
  const admin = createAuthAdminClient()
  const { error } = await admin.from('third_place_bets').upsert(
    { participant_id: participantId, group_name: groupName, team },
    { onConflict: 'participant_id,group_name' }
  )
  if (error) throw new Error(error.message)
}

export async function deleteThirdPlaceBet(groupName: string) {
  const { supabase, participantId } = await resolveParticipant()

  // Caminho rápido: 1 roundtrip via RPC
  const rpc = await supabase.rpc('delete_third_place_bet', {
    p_participant_id: participantId, p_group_name: groupName,
  })
  if (rpc.error && !isMissingRpc(rpc.error)) {
    throw new Error(rpc.error.message)
  }
  if (!rpc.error) return

  // Fallback
  const admin = createAuthAdminClient()
  const { error } = await admin.from('third_place_bets')
    .delete().eq('participant_id', participantId).eq('group_name', groupName)
  if (error) throw new Error(error.message)
}

// ── Auto-preenchimento de classificados ──────────────────────
export async function autoFillGroupBets(): Promise<{ thirdsCount: number; tiedGroups: string[] }> {
  const { supabase, participantId } = await resolveParticipant()
  const admin = createAuthAdminClient()

  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  // Usa admin para garantir acesso sem restrições de RLS
  const { data: matchRows, error: matchErr } = await admin
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away')
    .eq('phase', 'group')
  if (matchErr) throw new Error(`Erro ao carregar partidas: ${matchErr.message}`)
  if (!matchRows || matchRows.length === 0) throw new Error('Nenhuma partida de grupo encontrada.')

  const matchIds = matchRows.map(m => m.id)

  const { data: betRows, error: betErr } = await admin
    .from('bets')
    .select('match_id, score_home, score_away')
    .eq('participant_id', participantId)
    .in('match_id', matchIds)
  if (betErr) throw new Error(`Erro ao carregar palpites: ${betErr.message}`)

  const betMap = new Map(
    (betRows ?? []).map(b => [b.match_id, { match_id: b.match_id, score_home: b.score_home ?? 0, score_away: b.score_away ?? 0 }])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const standings = calcGroupStandings(matchRows as any, betMap)
  const thirds = rankThirds(standings)

  // Grupos com empate na 3ª posição (time escolhido é arbitrário)
  const tiedGroups: string[] = standings
    .filter(s => s.tiedTeams.length > 0 && s.teams[2] && s.tiedTeams.includes(s.teams[2].team))
    .map(s => s.group)

  for (const s of standings) {
    if (s.teams.length < 2) continue
    const { error } = await admin.from('group_bets').upsert(
      { participant_id: participantId, group_name: s.group, first_place: s.teams[0].team, second_place: s.teams[1].team },
      { onConflict: 'participant_id,group_name' },
    )
    if (error) throw new Error(`Erro ao salvar 1º/2º do grupo ${s.group}: ${error.message}`)
  }

  const advancingThirds = thirds.filter(t => t.advances)

  const { error: deleteError } = await admin
    .from('third_place_bets')
    .delete()
    .eq('participant_id', participantId)
  if (deleteError) throw new Error(`Erro ao limpar terceiros: ${deleteError.message}`)

  if (advancingThirds.length === 0) {
    throw new Error(
      `Nenhum terceiro classificado calculado (grupos=${standings.length}, terceiros=${thirds.length}). ` +
      `Verifique se todos os palpites da fase de grupos estão preenchidos.`
    )
  }

  const { error: insertError } = await admin
    .from('third_place_bets')
    .insert(advancingThirds.map(t => ({ participant_id: participantId, group_name: t.group, team: t.team })))
  if (insertError) throw new Error(`Erro ao inserir terceiros: ${insertError.message}`)

  return { thirdsCount: advancingThirds.length, tiedGroups }
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
