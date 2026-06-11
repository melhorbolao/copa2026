export const dynamic = 'force-dynamic'

import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ComparadorClient } from './ComparadorClient'
import type { Snapshot } from './DiaDiaSection'
import { getMatchResult, detectMatchZebra } from '@/lib/scoring/engine'
import { getVisibilitySettings, isBonusVisible, filterBetsByDeadline, getServerNow } from '@/lib/production-mode'
import type { MatchInfo, FlatBet, ColPop } from './engine'

// Dados quasi-estáticos: participantes mudam ao aprovação, matches ao resultado,
// scoring_rules quase nunca. Cache curto evita re-reads a cada acesso.
const getCachedParticipants = unstable_cache(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin.from('participants').select('id, apelido').order('apelido')
    return (data ?? []) as { id: string; apelido: string }[]
  },
  ['comparador:participants'],
  { revalidate: 300, tags: ['participants'] },
)

const getCachedMatches = unstable_cache(
  async () => {
    // admin client: não depende de cookies, seguro dentro de unstable_cache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin
      .from('matches')
      .select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, is_brazil')
      .order('match_datetime', { ascending: true })
    return (data ?? []) as object[]
  },
  ['comparador:matches'],
  { revalidate: 60, tags: ['matches'] },
)

const getCachedScoringRules = unstable_cache(
  async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin.from('scoring_rules').select('key, points')
    return (data ?? []) as { key: string; points: number }[]
  },
  ['comparador:scoring_rules'],
  { revalidate: 3600, tags: ['scoring_rules'] },
)

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of arr) {
    const k = key(item)
    ;(out[k] ??= []).push(item)
  }
  return out
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ComparadorPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('comparador', profile?.role ?? 'user')

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // ── Dados estáticos (cacheados) + dinâmicos (ao vivo) em paralelo ────────────
  const [
    participants,
    rawMatchesRaw,
    rulesRaw,
    allBets,
    allGroupBets,
    allThirdBets,
    allTBetsRes,
    scoresRes,
    visibilitySettings,
    snapshotsRes,
  ] = await Promise.all([
    // cacheados: participantes (5 min), partidas (1 min), regras (1 h)
    getCachedParticipants(),
    getCachedMatches(),
    getCachedScoringRules(),
    // ao vivo: apostas mudam a cada salvamento
    fetchAll('bets', 'participant_id, match_id, score_home, score_away, points'),
    fetchAll('group_bets', 'participant_id, group_name, first_place, second_place, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, team, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores')
      .select('participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament, pts_total'),
    getVisibilitySettings(),
    // daily_rankings_snapshot: cresce 200 linhas/dia — pagina com .order() preservado
    (async () => {
      const PAGE = 1000
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = []
      let from = 0
      for (;;) {
        const { data, error } = await admin.from('daily_rankings_snapshot')
          .select('snapshot_date, participant_id, pts_total')
          .order('snapshot_date', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        rows.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return rows
    })(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMatches: any[] = rawMatchesRaw as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTBets: any[]   = allTBetsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scores: any[]     = scoresRes.data ?? []
  const snapshots: Snapshot[] = snapshotsRes as Snapshot[]

  // ── Build scoring rules map ───────────────────────────────────────────────
  const rulesMap: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rulesRaw as any[]) rulesMap[r.key] = r.points ?? 0
  const zebraThreshold = rulesMap['percentual_zebra'] ?? 15

  // ── Visibilidade em Modo Produção ─────────────────────────────────────────
  const isTestModeAdmin = isAdmin
  const serverNow = await getServerNow()
  const now = serverNow
  const bonusDeadline = rawMatches.find((m: any) => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusVis = isBonusVisible(bonusDeadline, now, visibilitySettings, isAdmin)
  const deadlineByMatch: Record<string, string> = {}
  for (const m of rawMatches as any[]) deadlineByMatch[m.id] = m.betting_deadline
  const filteredMatchBets = filterBetsByDeadline(
    allBets as any[], deadlineByMatch, now, isTestModeAdmin, participantId,
  )

  // ── Bets grouped by match ─────────────────────────────────────────────────
  const betsByMatch = groupBy(filteredMatchBets, b => b.match_id)

  // ── matchZebraMap: was the result a zebra? ────────────────────────────────
  const matchZebraMap: Record<string, boolean> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of rawMatches as any[]) {
    if (m.score_home === null || m.score_away === null) continue
    const realResult = getMatchResult(m.score_home, m.score_away)
    const bets = betsByMatch[m.id] ?? []
    matchZebraMap[m.id] = detectMatchZebra(bets, realResult, zebraThreshold)
  }

  // ── colPopMap: bet distribution per match ────────────────────────────────
  const colPopMap: Record<string, ColPop> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [matchId, bets] of Object.entries(betsByMatch) as [string, any[]][]) {
    const counts: ColPop = { H: 0, D: 0, A: 0, total: bets.length }
    for (const b of bets) {
      const col = getMatchResult(b.score_home, b.score_away)
      counts[col]++
    }
    colPopMap[matchId] = counts
  }

  // ── Build MatchInfo[] ─────────────────────────────────────────────────────
  const matches: MatchInfo[] = rawMatches.map(m => ({
    id:             m.id,
    matchNumber:    m.match_number,
    phase:          m.phase,
    groupName:      m.group_name ?? null,
    round:          m.round ?? null,
    teamHome:       m.team_home,
    teamAway:       m.team_away,
    flagHome:       m.flag_home ?? '',
    flagAway:       m.flag_away ?? '',
    matchDatetime:  m.match_datetime,
    bettingDeadline: m.betting_deadline,
    scoreHome:      m.score_home ?? null,
    scoreAway:      m.score_away ?? null,
    isBrazil:       !!m.is_brazil,
    isZebra:        matchZebraMap[m.id] ?? false,
  }))

  // ── betsByParticipant: participantId → matchId → FlatBet ─────────────────
  const betsByParticipant: Record<string, Record<string, FlatBet>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of filteredMatchBets) {
    ;(betsByParticipant[b.participant_id] ??= {})[b.match_id] = {
      scoreHome: b.score_home,
      scoreAway: b.score_away,
      points: b.points,
    }
  }

  // ── groupBetsByParticipant ────────────────────────────────────────────────
  const groupBetsByParticipant: Record<string, Record<string, { first: string; second: string; points: number | null }>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allGroupBets as any[]) {
    if (!bonusVis && b.participant_id !== participantId) continue
    ;(groupBetsByParticipant[b.participant_id] ??= {})[b.group_name] = {
      first: b.first_place ?? '',
      second: b.second_place ?? '',
      points: b.points,
    }
  }

  // ── thirdBetsByParticipant ────────────────────────────────────────────────
  const thirdBetsByParticipant: Record<string, Record<string, { team: string; points: number | null }>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allThirdBets as any[]) {
    if (!bonusVis && b.participant_id !== participantId) continue
    ;(thirdBetsByParticipant[b.participant_id] ??= {})[b.group_name] = {
      team: b.team ?? '',
      points: b.points ?? null,
    }
  }

  // ── tBetByParticipant ─────────────────────────────────────────────────────
  const tBetByParticipant: Record<string, { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allTBets as any[]) {
    if (!bonusVis && b.participant_id !== participantId) continue
    tBetByParticipant[b.participant_id] = {
      champion:   b.champion ?? '',
      runner_up:  b.runner_up ?? '',
      semi1:      b.semi1 ?? '',
      semi2:      b.semi2 ?? '',
      top_scorer: b.top_scorer ?? '',
    }
  }

  // ── scoresByParticipant ───────────────────────────────────────────────────
  const scoresByParticipant: Record<string, { ptsMatches: number; ptsGroups: number; ptsThirds: number; ptsTournament: number; ptsTotal: number }> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const s of scores as any[]) {
    scoresByParticipant[s.participant_id] = {
      ptsMatches:    s.pts_matches    ?? 0,
      ptsGroups:     s.pts_groups     ?? 0,
      ptsThirds:     s.pts_thirds     ?? 0,
      ptsTournament: s.pts_tournament ?? 0,
      ptsTotal:      s.pts_total      ?? 0,
    }
  }

  return (
    <>
      <Navbar />
      <ComparadorClient
        participants={participants}
        matches={matches}
        betsByParticipant={betsByParticipant}
        groupBetsByParticipant={groupBetsByParticipant}
        thirdBetsByParticipant={thirdBetsByParticipant}
        tBetByParticipant={tBetByParticipant}
        scoresByParticipant={scoresByParticipant}
        colPopMap={colPopMap}
        rulesMap={rulesMap}
        zebraThreshold={zebraThreshold}
        currentParticipantId={participantId}
        snapshots={snapshots}
        isAdmin={isAdmin}
      />
    </>
  )
}
