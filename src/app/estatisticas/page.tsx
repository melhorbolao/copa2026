export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { EstatisticasTab } from '@/app/jogos/EstatisticasTab'
import { TEAM_CODES } from '@/lib/team-flags'

export const metadata = {}

export default async function EstatisticasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('estatisticas', profile?.role ?? 'user')

  const admin = createAuthAdminClient() as any

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [participantsRes, matchesRes, teamsRes, rulesRes, groupBetsRes, thirdBetsRes, tournamentBetsRes, matchBetsRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido', { ascending: true }),
    supabase.from('matches').select('id, team_home, team_away, flag_home, flag_away, phase, round, betting_deadline'),
    admin.from('teams').select('name, abbr_br, group_name'),
    supabase.from('scoring_rules').select('key, points'),
    fetchAll('group_bets', 'participant_id, group_name, first_place, second_place'),
    fetchAll('third_place_bets', 'participant_id, group_name, team'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
  ])

  const rules: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: any) => [r.key, r.points])
  )
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const allMatches = (matchesRes.data ?? []) as any[]

  // Bloqueia estatísticas enquanto o prazo de palpites estiver aberto
  const bonusDeadlineStr = allMatches.find((m: any) => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const now = new Date()
  if (!isAdmin && (!bonusDeadlineStr || new Date(bonusDeadlineStr) > now)) {
    const deadlineLabel = bonusDeadlineStr
      ? new Date(bonusDeadlineStr).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'data indefinida'
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-gray-50 pb-16 pt-16 sm:pt-6 flex items-center justify-center">
          <div className="max-w-sm mx-auto px-4 text-center">
            <p className="text-4xl mb-4">🔒</p>
            <h1 className="text-lg font-bold text-gray-800 mb-2">Estatísticas indisponíveis</h1>
            <p className="text-sm text-gray-500">
              As estatísticas ficam visíveis somente após o encerramento do prazo de palpites.
            </p>
            <p className="mt-3 text-xs text-gray-400">Prazo: {deadlineLabel}</p>
          </div>
        </div>
      </>
    )
  }

  // Apenas partidas cujo prazo de apostas já encerrou — vale para todos, incluindo admin.
  // Impede que apostas de rodadas futuras (já preenchidas) apareçam nas tabelas de placares.
  const closedMatchIds = new Set<string>(
    allMatches
      .filter((m: any) => m.betting_deadline && new Date(m.betting_deadline) <= now)
      .map((m: any) => String(m.id))
  )

  const teamFlags: Record<string, string> = {}
  for (const m of allMatches) {
    if (m.team_home && m.flag_home) teamFlags[m.team_home] = m.flag_home
    if (m.team_away && m.flag_away) teamFlags[m.team_away] = m.flag_away
  }

  const teams = ((teamsRes.data ?? []) as any[])
    .filter((t: any) => t.group_name)
    .map((t: any) => ({
      name:  t.name as string,
      abbr:  (t.abbr_br ?? t.name.slice(0, 3).toUpperCase()) as string,
      group: t.group_name as string,
      flag:  (teamFlags[t.name] ?? '') as string,
    }))

  let scorerMapping: Record<string, string> = {}
  let scorerFlagMap: Record<string, string> = {}
  try {
    const { data: mappingRows, error: mappingErr } = await admin.from('top_scorer_mapping').select('raw_name, standardized_name')
    if (mappingErr) console.error('[estatisticas] top_scorer_mapping error:', mappingErr.message)
    for (const r of (mappingRows ?? []) as any[]) {
      if (r.raw_name && r.standardized_name) {
        scorerMapping[r.raw_name.toLowerCase().trim()] = r.standardized_name
      }
    }
  } catch (e) {
    console.error('[estatisticas] top_scorer_mapping fetch failed:', e)
  }
  try {
    const { data: topScorersData } = await admin.from('top_scorers').select('player_name, team')
    for (const s of (topScorersData ?? []) as any[]) {
      const code = s.team ? TEAM_CODES[s.team] : null
      if (s.player_name && code) {
        const rawKey = s.player_name.toLowerCase().trim()
        scorerFlagMap[rawKey] = code
        // Também indexa pelo nome normalizado (ex: "Doku" → "Jérémy Doku" via scorerMapping)
        const normalized = scorerMapping[rawKey]
        if (normalized) scorerFlagMap[normalized.toLowerCase().trim()] = code
      }
    }
  } catch { /* tabela ainda não criada */ }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 pb-16 pt-16 sm:pt-6">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
          <EstatisticasTab
            participants={(participantsRes.data ?? []) as any[]}
            teams={teams}
            groupBets={groupBetsRes as any[]}
            thirdBets={thirdBetsRes as any[]}
            tournamentBets={(tournamentBetsRes.data ?? []) as any[]}
            matchBets={(matchBetsRes as any[]).filter((b: any) =>
              b.score_home !== null && b.score_away !== null &&
              closedMatchIds.has(b.match_id)
            )}
            zebraThreshold={zebraThreshold}
            scorerMapping={scorerMapping}
            scorerFlagMap={scorerFlagMap}
          />
        </div>
      </div>
    </>
  )
}
