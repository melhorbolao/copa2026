export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { JogosDashboard } from './JogosDashboard'
import { getVisibilitySettings, filterBetsByDeadline } from '@/lib/production-mode'

export const metadata = {}

export default async function JogosPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin, name').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false

  await requirePageAccess('jogos', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { m: initialMatchId } = await searchParams
  const visibilitySettings = await getVisibilitySettings()
  const isTestModeAdmin = isAdmin && !visibilitySettings.productionMode

  const [
    matchesRes, participantsRes, betsRes, rulesRes, scoresRes, teamAbbrRes,
    attendanceRes, photosRes, userParticipantsRes,
  ] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, match_datetime, city, betting_deadline, score_home, score_away, penalty_winner, is_brazil')
      .order('match_datetime', { ascending: true }),
    supabase.from('participants').select('id, apelido').order('apelido', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away, points'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('teams').select('name, abbr_br'),
    admin.from('stadium_attendance').select('id, match_id, user_id, participant_ids'),
    admin.from('stadium_photos').select('id, match_id, user_id, storage_path, participant_ids, caption, created_at').order('created_at', { ascending: false }),
    supabase.from('user_participants').select('user_id, participant_id'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamAbbrs: Record<string, string> = Object.fromEntries((teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? '']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storedTotals: Record<string, number> = Object.fromEntries((scoresRes.data ?? []).map((s: any) => [s.participant_id, s.pts_total ?? 0]))

  // Filtrar palpites: só expõe ao cliente após o prazo da partida (ou próprios do usuário ativo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches = (matchesRes.data ?? []) as any[]
  const deadlineByMatch: Record<string, string> = Object.fromEntries(
    allMatches.map((m: any) => [m.id, m.betting_deadline])
  )
  const safeBets = filterBetsByDeadline(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (betsRes.data ?? []) as any[],
    deadlineByMatch,
    new Date(),
    isTestModeAdmin,
    activeParticipantId,
  )

  // Map user_id → participant_ids for the attendance feature
  const userToParticipants: Record<string, string[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (userParticipantsRes.data ?? []) as any[]) {
    if (!userToParticipants[row.user_id]) userToParticipants[row.user_id] = []
    userToParticipants[row.user_id].push(row.participant_id)
  }

  // Photos are passed as storage_path only; signed URLs are generated client-side to avoid SSR failures
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photos = (photosRes.data ?? []).map((p: any) => ({ ...p, url: null }))

  return (
    <>
      <Navbar />
      <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
        <JogosDashboard
          initialMatchId={initialMatchId ?? null}
          matches={(matchesRes.data ?? []) as any[]}
          participants={(participantsRes.data ?? []) as any[]}
          bets={safeBets}
          rules={rules}
          teamAbbrs={teamAbbrs}
          storedTotals={storedTotals}
          isAdmin={isAdmin}
          userId={user.id}
          userName={profile?.name ?? ''}
          activeParticipantId={activeParticipantId ?? null}
          userToParticipants={userToParticipants}
          attendance={(attendanceRes.data ?? []) as any[]}
          photos={photos as any[]}
        />
      </Suspense>
    </>
  )
}
