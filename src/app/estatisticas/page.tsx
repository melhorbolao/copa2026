export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { EstatisticasTab } from '@/app/jogos/EstatisticasTab'

export const metadata = {}

export default async function EstatisticasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('estatisticas', isAdmin)

  const admin = createAuthAdminClient() as any

  const [participantsRes, matchesRes, teamsRes, rulesRes, groupBetsRes, thirdBetsRes, tournamentBetsRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido', { ascending: true }),
    supabase.from('matches').select('team_home, team_away, flag_home, flag_away, phase, round, betting_deadline'),
    admin.from('teams').select('name, abbr_br, group_name'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('group_bets').select('participant_id, group_name, first_place, second_place'),
    admin.from('third_place_bets').select('participant_id, group_name, team'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
  ])

  const rules: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: any) => [r.key, r.points])
  )
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const allMatches = (matchesRes.data ?? []) as any[]

  // Bloqueia estatísticas enquanto o prazo de palpites estiver aberto
  const bonusDeadlineStr = allMatches.find((m: any) => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const now = new Date()
  if (!bonusDeadlineStr || new Date(bonusDeadlineStr) > now) {
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
  try {
    const { data: mappingRows, error: mappingErr } = await admin.from('top_scorer_mapping').select('raw_name, standardized_name')
    if (mappingErr) console.error('[estatisticas] top_scorer_mapping error:', mappingErr.message)
    for (const r of (mappingRows ?? []) as any[]) {
      if (r.raw_name && r.standardized_name) {
        scorerMapping[r.raw_name]        = r.standardized_name
        scorerMapping[r.raw_name.trim()] = r.standardized_name
      }
    }
  } catch (e) {
    console.error('[estatisticas] top_scorer_mapping fetch failed:', e)
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 pb-16 pt-16 sm:pt-6">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
          <EstatisticasTab
            participants={(participantsRes.data ?? []) as any[]}
            teams={teams}
            groupBets={(groupBetsRes.data ?? []) as any[]}
            thirdBets={(thirdBetsRes.data ?? []) as any[]}
            tournamentBets={(tournamentBetsRes.data ?? []) as any[]}
            zebraThreshold={zebraThreshold}
            scorerMapping={scorerMapping}
          />
        </div>
      </div>
    </>
  )
}
