'use server'

import { revalidateTag } from 'next/cache'
import { createClient, createAdminClient, createAuthAdminClient } from '@/lib/supabase/server'
import { recalculateAfterMatchScore, recalculateTournamentBets, recalculateThirdBets } from '@/lib/scoring/recalculate'

export async function saveOfficialTopScorer(name: string): Promise<{ error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Não autenticado' }
    const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Sem permissão' }
    const admin = await createAdminClient()
    const { error } = await admin
      .from('tournament_settings')
      .upsert({ key: 'official_top_scorer', value: name.trim() }, { onConflict: 'key' })
    if (error) return { error: error.message }
    recalculateTournamentBets().catch(e => console.error('[scoring/top-scorer]', e))
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000  // 4 horas em ms

function isWithinEditWindow(matchDatetime: string): boolean {
  const now  = Date.now()
  const start = new Date(matchDatetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

async function getCallerPermissions() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const admin = createAuthAdminClient()
  const [{ data: profile }, { data: link }] = await Promise.all([
    admin.from('users').select('is_admin').eq('id', user.id).single(),
    admin.from('user_participants').select('participant_id').eq('user_id', user.id).limit(1).maybeSingle(),
  ])

  const isAdmin       = profile?.is_admin ?? false
  const isParticipant = !!link

  return { isAdmin, isParticipant }
}

export async function saveOfficialScore(
  matchId: string,
  scoreHome: number | null,
  scoreAway: number | null,
): Promise<{ error?: string }> {
  try {
    const perms = await getCallerPermissions()
    if (!perms) return { error: 'Não autenticado' }
    const { isAdmin, isParticipant } = perms
    if (!isAdmin && !isParticipant) return { error: 'Sem permissão' }

    const supabase = await createClient()
    const { data: match } = await supabase
      .from('matches')
      .select('match_datetime')
      .eq('id', matchId)
      .single()
    if (!match) return { error: 'Jogo não encontrado' }

    if (!isAdmin && !isWithinEditWindow(match.match_datetime)) {
      return { error: 'Fora da janela de edição (início do jogo + 4h)' }
    }

    const admin = createAuthAdminClient()
    const { error } = await admin
      .from('matches')
      .update({ score_home: scoreHome, score_away: scoreAway })
      .eq('id', matchId)

    if (error) return { error: error.message }
    revalidateTag('matches')
    recalculateAfterMatchScore(matchId).catch(e => console.error('[scoring/match]', e))
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function savePenaltyWinner(
  matchId: string,
  winner: string | null,
): Promise<{ error?: string }> {
  try {
    const perms = await getCallerPermissions()
    if (!perms) return { error: 'Não autenticado' }
    const { isAdmin, isParticipant } = perms
    if (!isAdmin && !isParticipant) return { error: 'Sem permissão' }

    const supabase = await createClient()
    const { data: match } = await supabase
      .from('matches')
      .select('match_datetime, phase')
      .eq('id', matchId)
      .single()
    if (!match) return { error: 'Jogo não encontrado' }

    if (match.phase === 'group') return { error: 'Pênaltis não se aplicam à fase de grupos' }

    if (!isAdmin && !isWithinEditWindow(match.match_datetime)) {
      return { error: 'Fora da janela de edição (início do jogo + 4h)' }
    }

    const admin = createAuthAdminClient()
    const { error } = await admin
      .from('matches')
      .update({ penalty_winner: winner })
      .eq('id', matchId)

    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}

export async function toggleThirdPlaceScoring(
  groupName: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Não autenticado' }
    const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return { error: 'Sem permissão' }

    const admin = createAuthAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('third_place_scoring').upsert(
      { group_name: groupName, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'group_name' },
    )
    if (error) return { error: error.message }

    recalculateThirdBets().catch(e => console.error('[scoring/thirds]', e))
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
