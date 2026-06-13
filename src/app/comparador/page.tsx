export const dynamic = 'force-dynamic'

import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ComparadorClient } from './ComparadorClient'
import type { Snapshot } from './DiaDiaSection'
import { getMatchResult } from '@/lib/scoring/engine'
import { getVisibilitySettings, isBonusVisible, isMatchBetsVisible, getServerNow } from '@/lib/production-mode'
import type { MatchInfo, FlatBet, ColPop } from './engine'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Dados quasi-estáticos: participantes mudam ao aprovação, scoring_rules quase nunca.
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

export default async function ComparadorPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin, role').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('comparador', profile?.role ?? 'user')

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  // Participantes necessários para validar os params antes das queries
  const participants = await getCachedParticipants()
  const validIds = new Set(participants.map(p => p.id))

  // Determina o par ativo a partir dos URL params (?a=UUID&b=UUID)
  const { a: rawA, b: rawB } = await searchParams
  const activePidA = (rawA && UUID_RE.test(rawA) && validIds.has(rawA)) ? rawA : participantId
  const activePidB = (rawB && UUID_RE.test(rawB) && validIds.has(rawB)) ? rawB : null

  // Filtro seletivo: apenas os dois participantes do duelo
  const filter = activePidB ? [activePidA, activePidB] : [activePidA]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [
    rawMatchesRaw,
    rulesRaw,
    betsRes,
    groupBetsRes,
    thirdBetsRes,
    tBetsRes,
    scoresRes,
    betDistRes,
    visibilitySettings,
    scorerMappingRes,
    snapshotsRes,
  ] = await Promise.all([
    // Partidas: sempre fresco (placar muda ao vivo)
    admin
      .from('matches')
      .select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, is_brazil')
      .order('match_datetime', { ascending: true })
      .then((r: { data: object[] | null }) => (r.data ?? []) as object[]),
    getCachedScoringRules(),
    // Apostas de jogos: filtradas pelos dois participantes do duelo (antes: todos)
    admin.from('bets')
      .select('participant_id, match_id, score_home, score_away, points')
      .in('participant_id', filter),
    admin.from('group_bets')
      .select('participant_id, group_name, first_place, second_place, points')
      .in('participant_id', filter),
    admin.from('third_place_bets')
      .select('participant_id, group_name, team, points')
      .in('participant_id', filter),
    admin.from('tournament_bets')
      .select('participant_id, champion, runner_up, semi1, semi2, top_scorer')
      .in('participant_id', filter),
    admin.from('participant_scores')
      .select('participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament, pts_total')
      .in('participant_id', filter),
    // Distribuição agregada por jogo: ~60 linhas em vez de ~5.300 apostas individuais
    admin.rpc('fn_bet_distribution_by_match'),
    getVisibilitySettings(),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    // Pontos diários por participante — mesma fonte do Sobe-Desce (participant_points_by_day)
    admin.from('participant_points_by_day')
      .select('event_date, participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament')
      .in('participant_id', filter)
      .order('event_date', { ascending: true }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawMatches:   any[] = rawMatchesRaw as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allBets:      any[] = betsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allGroupBets: any[] = groupBetsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allThirdBets: any[] = thirdBetsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTBets:     any[] = tBetsRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scores:       any[] = scoresRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betDist:      any[] = betDistRes.data ?? []
  // Computa totais cumulativos por participante por data (mesmo modelo do Sobe-Desce)
  const rawDailyPoints = (snapshotsRes.data ?? []) as {
    event_date: string
    participant_id: string
    pts_matches: number
    pts_groups: number
    pts_thirds: number
    pts_tournament: number
  }[]
  const allEventDates = [...new Set(rawDailyPoints.map(r => r.event_date))].sort()
  const dayPtsMap: Record<string, Record<string, number>> = {}
  for (const r of rawDailyPoints) {
    ;(dayPtsMap[r.event_date] ??= {})[r.participant_id] =
      (r.pts_matches ?? 0) + (r.pts_groups ?? 0) + (r.pts_thirds ?? 0) + (r.pts_tournament ?? 0)
  }
  const snapshots: Snapshot[] = []
  const cumulative: Record<string, number> = {}
  for (const pid of filter) cumulative[pid] = 0
  for (const date of allEventDates) {
    const dayData = dayPtsMap[date] ?? {}
    for (const pid of filter) cumulative[pid] += dayData[pid] ?? 0
    for (const pid of filter) {
      snapshots.push({ snapshot_date: date, participant_id: pid, pts_total: cumulative[pid] })
    }
  }

  // Mapeamento artilheiros
  const scorerMapping: Record<string, string> = {}
  for (const row of (scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string | null }[]) {
    if (row.standardized_name) scorerMapping[row.raw_name.toLowerCase().trim()] = row.standardized_name
  }
  const normalizeScorer = (name: string) => scorerMapping[name.toLowerCase().trim()] ?? name

  // ── Regras e limiar de zebra ──────────────────────────────────────────────
  const rulesMap: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rulesRaw as any[]) { if (r.points !== null && r.points !== undefined) rulesMap[r.key] = r.points }
  const zebraThreshold = rulesMap['percentual_zebra'] ?? 15

  // ── Visibilidade em Modo Produção ─────────────────────────────────────────
  const isTestModeAdmin = isAdmin
  const serverNow = await getServerNow()
  const now = serverNow
  const bonusDeadline = rawMatches.find((m: any) => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusVis = isBonusVisible(bonusDeadline, now, visibilitySettings, isAdmin)
  const deadlineByMatch: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matchById: Record<string, any> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of rawMatches as any[]) {
    deadlineByMatch[m.id] = m.betting_deadline
    matchById[m.id] = m
  }
  const filteredMatchBets = (allBets as any[]).filter((bet: any) => {
    const dl = deadlineByMatch[bet.match_id]
    if (!dl) return false
    if (new Date(dl) > now) return !!participantId && bet.participant_id === participantId
    const m = matchById[bet.match_id]
    if (!m) return false
    const isPlayed = m.score_home !== null && m.score_away !== null
    if (isPlayed) return true
    return isMatchBetsVisible(m.phase, m.round, dl, now, visibilitySettings, isTestModeAdmin)
  })

  // ── colPopMap e matchZebraMap via distribuição agregada ───────────────────
  // fn_bet_distribution_by_match retorna ~60 linhas (uma por jogo) em vez de
  // ~5.300 palpites individuais. O JOIN e o GROUP BY rodam no PostgreSQL.
  const distByMatch: Record<string, { h: number; d: number; a: number; total: number }> = {}
  for (const row of betDist as { match_id: string; h: number; d: number; a: number; total: number }[]) {
    distByMatch[row.match_id] = { h: row.h, d: row.d, a: row.a, total: row.total }
  }

  const colPopMap: Record<string, ColPop> = {}
  for (const [matchId, dist] of Object.entries(distByMatch)) {
    colPopMap[matchId] = { H: dist.h, D: dist.d, A: dist.a, total: dist.total }
  }

  const matchZebraMap: Record<string, boolean> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of rawMatches as any[]) {
    if (m.score_home === null || m.score_away === null) continue
    const dist = distByMatch[m.id]
    if (!dist || dist.total === 0) continue
    const realResult = getMatchResult(m.score_home, m.score_away)
    const resultCount = realResult === 'H' ? dist.h : realResult === 'D' ? dist.d : dist.a
    matchZebraMap[m.id] = (resultCount / dist.total) * 100 <= zebraThreshold
  }

  // ── Build MatchInfo[] ─────────────────────────────────────────────────────
  const matches: MatchInfo[] = rawMatches.map(m => ({
    id:              m.id,
    matchNumber:     m.match_number,
    phase:           m.phase,
    groupName:       m.group_name ?? null,
    round:           m.round ?? null,
    teamHome:        m.team_home,
    teamAway:        m.team_away,
    flagHome:        m.flag_home ?? '',
    flagAway:        m.flag_away ?? '',
    matchDatetime:   m.match_datetime,
    bettingDeadline: m.betting_deadline,
    scoreHome:       m.score_home ?? null,
    scoreAway:       m.score_away ?? null,
    isBrazil:        !!m.is_brazil,
    isZebra:         matchZebraMap[m.id] ?? false,
  }))

  // ── betsByParticipant: participantId → matchId → FlatBet ─────────────────
  const betsByParticipant: Record<string, Record<string, FlatBet>> = {}
  for (const b of filteredMatchBets) {
    ;(betsByParticipant[b.participant_id] ??= {})[b.match_id] = {
      scoreHome: b.score_home,
      scoreAway: b.score_away,
      points:    b.points,
    }
  }

  // ── groupBetsByParticipant ────────────────────────────────────────────────
  const groupBetsByParticipant: Record<string, Record<string, { first: string; second: string; points: number | null }>> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allGroupBets as any[]) {
    if (!bonusVis && b.participant_id !== participantId) continue
    ;(groupBetsByParticipant[b.participant_id] ??= {})[b.group_name] = {
      first:  b.first_place ?? '',
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
      team:   b.team ?? '',
      points: b.points ?? null,
    }
  }

  // ── tBetByParticipant ─────────────────────────────────────────────────────
  const tBetByParticipant: Record<string, { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allTBets as any[]) {
    if (!bonusVis && b.participant_id !== participantId) continue
    tBetByParticipant[b.participant_id] = {
      champion:   b.champion   ?? '',
      runner_up:  b.runner_up  ?? '',
      semi1:      b.semi1      ?? '',
      semi2:      b.semi2      ?? '',
      top_scorer: b.top_scorer ? normalizeScorer(b.top_scorer) : '',
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
        initialPidA={activePidA}
        initialPidB={activePidB ?? ''}
        snapshots={snapshots}
        isAdmin={isAdmin}
      />
    </>
  )
}
