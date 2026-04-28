export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { JogosDashboard } from './JogosDashboard'

export const metadata = {}

export default async function JogosPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin, name').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false

  // Garante que a página aparece no menu (idempotente)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(createAuthAdminClient() as any)
    .from('page_visibility')
    .upsert(
      { page_name: 'jogos', label: 'Jogos', show_for_admin: true, show_for_users: true, sort_order: 0 },
      { onConflict: 'page_name' },
    )
    .then(() => {})
    .catch(() => {})

  await requirePageAccess('jogos', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { m: initialMatchId } = await searchParams

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
    admin.from('teams').select('name, abbr_br').catch(() => ({ data: [] })),
    admin.from('stadium_attendance').select('id, match_id, user_id, participant_ids').catch(() => ({ data: [] })),
    admin.from('stadium_photos').select('id, match_id, user_id, storage_path, participant_ids, caption, created_at').order('created_at', { ascending: false }).catch(() => ({ data: [] })),
    supabase.from('user_participants').select('user_id, participant_id'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamAbbrs: Record<string, string> = Object.fromEntries((teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? '']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storedTotals: Record<string, number> = Object.fromEntries((scoresRes.data ?? []).map((s: any) => [s.participant_id, s.pts_total ?? 0]))

  // Map user_id → participant_ids for the attendance feature
  const userToParticipants: Record<string, string[]> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (userParticipantsRes.data ?? []) as any[]) {
    if (!userToParticipants[row.user_id]) userToParticipants[row.user_id] = []
    userToParticipants[row.user_id].push(row.participant_id)
  }

  // Get signed URLs for photos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photos = (photosRes.data ?? []) as any[]
  const photosWithUrls = await Promise.all(
    photos.map(async (p) => {
      try {
        const { data } = await admin.storage.from('stadium-photos').createSignedUrl(p.storage_path, 3600)
        return { ...p, url: data?.signedUrl ?? null }
      } catch {
        return { ...p, url: null }
      }
    })
  )

  return (
    <>
      <Navbar />
      <JogosDashboard
        initialMatchId={initialMatchId ?? null}
        matches={(matchesRes.data ?? []) as any[]}
        participants={(participantsRes.data ?? []) as any[]}
        bets={(betsRes.data ?? []) as any[]}
        rules={rules}
        teamAbbrs={teamAbbrs}
        storedTotals={storedTotals}
        isAdmin={isAdmin}
        userId={user.id}
        userName={profile?.name ?? ''}
        activeParticipantId={activeParticipantId ?? null}
        userToParticipants={userToParticipants}
        attendance={(attendanceRes.data ?? []) as any[]}
        photos={photosWithUrls}
      />
    </>
  )
}
