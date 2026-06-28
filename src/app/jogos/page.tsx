export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { JogosDashboard } from './JogosDashboard'
import { filterBetsByDeadline, getServerNow } from '@/lib/production-mode'
import { scoreMatchBet, detectMatchZebra, getMatchResult, scoreTournamentBet } from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'

export const metadata = {}

// ── Helpers de mata-mata ──────────────────────────────────────────────────────
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

export default async function JogosPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.auth.getUser().then(() =>
    supabase.from('users').select('is_admin, name, role').eq('id', user.id).single()
  )
  const isAdmin = profile?.is_admin ?? false

  await requirePageAccess('jogos', profile?.role ?? 'user')

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { m: initialMatchId } = await searchParams
  const isTestModeAdmin = isAdmin

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

  const [
    matchesRes, participantsRes, betsRes, rulesRes, teamAbbrRes,
    attendanceRes, photosRes, userParticipantsRes,
    groupBetsRaw, tournamentBetsPicksRes, scoresRes,
  ] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, phase, round, group_name, team_home, team_away, flag_home, flag_away, match_datetime, city, betting_deadline, score_home, score_away, penalty_winner, is_brazil')
      .order('match_datetime', { ascending: true }),
    supabase.from('participants').select('id, apelido').order('apelido', { ascending: true }),
    fetchAll('bets', 'participant_id, match_id, score_home, score_away, points'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('teams').select('name, abbr_br'),
    admin.from('stadium_attendance').select('id, match_id, user_id, participant_ids'),
    admin.from('stadium_photos').select('id, match_id, user_id, storage_path, participant_ids, caption, created_at').order('created_at', { ascending: false }),
    supabase.from('user_participants').select('user_id, participant_id'),
    // Dados extras para calcular storedTotals com a mesma fórmula da classificacaoMB
    fetchAll('group_bets', 'participant_id, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamAbbrs: Record<string, string> = Object.fromEntries((teamAbbrRes.data ?? []).map((t: any) => [t.name, t.abbr_br ?? '']))

  // ── Tournament settings (opcionais) ───────────────────────────────────────
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

  // ── Calcular storedTotals com a mesma fórmula ao vivo da classificacaoMB ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMatchesList = (matchesRes.data ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allBetsRaw = betsRes as any[] // fetchAll retorna array diretamente

  const scoredMatches = allMatchesList.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.score_home !== null && m.score_away !== null,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoredById = new Map<string, any>(scoredMatches.map((m: any) => [m.id, m]))

  const betsByMatchAll: Record<string, Array<{ score_home: number; score_away: number }>> = {}
  for (const b of allBetsRaw) {
    ;(betsByMatchAll[b.match_id] ??= []).push({ score_home: b.score_home, score_away: b.score_away })
  }
  const isZebraMatchAll: Record<string, boolean> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of scoredMatches as any[]) {
    const actual = getMatchResult(m.score_home, m.score_away)
    isZebraMatchAll[m.id] = detectMatchZebra(betsByMatchAll[m.id] ?? [], actual, zebraThreshold)
  }

  const ptsMatchesMap: Record<string, number> = {}
  for (const b of allBetsRaw) {
    const m = scoredById.get(b.match_id)
    if (!m) continue
    const pts = scoreMatchBet(
      b.score_home, b.score_away,
      m.score_home, m.score_away,
      isZebraMatchAll[b.match_id] ?? false,
      (m.is_brazil || m.team_home === 'Brasil' || m.team_away === 'Brasil'),
      rules,
    )
    ptsMatchesMap[b.participant_id] = (ptsMatchesMap[b.participant_id] ?? 0) + pts
  }

  const ptsGroupsMap: Record<string, number> = {}
  for (const b of groupBetsRaw) {
    if (b.points != null) ptsGroupsMap[b.participant_id] = (ptsGroupsMap[b.participant_id] ?? 0) + b.points
  }

  const ptsThirdsMap: Record<string, number> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((scoresRes.data ?? []) as any[]).map((s: any) => [s.participant_id, s.pts_thirds ?? 0])
  )

  // Resultados do torneio para ptsG4 ao vivo
  const qfDone  = scoredMatches.filter((m: any) => m.phase === 'quarterfinal')
  const sfDone  = scoredMatches.filter((m: any) => m.phase === 'semifinal')
  const finDone = scoredMatches.filter((m: any) => m.phase === 'final')
  const tpDone  = scoredMatches.filter((m: any) => m.phase === 'third_place')

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

  const allTBets = (tournamentBetsPicksRes.data ?? []) as {
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

  // storedTotals com fórmula idêntica à clasificacaoMB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storedTotals: Record<string, number> = Object.fromEntries(
    (participantsRes.data ?? []).map((p: any) => [
      p.id,
      (ptsMatchesMap[p.id] ?? 0) +
      (ptsGroupsMap[p.id]  ?? 0) +
      (ptsThirdsMap[p.id]  ?? 0) +
      (ptsG4Map[p.id]      ?? 0),
    ])
  )

  // Filtrar palpites: só expõe ao cliente após o prazo da partida (ou próprios do usuário ativo)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deadlineByMatch: Record<string, string> = Object.fromEntries(
    allMatchesList.map((m: any) => [m.id, m.betting_deadline])
  )
  const serverNow = await getServerNow()
  const safeBets = filterBetsByDeadline(
    allBetsRaw,
    deadlineByMatch,
    serverNow,
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
