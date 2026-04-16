'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000  // 4 horas em ms

function isWithinEditWindow(matchDatetime: string): boolean {
  const now  = Date.now()
  const start = new Date(matchDatetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

async function getCallerPermissions() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('users')
    .select('is_admin, approved, paid')
    .eq('id', user.id)
    .single()

  const isAdmin       = profile?.is_admin   ?? false
  const isParticipant = (profile?.approved && profile?.paid) ?? false

  return { isAdmin, isParticipant }
}

export async function saveOfficialScore(
  matchId: string,
  scoreHome: number | null,
  scoreAway: number | null,
) {
  const { isAdmin, isParticipant } = await getCallerPermissions()
  if (!isAdmin && !isParticipant) throw new Error('Sem permissão')

  // Busca o jogo para validar janela de edição
  const supabase = await createClient()
  const { data: match } = await supabase
    .from('matches')
    .select('match_datetime')
    .eq('id', matchId)
    .single()
  if (!match) throw new Error('Jogo não encontrado')

  if (!isAdmin && !isWithinEditWindow(match.match_datetime)) {
    throw new Error('Fora da janela de edição (início do jogo + 4h)')
  }

  // Usa admin client para contornar RLS (permissão validada acima)
  const admin = await createAdminClient()
  const { error } = await admin
    .from('matches')
    .update({ score_home: scoreHome, score_away: scoreAway })
    .eq('id', matchId)

  if (error) throw new Error(error.message)
}

export async function savePenaltyWinner(
  matchId: string,
  winner: string | null,
) {
  const { isAdmin, isParticipant } = await getCallerPermissions()
  if (!isAdmin && !isParticipant) throw new Error('Sem permissão')

  const supabase = await createClient()
  const { data: match } = await supabase
    .from('matches')
    .select('match_datetime, score_home, score_away, phase')
    .eq('id', matchId)
    .single()
  if (!match) throw new Error('Jogo não encontrado')

  if (match.phase === 'group') throw new Error('Pênaltis não se aplicam à fase de grupos')

  if (!isAdmin && !isWithinEditWindow(match.match_datetime)) {
    throw new Error('Fora da janela de edição (início do jogo + 4h)')
  }

  const admin = await createAdminClient()
  const { error } = await admin
    .from('matches')
    .update({ penalty_winner: winner })
    .eq('id', matchId)

  if (error) throw new Error(error.message)
}
