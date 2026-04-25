export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ClassificacaoMBClient } from './ClassificacaoMBClient'

export const metadata = {}

type MatchRow = {
  id: string
  match_number: number
  match_datetime: string
  team_home: string
  team_away: string
  score_home: number | null
  score_away: number | null
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

  const [participantsRes, scoresRes, tournamentBetsRes, matchesRes] = await Promise.all([
    supabase.from('participants').select('id, apelido').order('apelido'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
    supabase.from('matches')
      .select('id, match_number, match_datetime, team_home, team_away, score_home, score_away')
      .order('match_datetime', { ascending: true }),
  ])

  const matches = (matchesRes.data ?? []) as MatchRow[]

  // Último jogo com resultado + próximo sem resultado
  const completedMatches = matches.filter(m => m.score_home !== null)
  const pendingMatches   = matches.filter(m => m.score_home === null)
  const lastMatch  = completedMatches.length > 0 ? completedMatches[completedMatches.length - 1] : null
  const nextMatch  = pendingMatches.length  > 0 ? pendingMatches[0] : null

  // Apostas dos participantes nesses dois jogos
  const relevantIds = [lastMatch?.id, nextMatch?.id].filter(Boolean) as string[]
  let betsForMatches: { participant_id: string; match_id: string; score_home: number; score_away: number }[] = []
  if (relevantIds.length > 0) {
    const { data } = await admin
      .from('bets')
      .select('participant_id, match_id, score_home, score_away')
      .in('match_id', relevantIds)
    betsForMatches = data ?? []
  }

  // Abreviações de equipes
  let teamAbbrs: Record<string, string> = {}
  let eliminatedTeams: string[] = []
  let eliminatedStdScorers: string[] = []
  let scorerMapping: Record<string, string> = {}
  let prizeSpots = 8

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: teamsData } = await admin.from('teams').select('name, abbr_br, is_eliminated') as any
    if (teamsData) {
      for (const t of teamsData) {
        if (t.abbr_br) teamAbbrs[t.name] = t.abbr_br
        if (t.is_eliminated) eliminatedTeams.push(t.name)
      }
    }
  } catch { /* tabela ainda não criada */ }

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

  const scoresMap: Record<string, number> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scoresRes.data ?? []).map((r: any) => [r.participant_id, r.pts_total ?? 0])
  )
  const tournamentBetsMap: Record<string, {
    champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string
  }> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tournamentBetsRes.data ?? []).map((r: any) => [r.participant_id, r])
  )

  const lastMatchBets: Record<string, { score_home: number; score_away: number }> = {}
  const nextMatchBets: Record<string, { score_home: number; score_away: number }> = {}
  for (const bet of betsForMatches) {
    if (lastMatch && bet.match_id === lastMatch.id) lastMatchBets[bet.participant_id] = bet
    if (nextMatch && bet.match_id === nextMatch.id) nextMatchBets[bet.participant_id] = bet
  }

  const rows = (participantsRes.data ?? []).map((p: { id: string; apelido: string }) => ({
    id: p.id,
    apelido: p.apelido,
    pts: scoresMap[p.id] ?? 0,
    tournamentBet: tournamentBetsMap[p.id] ?? null,
    lastMatchBet:  lastMatchBets[p.id]  ?? null,
    nextMatchBet:  nextMatchBets[p.id]  ?? null,
  }))

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()

  return (
    <>
      <Navbar />
      <ClassificacaoMBClient
        rows={rows}
        lastMatch={lastMatch ? {
          id:        lastMatch.id,
          abbr_home: abbr(lastMatch.team_home),
          abbr_away: abbr(lastMatch.team_away),
        } : null}
        nextMatch={nextMatch ? {
          id:        nextMatch.id,
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
