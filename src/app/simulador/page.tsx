export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { SimuladorClient } from './SimuladorClient'

export const metadata = {}

export default async function SimuladorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('simulador', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  const admin = createAuthAdminClient() as any
  const now = new Date().toISOString()

  const [participantsRes, matchesRes, betsRes, rulesRes, scoresRes, teamAbbrRes, simRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, score_home, score_away, penalty_winner, is_brazil, match_datetime, betting_deadline, city')
      .order('match_datetime', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('teams').select('name, abbr_br'),
    (supabase as any).from('user_simulations')
      .select('match_id, score_home, score_away')
      .eq('user_id', user.id),
  ])

  const rules: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: any) => [r.key, r.points])
  )
  const teamAbbrs: Record<string, string> = Object.fromEntries(
    (teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? ''])
  )
  const storedTotals: Record<string, number> = Object.fromEntries(
    (scoresRes.data ?? []).map((s: any) => [s.participant_id, s.pts_total ?? 0])
  )

  const allMatches = (matchesRes.data ?? []) as any[]
  const visibleMatches = isAdmin
    ? allMatches
    : allMatches.filter((m: any) => m.betting_deadline && m.betting_deadline <= now)

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 pb-16 pt-16 sm:pt-6">
        <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4">
          <SimuladorClient
            userId={user.id}
            isAdmin={isAdmin}
            activeParticipantId={activeParticipantId ?? null}
            participants={(participantsRes.data ?? []) as any[]}
            visibleMatches={visibleMatches}
            allBets={(betsRes.data ?? []) as any[]}
            rules={rules}
            teamAbbrs={teamAbbrs}
            storedTotals={storedTotals}
            existingSimulations={(simRes.data ?? []) as any[]}
          />
        </div>
      </div>
    </>
  )
}
