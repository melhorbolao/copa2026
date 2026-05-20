export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PanelaClient } from './PanelaClient'

export default async function MinhaPanelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('minhaPanela', isAdmin)

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = new Date()

  const [
    allParticipantsRes,
    panelaRes,
    scoresRes,
    snapshotRes,
    matchesRes,
  ] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('daily_rankings_snapshot')
      .select('participant_id, rank, pts_total, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(500),
    supabase.from('matches')
      .select('id, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away')
      .order('match_datetime', { ascending: true }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allParticipants: { id: string; apelido: string }[] = allParticipantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map(r => r.member_participant_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scores: { participant_id: string; pts_total: number }[] = scoresRes.data ?? []
  const snapshotRows: { participant_id: string; rank: number; pts_total: number; snapshot_date: string }[] =
    snapshotRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: any[] = matchesRes.data ?? []

  // ── Ranking completo ────────────────────────────────────────────────────────
  const scoreMap: Record<string, number> = {}
  for (const s of scores) scoreMap[s.participant_id] = s.pts_total ?? 0

  const allRanked = allParticipants
    .map(p => ({ id: p.id, apelido: p.apelido, ptsTotal: scoreMap[p.id] ?? 0 }))
    .sort((a, b) => b.ptsTotal - a.ptsTotal)
    .map((p, i) => ({ ...p, rank: i + 1 }))

  // ── Snapshot mais recente por participante ──────────────────────────────────
  const latestDate = snapshotRows.length > 0 ? snapshotRows[0].snapshot_date : null
  const snapshotByPid: Record<string, { rank: number; pts_total: number }> = {}
  if (latestDate) {
    for (const s of snapshotRows) {
      if (s.snapshot_date === latestDate && !snapshotByPid[s.participant_id]) {
        snapshotByPid[s.participant_id] = { rank: s.rank, pts_total: s.pts_total }
      }
    }
  }

  // ── Últimos jogos com resultado ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedMatches = allMatches.filter((m: any) => m.score_home !== null && m.score_away !== null)
  const recentMatches = completedMatches.slice(-5)

  // ── Próximos jogos com prazo encerrado mas sem resultado ────────────────────
  const upcomingMatches = allMatches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) =>
      m.score_home === null &&
      m.score_away === null &&
      new Date(m.betting_deadline) < now,
    )
    .slice(0, 5)

  // ── Palpites para os jogos relevantes ──────────────────────────────────────
  const relevantMatchIds = [...recentMatches, ...upcomingMatches].map((m: any) => m.id)
  let betsRaw: { participant_id: string; match_id: string; score_home: number; score_away: number; points: number | null }[] = []
  if (relevantMatchIds.length > 0) {
    const { data } = await admin
      .from('bets')
      .select('participant_id, match_id, score_home, score_away, points')
      .in('match_id', relevantMatchIds)
    betsRaw = data ?? []
  }

  const betsByParticipant: Record<string, Record<string, { scoreHome: number; scoreAway: number; points: number | null }>> = {}
  for (const b of betsRaw) {
    ;(betsByParticipant[b.participant_id] ??= {})[b.match_id] = {
      scoreHome: b.score_home,
      scoreAway: b.score_away,
      points: b.points,
    }
  }

  return (
    <>
      <Navbar />
      <PanelaClient
        allParticipants={allParticipants}
        currentParticipantId={participantId}
        initialPanelaIds={panelaIds}
        allRanked={allRanked}
        snapshotByPid={snapshotByPid}
        recentMatches={recentMatches.map((m: any) => ({
          id:            m.id,
          teamHome:      m.team_home,
          teamAway:      m.team_away,
          flagHome:      m.flag_home  ?? '',
          flagAway:      m.flag_away  ?? '',
          matchDatetime: m.match_datetime,
          scoreHome:     m.score_home,
          scoreAway:     m.score_away,
        }))}
        upcomingMatches={upcomingMatches.map((m: any) => ({
          id:            m.id,
          teamHome:      m.team_home,
          teamAway:      m.team_away,
          flagHome:      m.flag_home  ?? '',
          flagAway:      m.flag_away  ?? '',
          matchDatetime: m.match_datetime,
        }))}
        betsByParticipant={betsByParticipant}
      />
    </>
  )
}
