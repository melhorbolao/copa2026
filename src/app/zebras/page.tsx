export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ZebrasClient } from './ZebrasClient'
import { detectMatchZebra, getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import type { RuleMap } from '@/lib/scoring/engine'
import type { ZebraMatch, ZebraRankingEntry, ZebraScorer } from './types'

const ZEBRA_THRESHOLD = 20

export default async function ZebrasPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [participantId, { data: profile }] = await Promise.all([
    getActiveParticipantId(supabase, user.id).catch(() => null),
    supabase.from('users').select('is_admin').eq('id', user.id).single(),
  ])
  if (!participantId) redirect('/aguardando-aprovacao')

  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('zebras', isAdmin)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const now = new Date().toISOString()

  const [
    { data: matchesRaw },
    { data: betsRaw },
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
    // vw_public_predictions: só retorna apostas com prazo encerrado (anti-spoiler garantido pela view)
    admin.from('vw_public_predictions').select('participant_id, match_id, score_home, score_away, points'),
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

  return (
    <>
      <Navbar />
      <ZebrasClient
        zebraMatches={zebraMatches}
        ranking={ranking}
        threshold={ZEBRA_THRESHOLD}
      />
    </>
  )
}
