export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { TabelaMBClient } from './TabelaMBClient'
import type { MatchFull, Participant, BetRaw } from './TabelaMBClient'

export const metadata = { title: 'Tabela MB' }

export default async function ClassificacaoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('classificacao', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [matchesRes, participantsRes, betsRes, rulesRes] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, city, score_home, score_away, penalty_winner, is_brazil, betting_deadline')
      .order('match_number', { ascending: true }),
    supabase.from('participants')
      .select('id, apelido')
      .order('apelido', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away, points'),
    supabase.from('scoring_rules').select('key, points'),
  ])

  const rulesMap: Record<string, number> = Object.fromEntries(
    (rulesRes.data ?? []).map((r: { key: string; points: number }) => [r.key, r.points])
  )

  return (
    <>
      <Navbar />
      <TabelaMBClient
        initialMatches={(matchesRes.data ?? []) as MatchFull[]}
        participants={(participantsRes.data ?? []) as Participant[]}
        initialBets={(betsRes.data ?? []) as BetRaw[]}
        rules={rulesMap}
        isAdmin={isAdmin}
        activeParticipantId={activeParticipantId ?? ''}
      />
    </>
  )
}
