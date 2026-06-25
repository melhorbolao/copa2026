export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PanelaClient } from './PanelaClient'
import { getServerNow } from '@/lib/production-mode'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'

export default async function MinhaPanelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  await requirePageAccess('minhaPanela', profile?.role ?? 'user')

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = await getServerNow()

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

  // ── Fetch paralelo: dados base ─────────────────────────────────────────────
  const [
    allParticipantsRes,
    panelaRes,
    snapshotRes,
    matchesRes,
    rulesRes,
    allBetsRaw,
    groupBetsRaw,
    thirdBetsRaw,
    tournamentBetsRes,
  ] = await Promise.all([
    admin.from('participants').select('id, apelido').order('apelido'),
    admin.from('user_panela')
      .select('member_participant_id')
      .eq('owner_participant_id', participantId),
    admin.from('daily_rankings_snapshot')
      .select('participant_id, rank, pts_total, snapshot_date')
      .order('snapshot_date', { ascending: false })
      .limit(500),
    supabase.from('matches')
      .select('id, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, is_brazil')
      .order('match_datetime', { ascending: true }),
    supabase.from('scoring_rules').select('key, points'),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    fetchAll('group_bets', 'participant_id, points'),
    fetchAll('third_place_bets', 'participant_id, points'),
    admin.from('tournament_bets').select('participant_id, points'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allParticipants: { id: string; apelido: string }[] = allParticipantsRes.data ?? []
  const panelaIds: string[] = (
    (panelaRes.data ?? []) as { member_participant_id: string }[]
  ).map(r => r.member_participant_id)
  const snapshotRows: { participant_id: string; rank: number; pts_total: number; snapshot_date: string }[] =
    snapshotRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatches: any[] = matchesRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Pontuação ao vivo (independe de participant_scores) ────────────────────
  const scoredMatches = allMatches.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.score_home !== null && m.score_away !== null,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredById = new Map<string, any>(scoredMatches.map((m: any) => [m.id, m]))

  // Distribuição de resultados por jogo → zebra
  const betsByMatch: Record<string, Array<{ score_home: number; score_away: number }>> = {}
  for (const b of allBetsRaw) {
    ;(betsByMatch[b.match_id] ??= []).push({ score_home: b.score_home, score_away: b.score_away })
  }
  const isZebraMatch: Record<string, boolean> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of scoredMatches as any[]) {
    const actual = getMatchResult(m.score_home, m.score_away)
    isZebraMatch[m.id] = detectMatchZebra(betsByMatch[m.id] ?? [], actual, zebraThreshold)
  }

  // Pontos de jogos por participante
  const ptsMatchesMap: Record<string, number> = {}
  for (const b of allBetsRaw) {
    const m = scoredById.get(b.match_id)
    if (!m) continue
    const pts = scoreMatchBet(
      b.score_home, b.score_away,
      m.score_home, m.score_away,
      isZebraMatch[b.match_id] ?? false,
      m.is_brazil ?? false,
      rules,
    )
    ptsMatchesMap[b.participant_id] = (ptsMatchesMap[b.participant_id] ?? 0) + pts
  }

  // Pontos de grupos / 3os / torneio (somados das colunas já calculadas no DB)
  const ptsGroupsMap: Record<string, number> = {}
  for (const b of groupBetsRaw) {
    if (b.points != null) ptsGroupsMap[b.participant_id] = (ptsGroupsMap[b.participant_id] ?? 0) + b.points
  }
  const ptsThirdsMap: Record<string, number> = {}
  for (const b of thirdBetsRaw) {
    if (b.points != null) ptsThirdsMap[b.participant_id] = (ptsThirdsMap[b.participant_id] ?? 0) + b.points
  }
  const ptsG4Map: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of (tournamentBetsRes.data ?? []) as any[]) {
    if (b.points != null) ptsG4Map[b.participant_id] = b.points
  }

  // ── Ranking completo ────────────────────────────────────────────────────────
  const sortedParticipants = allParticipants
    .map(p => ({
      id: p.id,
      apelido: p.apelido,
      ptsTotal:
        (ptsMatchesMap[p.id] ?? 0) +
        (ptsGroupsMap[p.id]  ?? 0) +
        (ptsThirdsMap[p.id]  ?? 0) +
        (ptsG4Map[p.id]      ?? 0),
    }))
    .sort((a, b) => b.ptsTotal - a.ptsTotal)

  const allRanked: { id: string; apelido: string; ptsTotal: number; rank: number }[] = []
  for (let i = 0; i < sortedParticipants.length; i++) {
    const rank =
      i > 0 && sortedParticipants[i].ptsTotal === sortedParticipants[i - 1].ptsTotal
        ? allRanked[i - 1].rank
        : i + 1
    allRanked.push({ ...sortedParticipants[i], rank })
  }

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

  // ── Jogos recentes (com resultado) e próximos (prazo encerrado) ─────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedMatches = allMatches.filter((m: any) => m.score_home !== null && m.score_away !== null)
  const recentMatches = completedMatches.slice(-10)

  const upcomingMatches = allMatches
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) =>
      m.score_home === null &&
      m.score_away === null &&
      new Date(m.betting_deadline) < now,
    )
    .slice(0, 10)

  // ── Palpites para os jogos exibidos ────────────────────────────────────────
  const relevantMatchIds = new Set([...recentMatches, ...upcomingMatches].map((m: any) => m.id))

  const betsByParticipant: Record<string, Record<string, {
    scoreHome: number; scoreAway: number; points: number | null
  }>> = {}

  for (const b of allBetsRaw) {
    if (!relevantMatchIds.has(b.match_id)) continue
    const m = scoredById.get(b.match_id)
    const pts = m
      ? scoreMatchBet(
          b.score_home, b.score_away,
          m.score_home, m.score_away,
          isZebraMatch[b.match_id] ?? false,
          m.is_brazil ?? false,
          rules,
        )
      : null  // jogo ainda não realizado
    ;(betsByParticipant[b.participant_id] ??= {})[b.match_id] = {
      scoreHome: b.score_home,
      scoreAway: b.score_away,
      points: pts,
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
