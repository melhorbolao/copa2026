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

// Detecta no servidor se o jogo envolve o Brasil.
// Caso simples: banco já tem is_brazil=true ou team_home/away é 'Brasil'.
// Caso mata-mata com 'TBD': computa posição do Brasil no grupo, mapeia para
// o slot do R32 e verifica se o matchId é o jogo correspondente.
async function detectIsBrazilForMatch(
  matchId: string,
  match: { team_home: string; team_away: string; is_brazil: boolean },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
): Promise<boolean> {
  if (match.is_brazil) return true
  if (match.team_home === 'Brasil' || match.team_away === 'Brasil') return true

  // Busca todos os jogos do grupo que contém Brasil
  const { data: brazilMatches } = await admin
    .from('matches')
    .select('group_name, team_home, team_away, score_home, score_away')
    .eq('phase', 'group')
    .eq('is_brazil', true)

  if (!brazilMatches?.length) return false

  const brazilGroup: string = brazilMatches[0].group_name
  if (!brazilGroup) return false

  // Busca TODOS os times do mesmo grupo (não só is_brazil=true)
  const { data: fullGroup } = await admin
    .from('matches')
    .select('team_home, team_away, score_home, score_away')
    .eq('phase', 'group')
    .eq('group_name', brazilGroup)

  if (!fullGroup?.length) return false
  if (fullGroup.some((m: { score_home: unknown }) => m.score_home === null)) return false

  // Calcula classificação do grupo
  const pts: Record<string, number> = {}
  const gd:  Record<string, number> = {}
  const gf:  Record<string, number> = {}
  for (const m of fullGroup) {
    const [sh, sa] = [m.score_home as number, m.score_away as number]
    for (const [team, scored, conceded] of [
      [m.team_home, sh, sa], [m.team_away, sa, sh],
    ] as [string, number, number][]) {
      pts[team] = (pts[team] ?? 0) + (scored > conceded ? 3 : scored === conceded ? 1 : 0)
      gd[team]  = (gd[team] ?? 0) + (scored - conceded)
      gf[team]  = (gf[team] ?? 0) + scored
    }
  }
  const sorted = Object.keys(pts).sort(
    (a, b) => (pts[b] - pts[a]) || (gd[b] - gd[a]) || (gf[b] - gf[a])
  )
  const brazilPos = sorted.indexOf('Brasil')  // 0=1º, 1=2º, 2=3º
  if (brazilPos < 0) return false

  // Mapeia posição → slots no R32_MATCHES
  const g = brazilGroup
  const { R32_MATCHES } = await import('@/lib/bracket/engine')
  const brazilMatchNums = R32_MATCHES
    .filter(m => {
      if (brazilPos === 0) return m.slotA === `1${g}` || m.slotB === `1${g}`
      if (brazilPos === 1) return m.slotA === `2${g}` || m.slotB === `2${g}`
      // 3º lugar: procura slot '3rd:' que inclua o grupo
      return (m.slotA.startsWith('3rd:') && m.slotA.includes(g)) ||
             (m.slotB.startsWith('3rd:') && m.slotB.includes(g))
    })
    .map(m => parseInt(m.matchNum.slice(1), 10))

  if (!brazilMatchNums.length) return false

  const { data: candidates } = await admin
    .from('matches')
    .select('id')
    .in('match_number', brazilMatchNums)

  return (candidates ?? []).some((m: { id: string }) => m.id === matchId)
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

    const admin = createAuthAdminClient()

    // Busca match_datetime, team_home, team_away e is_brazil em uma única query.
    // is_brazil derivado dos nomes é mais confiável do que o valor do DB (pode estar desatualizado
    // para jogos de mata-mata onde o time ainda aparece como 'TBD').
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: match } = await (admin as any)
      .from('matches')
      .select('match_datetime, team_home, team_away, is_brazil')
      .eq('id', matchId)
      .single()
    if (!match) return { error: 'Jogo não encontrado' }

    if (!isAdmin && !isWithinEditWindow(match.match_datetime)) {
      return { error: 'Fora da janela de edição (início do jogo + 4h)' }
    }

    // Detecta Brasil no servidor: usa o valor atual do banco OU consulta
    // a tabela de grupos para saber se este slot pertence ao Brasil.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serverIsBrazil = await detectIsBrazilForMatch(matchId, match as any, admin as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('matches')
      .update({
        score_home: scoreHome,
        score_away: scoreAway,
        ...(serverIsBrazil ? { is_brazil: true } : {}),
      })
      .eq('id', matchId)

    if (error) return { error: error.message }
    revalidateTag('matches')

    try {
      await recalculateAfterMatchScore(matchId, serverIsBrazil || undefined)
    } catch (e) {
      console.error('[scoring/match]', e)
    }

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

    await recalculateThirdBets()
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
