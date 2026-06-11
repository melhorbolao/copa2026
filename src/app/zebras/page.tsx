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

  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('zebras', profile?.role ?? 'user')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = new Date().toISOString()

  const [
    { data: matchesRaw },
    betsRaw,
    { data: participants },
    { data: scores },
    { data: rulesRaw },
  ] = await Promise.all([
    // Apenas partidas com prazo encerrado E resultado oficial
    admin
      .from('matches')
      .select('id, match_number, phase, group_name, team_home, team_away, flag_home, flag_away, match_datetime, betting_deadline, score_home, score_away, is_brazil')
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
    admin.from('participants').select('id, apelido'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('scoring_rules').select('key, points'),
  ])

  const rules: RuleMap = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rulesRaw ?? []).map((r: any) => [r.key, Number(r.points)])
  )

  // Ranking geral de pontos (para exibir posição ao lado do apelido)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedScores = [...(scores ?? [])].sort((a: any, b: any) => b.pts_total - a.pts_total)
  const positionMap = new Map<string, number>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sortedScores.map((s: any, i: number) => [s.participant_id, i + 1])
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participantMap = new Map<string, string>((participants ?? []).map((p: any) => [p.id, p.apelido]))

  // Mapa nome-do-time → código de bandeira (para cards de grupo e G4)
  const teamFlags: Record<string, string> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (matchesRaw ?? []) as any[]) {
    if (m.team_home && m.flag_home) teamFlags[m.team_home] = m.flag_home
    if (m.team_away && m.flag_away) teamFlags[m.team_away] = m.flag_away
  }

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

    zebraMatches.push({
      id: match.id,
      matchNumber: match.match_number,
      teamHome: match.team_home,
      teamAway: match.team_away,
      flagHome: match.flag_home ?? '',
      flagAway: match.flag_away ?? '',
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

  // ── Radar: apostas encerradas para jogos/grupos/G4 ainda não realizados ─────
  // Conceito: prazo de apostas JÁ ENCERRADO, mas resultado/classificação ainda
  // não definido. Apostas estão bloqueadas — distribuição final.

  // 1. Jogos sem placar oficial (admin vê todos; outros só os com prazo encerrado)
  const pendingQuery = admin
    .from('matches')
    .select('id, team_home, team_away, flag_home, flag_away, match_datetime, phase, group_name, round, city')
    .is('score_home', null)
    .neq('team_home', 'TBD')
    .neq('team_away', 'TBD')
    .order('match_datetime', { ascending: true })
  const { data: pendingMatchesRaw } = await (isAdmin ? pendingQuery : pendingQuery.lte('betting_deadline', now))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Completa teamFlags com times das partidas ainda não realizadas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (pendingMatchesRaw ?? []) as any[]) {
    if (m.team_home && m.flag_home) teamFlags[m.team_home] = m.flag_home
    if (m.team_away && m.flag_away) teamFlags[m.team_away] = m.flag_away
  }

  const pendingIds = ((pendingMatchesRaw ?? []) as any[]).map((m: any) => m.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingBetsRaw: any[] = []
  if (pendingIds.length > 0) {
    const PAGE = 1000
    let from = 0
    for (;;) {
      const { data, error } = await admin.from('bets').select('match_id, score_home, score_away').in('match_id', pendingIds).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      pendingBetsRaw.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingBetsByMatch = new Map<string, any[]>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const bet of pendingBetsRaw as any[]) {
    const list = pendingBetsByMatch.get(bet.match_id) ?? []
    list.push(bet)
    pendingBetsByMatch.set(bet.match_id, list)
  }

  const potentialUpsets: PotentialUpset[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const match of (pendingMatchesRaw ?? []) as any[]) {
    const matchBets = pendingBetsByMatch.get(match.id) ?? []
    if (matchBets.length === 0) continue

    const total = matchBets.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const homeCount = matchBets.filter((b: any) => (b.score_home ?? 0) > (b.score_away ?? 0)).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const awayCount = matchBets.filter((b: any) => (b.score_away ?? 0) > (b.score_home ?? 0)).length
    const drawCount = total - homeCount - awayCount

    const homePct = Math.round((homeCount / total) * 100)
    const drawPct = Math.round((drawCount / total) * 100)
    const awayPct = Math.round((awayCount / total) * 100)

    const zebraColumns: ('H' | 'D' | 'A')[] = []
    if (homePct <= ZEBRA_THRESHOLD) zebraColumns.push('H')
    if (drawPct <= ZEBRA_THRESHOLD) zebraColumns.push('D')
    if (awayPct <= ZEBRA_THRESHOLD) zebraColumns.push('A')

    if (zebraColumns.length === 0) continue

    potentialUpsets.push({
      id: match.id,
      teamHome: match.team_home,
      teamAway: match.team_away,
      flagHome: match.flag_home ?? '',
      flagAway: match.flag_away ?? '',
      matchDatetime: match.match_datetime,
      phase: match.phase,
      groupName: match.group_name ?? null,
      round: match.round ?? null,
      city: match.city ?? null,
      homePct,
      drawPct,
      awayPct,
      zebraColumns,
    })
  }

  // 2. Grupos com classificação ainda indefinida (algum jogo do grupo sem placar)
  const pendingGroupNames = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((pendingMatchesRaw ?? []) as any[])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m.phase === 'group' && m.group_name)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => m.group_name as string)
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
        const pct = Math.round((count / total) * 100)
        if (pct > ZEBRA_THRESHOLD) continue
        potentialGroupZebras.push({ groupName, teamName: team, flagCode: teamFlags[team] ?? '', pct, count, total })
      }
    }
    potentialGroupZebras.sort((a, b) => a.pct - b.pct || a.groupName.localeCompare(b.groupName))
  }

  // 3. G4 da Copa: seleções apostadas em ≤ 15% dos bets (em qualquer posição do G4)
  const potentialG4Zebras: PotentialG4Zebra[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bonusDeadlinePassed = isAdmin || (matchesRaw ?? []).some((m: any) => m.phase === 'group')
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
      // Conta quantos participantes incluem cada time em QUALQUER posição do G4
      // (deduplicado por participante: um time conta uma vez mesmo em dois slots)
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
        const pct = Math.round((count / total) * 100)
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
