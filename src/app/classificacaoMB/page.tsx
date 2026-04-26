export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ClassificacaoMBClient } from './ClassificacaoMBClient'
import { getMatchResult, detectMatchZebra, scoreTournamentBet } from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'

export const metadata = {}

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

  // ── Fetch #1: dados base ───────────────────────────────────────────────────
  const [participantsRes, matchesRes, betsRes, groupBetsRes, tournamentBetsRes, scoresRes, rulesRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('matches')
      .select('id, match_number, match_datetime, team_home, team_away, score_home, score_away, phase, penalty_winner')
      .order('match_datetime', { ascending: true }),
    admin.from('bets').select('participant_id, match_id, score_home, score_away, points'),
    admin.from('group_bets').select('participant_id, points'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    admin.from('participant_scores').select('participant_id, pts_thirds'),
    supabase.from('scoring_rules').select('key, points'),
  ])

  // ── Fetch #2: dados auxiliares ─────────────────────────────────────────────
  let teamAbbrs: Record<string, string> = {}
  let eliminatedTeams: string[] = []
  let scorerMapping: Record<string, string> = {}
  let eliminatedStdScorers: string[] = []
  let officialScorers: string[] = []
  let prizeSpots = 8
  let premioSpots = 10
  const colVisibility: Record<string, boolean> = {
    premio:       false,
    delta_premio: true,
    delta_corte:  true,
    pts_cl:       true,
    pts_g4:       true,
  }

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
  } catch { /* tabela não tem a coluna ainda */ }

  try {
    const COL_KEYS = [
      'classif_col_premio', 'classif_col_delta_premio',
      'classif_col_delta_corte', 'classif_col_pts_cl', 'classif_col_pts_g4',
    ]
    const [scorerRes, scorerSetting, settingsRes, premioSpotsRes, colSettingsRes] = await Promise.all([
      admin.from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
      admin.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'prize_spots').maybeSingle(),
      admin.from('tournament_settings').select('value').eq('key', 'premio_spots').maybeSingle(),
      admin.from('tournament_settings').select('key, value').in('key', COL_KEYS),
    ])
    if (scorerRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of scorerRes.data as any[]) {
        if (row.standardized_name) scorerMapping[row.raw_name] = row.standardized_name
        if (row.is_eliminated && row.standardized_name)
          eliminatedStdScorers.push(row.standardized_name.trim().toLowerCase())
      }
    }
    if (scorerSetting.data?.value) {
      try { officialScorers = JSON.parse(scorerSetting.data.value) }
      catch { officialScorers = [scorerSetting.data.value] }
    }
    if (settingsRes.data?.value) {
      const n = parseInt(settingsRes.data.value, 10)
      if (!isNaN(n) && n > 0) prizeSpots = n
    }
    if (premioSpotsRes.data?.value) {
      const n = parseInt(premioSpotsRes.data.value, 10)
      if (!isNaN(n) && n > 0) premioSpots = n
    }
    if (colSettingsRes.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of colSettingsRes.data as any[]) {
        const short = (r.key as string).replace('classif_col_', '')
        colVisibility[short] = r.value === 'true'
      }
    }
  } catch { /* tabelas opcionais */ }

  // ── Processar dados base ───────────────────────────────────────────────────
  const participants = (participantsRes.data ?? []) as { id: string; apelido: string }[]
  const matches = (matchesRes.data ?? []) as {
    id: string; match_number: number; match_datetime: string
    team_home: string; team_away: string
    score_home: number | null; score_away: number | null
    phase: string; penalty_winner: string | null
  }[]
  const allBets = (betsRes.data ?? []) as {
    participant_id: string; match_id: string
    score_home: number; score_away: number; points: number | null
  }[]
  const allGroupBets = (groupBetsRes.data ?? []) as { participant_id: string; points: number | null }[]
  const allTBets     = (tournamentBetsRes.data ?? []) as {
    participant_id: string; champion: string; runner_up: string
    semi1: string; semi2: string; top_scorer: string
  }[]
  const scoresData = (scoresRes.data ?? []) as { participant_id: string; pts_thirds: number | null }[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Record<string, number> = Object.fromEntries((rulesRes.data ?? []).map((r: any) => [r.key, r.points]))
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Resultados do torneio (G4) ─────────────────────────────────────────────
  const completedMatches = matches.filter(m => m.score_home !== null)
  const pendingMatches   = matches.filter(m => m.score_home === null)

  const qfDone  = completedMatches.filter(m => m.phase === 'quarterfinal')
  const sfDone  = completedMatches.filter(m => m.phase === 'semifinal')
  const finDone = completedMatches.filter(m => m.phase === 'final')
  const tpDone  = completedMatches.filter(m => m.phase === 'third_place')

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

  // Zebra do campeão
  const chamBetsWithPick = allTBets.filter(b => b.champion && b.champion === champion)
  const chamBetsTotal    = allTBets.filter(b => b.champion).length
  const isZebraChampion  = chamBetsTotal > 0 && champion !== null
    && (chamBetsWithPick.length / chamBetsTotal) * 100 <= zebraThreshold

  // Pontos G4 + artilheiro por participante (calculados ao vivo)
  const ptsG4Map: Record<string, number> = {}
  for (const tb of allTBets) {
    ptsG4Map[tb.participant_id] = scoreTournamentBet(
      {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: tb.top_scorer ?? '',
      },
      tournamentResults,
      rules,
      isZebraChampion,
      scorerMapping,
    )
  }

  // ── Últimos/próximos jogos ─────────────────────────────────────────────────
  const lastMatch = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1] : null
  const nextMatch = pendingMatches.length > 0   ? pendingMatches[0] : null

  // ── Estatísticas por participante ──────────────────────────────────────────
  const ptsThirdsMap: Record<string, number> = Object.fromEntries(
    scoresData.map(s => [s.participant_id, s.pts_thirds ?? 0])
  )

  // Distribuição de resultados por jogo (para detectar apostas em possível zebra)
  const matchResultDist: Record<string, { H: number; D: number; A: number; total: number }> = {}
  for (const bet of allBets) {
    const d = matchResultDist[bet.match_id] ?? { H: 0, D: 0, A: 0, total: 0 }
    const r = getMatchResult(bet.score_home, bet.score_away)
    d[r]++; d.total++
    matchResultDist[bet.match_id] = d
  }

  // Mapa de resultado oficial por jogo
  const matchResultMap: Record<string, { score_home: number; score_away: number }> = {}
  for (const m of completedMatches)
    matchResultMap[m.id] = { score_home: m.score_home!, score_away: m.score_away! }

  // Zebra real por jogo
  const isZebraMatch: Record<string, boolean> = {}
  for (const m of completedMatches) {
    const actual = getMatchResult(m.score_home!, m.score_away!)
    isZebraMatch[m.id] = detectMatchZebra(
      (matchResultDist[m.id] ? Object.values(matchResultDist[m.id]).slice(0, 3) : []) as never,
      actual,
      zebraThreshold,
    )
    // Re-check usando a lista real de bets
    const betsForMatch = allBets.filter(b => b.match_id === m.id)
    isZebraMatch[m.id] = detectMatchZebra(betsForMatch, actual, zebraThreshold)
  }

  const ptsMatchesMap: Record<string, number> = {}
  const cravadosMap:   Record<string, number> = {}
  const pontuadosMap:  Record<string, number> = {}
  const zebraApostMap: Record<string, number> = {}
  const zebraPontMap:  Record<string, number> = {}
  const lastMatchBets: Record<string, { score_home: number; score_away: number }> = {}
  const nextMatchBets: Record<string, { score_home: number; score_away: number }> = {}

  for (const bet of allBets) {
    const pid = bet.participant_id
    const pts = bet.points ?? 0
    const official = matchResultMap[bet.match_id]

    if (official) {
      // Pontos e estatísticas de jogos encerrados
      ptsMatchesMap[pid] = (ptsMatchesMap[pid] ?? 0) + pts
      if (pts > 0) pontuadosMap[pid] = (pontuadosMap[pid] ?? 0) + 1
      if (bet.score_home === official.score_home && bet.score_away === official.score_away)
        cravadosMap[pid] = (cravadosMap[pid] ?? 0) + 1

      // 🦓 pontuada: acertou zebra real
      if (isZebraMatch[bet.match_id]) {
        const betRes = getMatchResult(bet.score_home, bet.score_away)
        const actRes = getMatchResult(official.score_home, official.score_away)
        if (betRes === actRes) zebraPontMap[pid] = (zebraPontMap[pid] ?? 0) + 1
      }
    }

    // 🦓 apostada: apostou em resultado minoritário (possível zebra) em qualquer jogo
    const dist = matchResultDist[bet.match_id]
    if (dist && dist.total > 0) {
      const betRes = getMatchResult(bet.score_home, bet.score_away)
      if ((dist[betRes] / dist.total) * 100 <= zebraThreshold)
        zebraApostMap[pid] = (zebraApostMap[pid] ?? 0) + 1
    }

    if (lastMatch && bet.match_id === lastMatch.id) lastMatchBets[pid] = bet
    if (nextMatch && bet.match_id === nextMatch.id) nextMatchBets[pid] = bet
  }

  const ptsGroupsMap: Record<string, number> = {}
  for (const bet of allGroupBets)
    ptsGroupsMap[bet.participant_id] = (ptsGroupsMap[bet.participant_id] ?? 0) + (bet.points ?? 0)

  // ── Montar linhas ──────────────────────────────────────────────────────────
  const tBetMap: Record<string, typeof allTBets[0]> = Object.fromEntries(allTBets.map(b => [b.participant_id, b]))

  const rows = participants.map(p => {
    const ptsMatches = ptsMatchesMap[p.id] ?? 0
    const ptsGroups  = ptsGroupsMap[p.id]  ?? 0
    const ptsThirds  = ptsThirdsMap[p.id]  ?? 0
    const ptsG4      = ptsG4Map[p.id]      ?? 0
    return {
      id: p.id,
      apelido: p.apelido,
      pts:        ptsMatches + ptsGroups + ptsThirds + ptsG4,
      ptsMatches,
      ptsClassif: ptsGroups + ptsThirds,
      ptsG4,
      cravados:       cravadosMap[p.id]    ?? 0,
      pontuados:      pontuadosMap[p.id]   ?? 0,
      zebraApostada:  zebraApostMap[p.id]  ?? 0,
      zebraPontuada:  zebraPontMap[p.id]   ?? 0,
      tournamentBet:  tBetMap[p.id] ?? null,
      lastMatchBet:   lastMatchBets[p.id]  ?? null,
      nextMatchBet:   nextMatchBets[p.id]  ?? null,
    }
  })

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
        premioSpots={premioSpots}
        activeParticipantId={activeParticipantId ?? ''}
        colVisibility={colVisibility}
        renderedAt={new Date().toISOString()}
      />
    </>
  )
}
