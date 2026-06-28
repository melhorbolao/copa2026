export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ZebrasClient } from './ZebrasClient'
import { detectMatchZebra, getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import type { RuleMap } from '@/lib/scoring/engine'
import type { ZebraMatch, ZebraRankingEntry, ZebraScorer, PotentialUpset, PotentialGroupZebra, PotentialG4Zebra } from './types'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

const ZEBRA_THRESHOLD = 15

export default async function ZebrasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [participantId, { data: profile }] = await Promise.all([
    getActiveParticipantId(supabase, user.id).catch(() => null),
    supabase.from('users').select('is_admin, role').eq('id', user.id).single(),
  ])
  if (!participantId) redirect('/aguardando-aprovacao')

  await requirePageAccess('zebras', profile?.role ?? 'user')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = new Date().toISOString()

  const [
    { data: matchesRaw },
    betsRaw,
    { data: radarMv },
    { data: rankingMv },
    { data: rulesRaw },
  ] = await Promise.all([
    // Partidas com prazo encerrado E resultado oficial (para zebraMatches)
    admin
      .from('matches')
      .select('id, match_number, phase, group_name, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, penalty_winner, is_brazil')
      .not('score_home', 'is', null)
      .not('score_away', 'is', null)
      .lte('betting_deadline', now)
      .order('match_datetime', { ascending: false }),
    // vw_public_predictions: prazo encerrado via view. Pagina — 200 participantes × 111 jogos > 1000.
    (async () => {
      const PAGE = 1000
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = []
      let from = 0
      for (;;) {
        const { data, error } = await admin.from('vw_public_predictions')
          .select('participant_id, match_id, score_home, score_away, points')
          .range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        rows.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return rows
    })(),
    // mv_zebras_radar: jogos sem placar, prazo encerrado, pcts pré-calculados (~20 linhas)
    admin
      .from('mv_zebras_radar')
      .select('*')
      .order('match_datetime', { ascending: true }),
    // mv_general_ranking: substitui participants + participant_scores (~100 linhas)
    admin
      .from('mv_general_ranking')
      .select('participant_id, apelido, posicao'),
    admin.from('scoring_rules').select('key, points'),
  ])

  const rules: RuleMap = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rulesRaw ?? []).map((r: any) => [r.key, Number(r.points)])
  )

  // participantMap e positionMap a partir do ranking MV (usa DENSE_RANK com desempate por cravadas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participantMap = new Map<string, string>((rankingMv ?? []).map((r: any) => [r.participant_id, r.apelido]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const positionMap = new Map<string, number>((rankingMv ?? []).map((r: any) => [r.participant_id, r.posicao]))

  // Mapa nome-do-time → código de bandeira (para cards de grupo e G4)
  const teamFlags: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (matchesRaw ?? []) as any[]) {
    if (m.team_home && m.flag_home) teamFlags[m.team_home] = m.flag_home
    if (m.team_away && m.flag_away) teamFlags[m.team_away] = m.flag_away
  }
  // Completa teamFlags com bandeiras das partidas no radar (prazo encerrado, sem placar)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (radarMv ?? []) as any[]) {
    if (row.team_home && row.flag_home) teamFlags[row.team_home] = row.flag_home
    if (row.team_away && row.flag_away) teamFlags[row.team_away] = row.flag_away
  }

  // ── Resolver nomes reais de times em jogos eliminatórios ─────────────────────
  // matchesRaw só tem jogos pontuados; radarMv tem os sem placar (potential upsets).
  // Combinamos os dois para cobrir todos os jogos de mata-mata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zebrasGroupSlim: MatchSlim[] = (matchesRaw ?? []).filter((m: any) => m.phase === 'group').map((m: any) => ({
    id: m.id, group_name: m.group_name, phase: m.phase,
    team_home: m.team_home, team_away: m.team_away,
    flag_home: m.flag_home ?? '', flag_away: m.flag_away ?? '',
  }))
  const zebrasOfficialBetMap = new Map<string, BetSlim>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (matchesRaw ?? []) as any[]) {
    if (m.phase === 'group')
      zebrasOfficialBetMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
  }
  const zebrasByGroup = new Map<string, { total: number; scored: number }>()
  for (const m of zebrasGroupSlim) {
    const e = zebrasByGroup.get(m.group_name!) ?? { total: 0, scored: 0 }
    e.total++
    if (zebrasOfficialBetMap.has(m.id)) e.scored++
    zebrasByGroup.set(m.group_name!, e)
  }
  const zebrasCompleteGroups = new Set<string>(
    [...zebrasByGroup.entries()].filter(([, v]) => v.total > 0 && v.scored === v.total).map(([k]) => k),
  )
  const zebrasAllGroupsComplete = zebrasByGroup.size > 0 && zebrasCompleteGroups.size === zebrasByGroup.size
  const zebrasStandings = calcGroupStandings(zebrasGroupSlim, zebrasOfficialBetMap)
  const zebrasThirds = rankThirds(zebrasStandings)
  const zebrasThirdSlots = resolveThirdSlots(zebrasThirds)
  const zebrasR32Slots = buildR32Teams(zebrasStandings, zebrasThirds, zebrasThirdSlots, undefined, zebrasCompleteGroups, zebrasAllGroupsComplete)
  // Agrupa partidas de mata-mata: sem placar (radar) + pontuadas (matchesRaw), priorizando pontuadas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zebrasKoMatchMap = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (radarMv ?? []) as any[]) {
    if (['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(row.phase)) {
      zebrasKoMatchMap.set(row.match_id, {
        id: row.match_id, phase: row.phase, match_number: row.match_number as number,
        team_home: row.team_home, flag_home: row.flag_home ?? '',
        team_away: row.team_away, flag_away: row.flag_away ?? '',
        score_home: null, score_away: null, penalty_winner: null,
      })
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (matchesRaw ?? []) as any[]) {
    if (['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase)) {
      zebrasKoMatchMap.set(m.id, {
        id: m.id, phase: m.phase, match_number: m.match_number as number,
        team_home: m.team_home, flag_home: m.flag_home ?? '',
        team_away: m.team_away, flag_away: m.flag_away ?? '',
        score_home: m.score_home as number | null, score_away: m.score_away as number | null,
        penalty_winner: m.penalty_winner as string | null,
      })
    }
  }
  const knockoutTeamMapZebra = buildKnockoutTeamMap(zebrasR32Slots, [...zebrasKoMatchMap.values()])

  // Apenas apostas de partidas com prazo encerrado (filtro duplo de segurança)
  const deadlineMatchIds = new Set((matchesRaw ?? []).map((m: { id: string }) => m.id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betsByMatch = new Map<string, any[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const bet of (betsRaw ?? []) as any[]) {
    if (!deadlineMatchIds.has(bet.match_id)) continue
    const list = betsByMatch.get(bet.match_id) ?? []
    list.push(bet)
    betsByMatch.set(bet.match_id, list)
  }

  // Detecta zebras e monta estrutura
  const zebraMatches: ZebraMatch[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const match of (matchesRaw ?? []) as any[]) {
    const matchBets = betsByMatch.get(match.id) ?? []
    if (matchBets.length === 0) continue

    const actualResult = getMatchResult(match.score_home, match.score_away)
    const isZebra = detectMatchZebra(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      matchBets.map((b: any) => ({ score_home: b.score_home ?? 0, score_away: b.score_away ?? 0 })),
      actualResult,
      ZEBRA_THRESHOLD,
    )
    if (!isZebra) continue

    const total = matchBets.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const homeCount = matchBets.filter((b: any) => (b.score_home ?? 0) > (b.score_away ?? 0)).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const awayCount = matchBets.filter((b: any) => (b.score_away ?? 0) > (b.score_home ?? 0)).length
    const drawCount = total - homeCount - awayCount

    const scorers: ZebraScorer[] = (matchBets as { participant_id: string; score_home: number | null; score_away: number | null; points: number | null }[])
      .filter(b => getMatchResult(b.score_home ?? 0, b.score_away ?? 0) === actualResult)
      .map(b => {
        const isExact = b.score_home === match.score_home && b.score_away === match.score_away
        const pts = b.points ?? scoreMatchBet(
          b.score_home ?? 0, b.score_away ?? 0,
          match.score_home, match.score_away,
          true, match.is_brazil ?? false, rules,
        )
        return {
          participantId: b.participant_id,
          apelido: participantMap.get(b.participant_id) ?? '?',
          position: positionMap.get(b.participant_id) ?? null,
          isExact,
          pts,
        }
      })
      .sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt'))

    const zmOv = knockoutTeamMapZebra.get(match.id)
    zebraMatches.push({
      id: match.id,
      matchNumber: match.match_number,
      teamHome: zmOv?.team_home ?? match.team_home,
      teamAway: zmOv?.team_away ?? match.team_away,
      flagHome: zmOv?.flag_home ?? match.flag_home ?? '',
      flagAway: zmOv?.flag_away ?? match.flag_away ?? '',
      scoreHome: match.score_home,
      scoreAway: match.score_away,
      actualResult,
      matchDatetime: match.match_datetime,
      totalBets: total,
      homeCount,
      drawCount,
      awayCount,
      scorers,
    })
  }

  // Ranking: agrega por participante
  const rankingMap = new Map<string, { cravadas: number; colunas: number; pts: number }>()
  for (const zm of zebraMatches) {
    for (const s of zm.scorers) {
      const entry = rankingMap.get(s.participantId) ?? { cravadas: 0, colunas: 0, pts: 0 }
      if (s.isExact) entry.cravadas++
      else entry.colunas++
      entry.pts += s.pts
      rankingMap.set(s.participantId, entry)
    }
  }

  const ranking: ZebraRankingEntry[] = [...rankingMap.entries()]
    .map(([pid, stats]) => ({
      participantId: pid,
      apelido: participantMap.get(pid) ?? '?',
      position: positionMap.get(pid) ?? null,
      ...stats,
    }))
    .sort((a, b) => b.pts - a.pts || b.cravadas - a.cravadas || b.colunas - a.colunas)

  // ── Radar: potentialUpsets a partir da MV (prazo encerrado, sem placar) ────
  // mv_zebras_radar já tem os percentuais pré-calculados — zero I/O de agregação.
  type RadarRow = {
    match_id: string; match_number: number; team_home: string; team_away: string
    flag_home: string; flag_away: string; match_datetime: string
    phase: string; group_name: string | null; round: number | null; city: string | null
    home_pct: number; draw_pct: number; away_pct: number
    home_count: number; draw_count: number; away_count: number; total_bets: number
  }

  const potentialUpsetsFromMv: PotentialUpset[] = []
  for (const row of (radarMv ?? []) as RadarRow[]) {
    const total = row.total_bets ?? 0
    const zebraColumns: ('H' | 'D' | 'A')[] = []
    if (total === 0 || row.home_count / total * 100 <= ZEBRA_THRESHOLD) zebraColumns.push('H')
    if (total === 0 || row.draw_count / total * 100 <= ZEBRA_THRESHOLD) zebraColumns.push('D')
    if (total === 0 || row.away_count / total * 100 <= ZEBRA_THRESHOLD) zebraColumns.push('A')
    if (zebraColumns.length === 0) continue
    const ruOv = knockoutTeamMapZebra.get(row.match_id)
    potentialUpsetsFromMv.push({
      id: row.match_id,
      teamHome: ruOv?.team_home ?? row.team_home,
      teamAway: ruOv?.team_away ?? row.team_away,
      flagHome: ruOv?.flag_home ?? row.flag_home ?? '',
      flagAway: ruOv?.flag_away ?? row.flag_away ?? '',
      matchDatetime: row.match_datetime,
      phase: row.phase,
      groupName: row.group_name ?? null,
      round: row.round ?? null,
      city: row.city ?? null,
      homePct: row.home_pct,
      drawPct: row.draw_pct,
      awayPct: row.away_pct,
      homeCount: row.home_count ?? 0,
      drawCount: row.draw_count ?? 0,
      awayCount: row.away_count ?? 0,
      totalBets: total,
      zebraColumns,
    })
  }

  const potentialUpsets: PotentialUpset[] = potentialUpsetsFromMv

  // 2. Grupos com classificação ainda indefinida
  const pendingGroupNames = new Set<string>(
    (radarMv ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => r.phase === 'group' && r.group_name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.group_name as string)
  )

  const potentialGroupZebras: PotentialGroupZebra[] = []
  if (pendingGroupNames.size > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allGroupBets: any[] = []
    {
      const PAGE = 1000; let from = 0
      for (;;) {
        const { data, error } = await admin.from('group_bets').select('group_name, first_place').range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        allGroupBets.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
    }
    for (const groupName of [...pendingGroupNames].sort()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const groupBets = allGroupBets.filter((b: any) => b.group_name === groupName && b.first_place)
      const total = groupBets.length
      if (total === 0) continue
      const counts = new Map<string, number>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const b of groupBets) counts.set(b.first_place, (counts.get(b.first_place) ?? 0) + 1)
      for (const [team, count] of counts) {
        const pct = parseFloat(((count / total) * 100).toFixed(1))
        if (pct > ZEBRA_THRESHOLD) continue
        potentialGroupZebras.push({ groupName, teamName: team, flagCode: teamFlags[team] ?? '', pct, count, total })
      }
    }
    potentialGroupZebras.sort((a, b) => a.pct - b.pct || a.groupName.localeCompare(b.groupName))
  }

  // 3. G4 da Copa: seleções apostadas em ≤ 15% dos bets (em qualquer posição do G4)
  const potentialG4Zebras: PotentialG4Zebra[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bonusDeadlinePassed = (matchesRaw ?? []).some((m: any) => m.phase === 'group')
  if (bonusDeadlinePassed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tBetsData } = await admin.from('tournament_bets').select('champion, runner_up, semi1, semi2') as any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tBets: any[] = tBetsData ?? []
    const total = tBets.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completedPhases = new Set((matchesRaw ?? []).map((m: any) => m.phase as string))
    const hasChampion = completedPhases.has('final')

    if (total > 0 && !hasChampion) {
      const teamCounts = new Map<string, number>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const b of tBets) {
        const seen = new Set<string>()
        for (const field of ['champion', 'runner_up', 'semi1', 'semi2']) {
          const team: string = b[field]
          if (team && !seen.has(team)) {
            seen.add(team)
            teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1)
          }
        }
      }
      for (const [team, count] of teamCounts) {
        const pct = parseFloat(((count / total) * 100).toFixed(1))
        if (pct > ZEBRA_THRESHOLD) continue
        potentialG4Zebras.push({ teamName: team, flagCode: teamFlags[team] ?? '', pct, count, total })
      }
      potentialG4Zebras.sort((a, b) => a.pct - b.pct)
    }
  }

  return (
    <>
      <Navbar />
      <ZebrasClient
        zebraMatches={zebraMatches}
        ranking={ranking}
        threshold={ZEBRA_THRESHOLD}
        potentialUpsets={potentialUpsets}
        potentialGroupZebras={potentialGroupZebras}
        potentialG4Zebras={potentialG4Zebras}
      />
    </>
  )
}
