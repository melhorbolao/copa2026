export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ClassificacaoMBClient } from './ClassificacaoMBClient'
import { getMatchResult, detectMatchZebra } from '@/lib/scoring/engine'

export const metadata = {}

export default async function ClassificacaoMBPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('classificacaoMB', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes, scoresRes, rulesRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, match_datetime, team_home, team_away, score_home, score_away')
      .order('match_datetime', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away, points'),
    admin.from('group_bets').select('participant_id, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer, points'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
    supabase.from('scoring_rules').select('key, points'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participants = (participantsRes.data ?? []) as { id: string; apelido: string }[]
  const matches = (matchesRes.data ?? []) as {
    id: string; match_number: number; match_datetime: string
    team_home: string; team_away: string
    score_home: number | null; score_away: number | null
  }[]
  const allBets = (betsRes.data ?? []) as {
    participant_id: string; match_id: string
    score_home: number; score_away: number; points: number | null
  }[]
  const allGroupBets = (groupBetsRes.data ?? []) as { participant_id: string; points: number | null }[]
  const allTBets = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string; runner_up: string
    semi1: string; semi2: string; top_scorer: string; points: number | null
  }[]
  const scoresData  = (scoresRes.data ?? []) as { participant_id: string; pts_thirds: number | null }[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))

  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const completedMatches = matches.filter(m => m.score_home !== null)
  const pendingMatches   = matches.filter(m => m.score_home === null)
  const lastMatch  = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1] : null
  const nextMatch  = pendingMatches.length  > 0 ? pendingMatches[0] : null

  // Índices para cálculo rápido
  const ptsThirdsMap: Record<string, number> = Object.fromEntries(scoresData.map(s => [s.participant_id, s.pts_thirds ?? 0]))
  const tBetMap: Record<string, typeof allTBets[0]> = Object.fromEntries(allTBets.map(b => [b.participant_id, b]))
  const matchResultMap: Record<string, { score_home: number; score_away: number }> = {}
  for (const m of completedMatches) matchResultMap[m.id] = { score_home: m.score_home!, score_away: m.score_away! }

  // Agrupar bets por jogo para detecção de zebra
  const betsByMatch: Record<string, { score_home: number; score_away: number }[]> = {}
  for (const bet of allBets) {
    if (!betsByMatch[bet.match_id]) betsByMatch[bet.match_id] = []
    betsByMatch[bet.match_id].push(bet)
  }

  const isZebraMatch: Record<string, boolean> = {}
  for (const m of completedMatches) {
    const actual = getMatchResult(m.score_home!, m.score_away!)
    isZebraMatch[m.id] = detectMatchZebra(betsByMatch[m.id] ?? [], actual, zebraThreshold)
  }

  // Acumular estatísticas por participante
  const ptsMatchesMap:     Record<string, number> = {}
  const cravadosMap:       Record<string, number> = {}
  const pontuadosMap:      Record<string, number> = {}
  const zebraApostMap:     Record<string, number> = {}
  const zebraPontMap:      Record<string, number> = {}
  const lastMatchBets:     Record<string, { score_home: number; score_away: number }> = {}
  const nextMatchBets:     Record<string, { score_home: number; score_away: number }> = {}

  for (const bet of allBets) {
    const pid = bet.participant_id
    const pts = bet.points ?? 0
    const result = matchResultMap[bet.match_id]

    if (result) {
      ptsMatchesMap[pid] = (ptsMatchesMap[pid] ?? 0) + pts
      if (pts > 0) pontuadosMap[pid] = (pontuadosMap[pid] ?? 0) + 1
      if (bet.score_home === result.score_home && bet.score_away === result.score_away) {
        cravadosMap[pid] = (cravadosMap[pid] ?? 0) + 1
      }
      if (isZebraMatch[bet.match_id]) {
        const betRes = getMatchResult(bet.score_home, bet.score_away)
        const actRes = getMatchResult(result.score_home, result.score_away)
        if (betRes === actRes) zebraApostMap[pid] = (zebraApostMap[pid] ?? 0) + 1
        if (pts > 0)           zebraPontMap[pid]  = (zebraPontMap[pid]  ?? 0) + 1
      }
    }

    if (lastMatch && bet.match_id === lastMatch.id) lastMatchBets[pid] = bet
    if (nextMatch && bet.match_id === nextMatch.id) nextMatchBets[pid] = bet
  }

  const ptsGroupsMap: Record<string, number> = {}
  for (const bet of allGroupBets) {
    ptsGroupsMap[bet.participant_id] = (ptsGroupsMap[bet.participant_id] ?? 0) + (bet.points ?? 0)
  }

  const rows = participants.map(p => {
    const ptsMatches = ptsMatchesMap[p.id] ?? 0
    const ptsGroups  = ptsGroupsMap[p.id]  ?? 0
    const ptsThirds  = ptsThirdsMap[p.id]  ?? 0
    const ptsG4      = tBetMap[p.id]?.points ?? 0
    return {
      id: p.id,
      apelido: p.apelido,
      pts: ptsMatches + ptsGroups + ptsThirds + ptsG4,
      ptsMatches,
      ptsClassif:    ptsGroups + ptsThirds,
      ptsG4,
      cravados:      cravadosMap[p.id]   ?? 0,
      pontuados:     pontuadosMap[p.id]  ?? 0,
      zebraApostada: zebraApostMap[p.id] ?? 0,
      zebraPontuada: zebraPontMap[p.id]  ?? 0,
      tournamentBet: tBetMap[p.id] ?? null,
      lastMatchBet:  lastMatchBets[p.id] ?? null,
      nextMatchBet:  nextMatchBets[p.id] ?? null,
    }
  })

  // Abreviações e status de eliminação
  let teamAbbrs: Record<string, string> = {}
  let eliminatedTeams: string[] = []
  let eliminatedStdScorers: string[] = []
  let scorerMapping: Record<string, string> = {}
  let prizeSpots = 8

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamsData } = await admin.from('teams').select('name, abbr_br, is_eliminated') as any
    if (teamsData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const t of teamsData as any[]) {
        if (t.abbr_br) teamAbbrs[t.name] = t.abbr_br
        if (t.is_eliminated) eliminatedTeams.push(t.name)
      }
    }
  } catch { /* tabela ainda não tem a coluna */ }

  try {
    const [scorerRes, settingsRes] = await Promise.all([
      admin.from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
      admin.from('tournament_settings').select('key, value').eq('key', 'prize_spots').maybeSingle(),
    ])
    if (scorerRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of scorerRes.data as any[]) {
        if (row.standardized_name) scorerMapping[row.raw_name] = row.standardized_name
        if (row.is_eliminated && row.standardized_name) {
          eliminatedStdScorers.push(row.standardized_name.trim().toLowerCase())
        }
      }
    }
    if (settingsRes.data?.value) {
      const n = parseInt(settingsRes.data.value, 10)
      if (!isNaN(n) && n > 0) prizeSpots = n
    }
  } catch { /* tabelas opcionais */ }

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()

  return (
    <>
      <Navbar />
      <ClassificacaoMBClient
        rows={rows}
        lastMatch={lastMatch ? {
          id: lastMatch.id,
          abbr_home: abbr(lastMatch.team_home),
          abbr_away: abbr(lastMatch.team_away),
        } : null}
        nextMatch={nextMatch ? {
          id: nextMatch.id,
          abbr_home: abbr(nextMatch.team_home),
          abbr_away: abbr(nextMatch.team_away),
        } : null}
        eliminatedTeams={eliminatedTeams}
        eliminatedStdScorers={[...new Set(eliminatedStdScorers)]}
        scorerMapping={scorerMapping}
        teamAbbrs={teamAbbrs}
        prizeSpots={prizeSpots}
        activeParticipantId={activeParticipantId ?? ''}
      />
    </>
  )
}
