'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { calcGroupStandings, rankThirds } from '@/lib/bracket/engine'

// ── Palpite de placar ─────────────────────────────────────────
export async function saveBet(matchId: string, scoreHome: number, scoreAway: number) {
  if (!Number.isInteger(scoreHome) || !Number.isInteger(scoreAway) || scoreHome < 0 || scoreAway < 0) {
    throw new Error('Placar inválido')
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: match } = await supabase.from('matches').select('betting_deadline').eq('id', matchId).single()
  if (!match) throw new Error('Partida não encontrada')
  if (new Date() > new Date(match.betting_deadline)) throw new Error('Prazo encerrado')

  const { error } = await supabase.from('bets').upsert(
    { user_id: user.id, match_id: matchId, score_home: scoreHome, score_away: scoreAway },
    { onConflict: 'user_id,match_id' },
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

// ── Classificação de grupo ────────────────────────────────────
export async function saveGroupBet(groupName: string, firstPlace: string, secondPlace: string) {
  if (!firstPlace || !secondPlace) throw new Error('Selecione os dois times.')
  if (firstPlace === secondPlace) throw new Error('1º e 2º devem ser times diferentes.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { error } = await supabase.from('group_bets').upsert(
    { user_id: user.id, group_name: groupName, first_place: firstPlace, second_place: secondPlace },
    { onConflict: 'user_id,group_name' },
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

// ── Terceiros classificados ───────────────────────────────────
export async function saveThirdPlaceBets(
  bets: { group_name: string; team: string }[]
) {
  // Validações
  if (bets.length !== 8)
    throw new Error('Selecione exatamente 8 grupos.')
  if (new Set(bets.map(b => b.group_name)).size !== 8)
    throw new Error('Os grupos devem ser diferentes.')
  if (bets.some(b => !b.team))
    throw new Error('Selecione o time para cada grupo escolhido.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  // Verifica prazo (usa o mesmo prazo da Rodada 1)
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

  // Substitui todos os palpites de terceiro do usuário de uma vez
  await supabase.from('third_place_bets').delete().eq('user_id', user.id)
  const { error } = await supabase.from('third_place_bets').insert(
    bets.map(b => ({ user_id: user.id, group_name: b.group_name, team: b.team }))
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

// ── Terceiro classificado individual (autosave) ───────────────
export async function saveThirdPlaceBet(groupName: string, team: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  const { error } = await supabase.from('third_place_bets').upsert(
    { user_id: user.id, group_name: groupName, team },
    { onConflict: 'user_id,group_name' }
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

export async function deleteThirdPlaceBet(groupName: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { error } = await supabase.from('third_place_bets')
    .delete().eq('user_id', user.id).eq('group_name', groupName)
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

// ── Auto-preenchimento de classificados ──────────────────────
export async function autoFillGroupBets() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  // Verifica prazo (usa o mesmo prazo da Rodada 1)
  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  // Busca partidas de grupo
  const { data: matchRows } = await supabase
    .from('matches')
    .select('id, group_name, phase, team_home, team_away, flag_home, flag_away')
    .eq('phase', 'group')

  const matchIds = (matchRows ?? []).map(m => m.id)

  // Busca palpites do usuário
  const { data: betRows } = await supabase
    .from('bets')
    .select('match_id, score_home, score_away')
    .eq('user_id', user.id)
    .in('match_id', matchIds)

  const betMap = new Map((betRows ?? []).map(b => [b.match_id, b as { match_id: string; score_home: number; score_away: number }]))

  // Calcula classificações
  const standings = calcGroupStandings(matchRows ?? [], betMap)
  const thirds = rankThirds(standings)

  // Upsert group_bets para os 12 grupos
  for (const s of standings) {
    if (s.teams.length < 2) continue
    const { error } = await supabase.from('group_bets').upsert(
      { user_id: user.id, group_name: s.group, first_place: s.teams[0].team, second_place: s.teams[1].team },
      { onConflict: 'user_id,group_name' },
    )
    if (error) throw new Error(error.message)
  }

  // Substitui third_place_bets pelos 8 melhores terceiros
  const advancingThirds = thirds.filter(t => t.advances)
  await supabase.from('third_place_bets').delete().eq('user_id', user.id)
  if (advancingThirds.length > 0) {
    const { error } = await supabase.from('third_place_bets').insert(
      advancingThirds.map(t => ({ user_id: user.id, group_name: t.group, team: t.team })),
    )
    if (error) throw new Error(error.message)
  }

  revalidatePath('/palpites')
}

// ── Preencher G4 a partir do chaveamento ─────────────────────
export async function fillG4FromBracket(data: {
  champion: string
  runner_up: string
  semi1: string
  semi2: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  // Verifica prazo (mesmo da Rodada 1)
  const { data: dl } = await supabase
    .from('matches').select('betting_deadline')
    .eq('phase', 'group').eq('round', 1)
    .order('betting_deadline', { ascending: true }).limit(1).single()
  if (dl && new Date() > new Date(dl.betting_deadline))
    throw new Error('Prazo encerrado.')

  const { champion, runner_up, semi1, semi2 } = data
  if (!champion || !runner_up || !semi1 || !semi2) throw new Error('Chaveamento incompleto.')

  const { data: existing } = await supabase
    .from('tournament_bets').select('top_scorer').eq('user_id', user.id).maybeSingle()

  const { error } = await supabase.from('tournament_bets').upsert(
    { user_id: user.id, champion, runner_up, semi1, semi2, top_scorer: existing?.top_scorer ?? '' },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}

// ── Aposta de torneio ─────────────────────────────────────────
export async function saveTournamentBet(data: {
  champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string
}) {
  const { champion, runner_up, semi1, semi2, top_scorer } = data

  // Valida unicidade apenas entre os selecionados
  const filled = [champion, runner_up, semi1, semi2].filter(Boolean)
  if (new Set(filled).size < filled.length)
    throw new Error('Os semifinalistas devem ser diferentes.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { error } = await supabase.from('tournament_bets').upsert(
    { user_id: user.id, champion, runner_up, semi1, semi2, top_scorer },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(error.message)
  revalidatePath('/palpites')
}
