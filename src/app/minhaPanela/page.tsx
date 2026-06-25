export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { PanelaClient } from './PanelaClient'
import { getServerNow } from '@/lib/production-mode'
import {
  scoreMatchBet, detectMatchZebra, getMatchResult,
  scoreTournamentBet,
} from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'

// ── Helpers de mata-mata ───────────────────────────────────────────────────────
function knockoutWinner(m: {
  team_home: string; team_away: string
  score_home: number | null; score_away: number | null
  penalty_winner: string | null
}): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  if (m.penalty_winner === 'H') return m.team_home
  if (m.penalty_winner === 'A') return m.team_away
  return null
}

function knockoutLoser(m: Parameters<typeof knockoutWinner>[0]): string | null {
  const w = knockoutWinner(m)
  if (!w) return null
  return w === m.team_home ? m.team_away : m.team_home
}

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

  // ── Fetch paralelo: dados base ─────────────────────────────────────────────
  const [
    allParticipantsRes,
    panelaRes,
    snapshotRes,
    matchesRes,
    rulesRes,
    groupBetsRes,
    tournamentBetsRes,
    scoresRes,
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
      .select('id, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, penalty_winner, is_brazil, phase')
      .order('match_datetime', { ascending: true }),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('group_bets').select('participant_id, points').range(0, 9999),
    // Busca picks (não points) para cálculo ao vivo, igual à classificacaoMB
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
  ])

  // ── Settings opcionais do torneio ──────────────────────────────────────────
  let artillaryPointsActive = false
  let scorerMapping: Record<string, string> = {}
  let officialScorers: string[] = []

  try {
    const [artillaryRow, scorerSetting, scorerRes] = await Promise.all([
      admin.from('tournament_settings').select('value').eq('key', 'artillary_points_active').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
      admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    ])
    artillaryPointsActive = artillaryRow?.data?.value === 'true'
    if (scorerSetting?.data?.value) {
      try { officialScorers = JSON.parse(scorerSetting.data.value) }
      catch { officialScorers = [scorerSetting.data.value] }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (scorerRes.data ?? []) as any[]) {
      if (row.standardized_name)
        scorerMapping[row.raw_name.toLowerCase().trim()] = row.standardized_name
    }
    if (artillaryPointsActive) {
      try {
        const { data: topScorersData } = await admin
          .from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
        if (topScorersData?.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maxGoals = (topScorersData[0] as any).goals_count as number
          if (maxGoals > 0) {
            officialScorers = (topScorersData as { player_name: string; goals_count: number }[])
              .filter(s => s.goals_count === maxGoals)
              .map(s => s.player_name)
          }
        }
      } catch { /* tabela ainda não populada */ }
    }
  } catch { /* tabelas opcionais */ }

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

  // ── Fetch todos os palpites (paginado) ─────────────────────────────────────
  const PAGE = 1000
  let allBetsRaw: { participant_id: string; match_id: string; score_home: number; score_away: number }[] = []
  {
    let from = 0
    for (;;) {
      const { data, error } = await admin
        .from('bets')
        .select('participant_id, match_id, score_home, score_away')
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      allBetsRaw.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
  }

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

  // Pontos de grupos (somados das colunas já calculadas no DB)
  const ptsGroupsMap: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of (groupBetsRes.data ?? []) as any[]) {
    if (b.points != null) ptsGroupsMap[b.participant_id] = (ptsGroupsMap[b.participant_id] ?? 0) + b.points
  }

  // Pontos de terceiros (de participant_scores.pts_thirds — mesma fonte da classificacaoMB)
  const ptsThirdsMap: Record<string, number> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((scoresRes.data ?? []) as any[]).map((s: any) => [s.participant_id, s.pts_thirds ?? 0])
  )

  // ── Pontos G4: calculados ao vivo (igual à classificacaoMB) ───────────────
  const completedMatches = allMatches.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.score_home !== null && m.score_away !== null,
  )
  const qfDone  = completedMatches.filter((m: any) => m.phase === 'quarterfinal')
  const sfDone  = completedMatches.filter((m: any) => m.phase === 'semifinal')
  const finDone = completedMatches.filter((m: any) => m.phase === 'final')
  const tpDone  = completedMatches.filter((m: any) => m.phase === 'third_place')

  const semifinalists = qfDone.map(knockoutWinner).filter(Boolean) as string[]
  const finalists     = sfDone.map(knockoutWinner).filter(Boolean) as string[]
  const champion      = finDone.length > 0 ? knockoutWinner(finDone[0]) : null
  const runnerUp      = finDone.length > 0 ? knockoutLoser(finDone[0])  : null
  const third         = tpDone.length > 0  ? knockoutWinner(tpDone[0])  : null
  const fourth        = tpDone.length > 0  ? knockoutLoser(tpDone[0])   : null

  const tournamentResults: TournamentResults = {
    semifinalists, finalists,
    champion: champion ?? null, runnerUp: runnerUp ?? null,
    third: third ?? null, fourth: fourth ?? null,
    officialScorers,
  }

  const allTBets = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string; runner_up: string
    semi1: string; semi2: string; top_scorer: string
  }[]

  const chamBetsWithPick = allTBets.filter(b => b.champion && b.champion === champion)
  const chamBetsTotal    = allTBets.filter(b => b.champion).length
  const isZebraChampion  = chamBetsTotal > 0 && champion !== null
    && (chamBetsWithPick.length / chamBetsTotal) * 100 <= zebraThreshold

  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: artillaryPointsActive ? (tb.top_scorer ?? '') : '',
      },
      tournamentResults,
      rules,
      isZebraChampion,
      scorerMapping,
    )
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
      : null
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
