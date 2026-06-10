export const dynamic = 'force-dynamic'

import { Fragment } from 'react'
import { redirect } from 'next/navigation'
import { Navbar } from '@/components/layout/Navbar'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { getActiveParticipantId } from '@/lib/participant'
import { getServerNow } from '@/lib/production-mode'
import { ImportButton } from './ImportButton'
import {
  scoreMatchBet, scoreGroupBet, scoreTournamentBet,
  detectMatchZebra, detectGroupZebra, getMatchResult,
  type RuleMap, type TournamentResults,
} from '@/lib/scoring/engine'
import { calcGroupStandings, rankThirds } from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'

// ── Types ─────────────────────────────────────────────────────────────────────

type AIPalpites = {
  matches:           Record<string, { score_home: number; score_away: number }>
  group_bets:        Record<string, { first_place: string; second_place: string }>
  third_place_bets:  Record<string, string>
  tournament_bet:    { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string } | null
}

type AiModel = {
  id: string; model_name: string; model_version: string | null; sort_order: number; palpites: AIPalpites
}

type Match = {
  id: string; match_number: number; phase: string; round: number | null; group_name: string | null
  team_home: string; team_away: string; match_datetime: string
  score_home: number | null; score_away: number | null; is_brazil: boolean; betting_deadline: string
}

type RealBet        = { match_id: string; score_home: number; score_away: number }
type RealGroupBet   = { group_name: string; first_place: string }
type RealTournamentBet = { champion: string }

type MyBet          = { match_id: string; score_home: number; score_away: number }
type MyGroupBet     = { group_name: string; first_place: string; second_place: string }
type MyThirdBet     = { group_name: string; team: string }
type MyTournamentBet = { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

type MatchResult = { pts: number; exact: boolean; correct: boolean; betHome: number; betAway: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRealBets(admin: any): Promise<RealBet[]> {
  const PAGE = 1000
  const rows: RealBet[] = []
  let from = 0
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from('bets').select('match_id, score_home, score_away').range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

function calcAiScore(
  model: AiModel,
  matches: Match[],
  realBetsByMatch: Map<string, RealBet[]>,
  realGroupBets: RealGroupBet[],
  realTournamentBets: RealTournamentBet[],
  rules: RuleMap,
  knockoutMatches: Match[],
  scorerMapping: Record<string, string>,
): {
  total: number; matchPts: number; groupPts: number; thirdPts: number; tournamentPts: number
  perMatch: Record<string, MatchResult>
} {
  let matchPts = 0, groupPts = 0, thirdPts = 0, tournamentPts = 0
  const perMatch: Record<string, MatchResult> = {}
  const threshold = rules['percentual_zebra'] ?? 15

  for (const match of matches) {
    if (match.score_home === null || match.score_away === null) continue
    const aiBet = model.palpites.matches[match.id]
    if (!aiBet) continue
    const actualResult = getMatchResult(match.score_home, match.score_away)
    const matchBets    = realBetsByMatch.get(match.id) ?? []
    const isZebra      = detectMatchZebra(matchBets, actualResult, threshold)
    const pts          = scoreMatchBet(aiBet.score_home, aiBet.score_away, match.score_home, match.score_away, isZebra, match.is_brazil, rules)
    const betResult    = getMatchResult(aiBet.score_home, aiBet.score_away)
    perMatch[match.id] = { pts, exact: aiBet.score_home === match.score_home && aiBet.score_away === match.score_away, correct: betResult === actualResult, betHome: aiBet.score_home, betAway: aiBet.score_away }
    matchPts += pts
  }

  const groupMatches   = matches.filter(m => m.phase === 'group')
  const allGroupScored = groupMatches.length > 0 && groupMatches.every(m => m.score_home !== null && m.score_away !== null)

  if (allGroupScored) {
    const slimMatches: MatchSlim[] = groupMatches.map(m => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away, flag_home: '', flag_away: '',
    }))
    const resultMap = new Map<string, BetSlim>(
      groupMatches.map(m => [m.id, { match_id: m.id, score_home: m.score_home!, score_away: m.score_away! }])
    )
    const standings = calcGroupStandings(slimMatches, resultMap)
    for (const standing of standings) {
      if (standing.teams.length < 2) continue
      const actual1st  = standing.teams[0].team
      const actual2nd  = standing.teams[1].team
      const aiGroupBet = model.palpites.group_bets[standing.group]
      if (!aiGroupBet) continue
      const grpBets  = realGroupBets.filter(b => b.group_name === standing.group)
      const isZebra1 = detectGroupZebra(grpBets.map(b => ({ first_place: b.first_place })), actual1st, threshold)
      groupPts += scoreGroupBet(aiGroupBet.first_place, aiGroupBet.second_place, actual1st, actual2nd, isZebra1, rules)
    }
    const thirds      = rankThirds(standings)
    const thirdPtsRule = rules['terceiro_classificado'] ?? 3
    for (const [groupName, team] of Object.entries(model.palpites.third_place_bets)) {
      const actual = thirds.find(t => t.group === groupName)
      if (actual?.advances && actual.team === team) thirdPts += thirdPtsRule
    }
  }

  if (model.palpites.tournament_bet && knockoutMatches.length > 0) {
    const results: TournamentResults = {
      semifinalists: [], finalists: [], champion: null, runnerUp: null, third: null, fourth: null, officialScorers: [],
    }
    const winner = (m: Match): string | null => {
      if (m.score_home === null || m.score_away === null) return null
      if (m.score_home > m.score_away) return m.team_home
      if (m.score_away > m.score_home) return m.team_away
      return null
    }
    for (const m of knockoutMatches.filter(m => m.phase === 'quarterfinal')) { const w = winner(m); if (w) results.semifinalists.push(w) }
    for (const m of knockoutMatches.filter(m => m.phase === 'semifinal'))    { const w = winner(m); if (w) results.finalists.push(w) }
    const thirdMatch = knockoutMatches.find(m => m.phase === 'third_place')
    if (thirdMatch) {
      results.third  = winner(thirdMatch)
      const w = winner(thirdMatch)
      results.fourth = w ? (w === thirdMatch.team_home ? thirdMatch.team_away : thirdMatch.team_home) : null
    }
    const finalMatch = knockoutMatches.find(m => m.phase === 'final')
    if (finalMatch) {
      results.champion = winner(finalMatch)
      const w = winner(finalMatch)
      results.runnerUp = w ? (w === finalMatch.team_home ? finalMatch.team_away : finalMatch.team_home) : null
    }
    if (results.champion) {
      const isZebraChampion = realTournamentBets.length > 0 &&
        (realTournamentBets.filter(b => b.champion === results.champion).length / realTournamentBets.length) * 100 <= threshold
      tournamentPts = scoreTournamentBet(model.palpites.tournament_bet, results, rules, isZebraChampion, scorerMapping)
    }
  }

  return { total: matchPts + groupPts + thirdPts + tournamentPts, matchPts, groupPts, thirdPts, tournamentPts, perMatch }
}

const PHASE_LABELS: Record<string, string> = {
  group: 'Fase de Grupos', round_of_32: 'Rodada de 32',
  round_of_16: 'Oitavas de Final', quarterfinal: 'Quartas de Final',
  semifinal: 'Semifinal', third_place: 'Disputa de 3º Lugar', final: 'Final',
}

const PHASE_ORDER = ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final']

const G4_ROWS: { key: keyof NonNullable<AIPalpites['tournament_bet']>; label: string }[] = [
  { key: 'champion',   label: 'Campeão' },
  { key: 'runner_up',  label: 'Vice-Campeão' },
  { key: 'semi1',      label: '3º Lugar' },
  { key: 'semi2',      label: '4º Lugar' },
  { key: 'top_scorer', label: 'Artilheiro' },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function IaNoMbPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('iaMb', isAdmin)

  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllGroupBets(): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from('group_bets').select('group_name, first_place').range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [
    aiRes,
    matchesRes,
    rulesRes,
    scoresRes,
    groupBetsRes,
    trnBetsRes,
    scorerMappingRes,
    allRealBets,
    myBetsRes,
    myGroupBetsRes,
    myThirdBetsRes,
    myTournamentBetRes,
    myParticipantRes,
    totalParticipantsRes,
  ] = await Promise.all([
    admin.from('ai_models_performance').select('id, model_name, model_version, sort_order, palpites').order('sort_order'),
    supabase.from('matches').select('id, match_number, phase, round, group_name, team_home, team_away, match_datetime, score_home, score_away, is_brazil, betting_deadline').order('match_datetime', { ascending: true }),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('participant_scores').select('pts_total').limit(10000),
    fetchAllGroupBets(),
    admin.from('tournament_bets').select('champion').limit(10000),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    fetchAllRealBets(admin),
    participantId
      ? supabase.from('bets').select('match_id, score_home, score_away').eq('participant_id', participantId).limit(1000)
      : Promise.resolve({ data: [] }),
    participantId
      ? supabase.from('group_bets').select('group_name, first_place, second_place').eq('participant_id', participantId)
      : Promise.resolve({ data: [] }),
    participantId
      ? supabase.from('third_place_bets').select('group_name, team').eq('participant_id', participantId)
      : Promise.resolve({ data: [] }),
    participantId
      ? supabase.from('tournament_bets').select('champion, runner_up, semi1, semi2, top_scorer').eq('participant_id', participantId).maybeSingle()
      : Promise.resolve({ data: null }),
    participantId
      ? supabase.from('participants').select('apelido').eq('id', participantId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('participants').select('id', { count: 'exact', head: true }),
  ])

  const serverNow = await getServerNow()
  const isPastDeadline = (deadline: string) => new Date(deadline) <= serverNow

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiModels: AiModel[]  = (aiRes.data ?? []) as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: Match[]     = (matchesRes.data ?? []) as any[]
  const rules: RuleMap       = Object.fromEntries((rulesRes.data ?? []).map((r: { key: string; points: number }) => [r.key, r.points]))
  const allParticipantTotals = (scoresRes.data ?? []).map((s: { pts_total: number | null }) => s.pts_total ?? 0)
  const totalParticipants   = (totalParticipantsRes as { count: number | null }).count ?? allParticipantTotals.length
  const hasRealScores       = allParticipantTotals.some((p: number) => p > 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realGroupBets: RealGroupBet[]       = groupBetsRes as any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const realTournamentBets: RealTournamentBet[] = (trnBetsRes.data ?? []) as any[]

  const scorerMapping: Record<string, string> = {}
  for (const row of (scorerMappingRes.data ?? []) as { raw_name: string; standardized_name: string | null }[]) {
    if (row.standardized_name) scorerMapping[row.raw_name.toLowerCase().trim()] = row.standardized_name
  }
  const normalizeScorer = (name: string) => scorerMapping[name.toLowerCase().trim()] ?? name

  const myBets: MyBet[]        = (myBetsRes.data ?? []) as MyBet[]
  const myGroupBets: MyGroupBet[] = (myGroupBetsRes.data ?? []) as MyGroupBet[]
  const myThirdBets: MyThirdBet[] = (myThirdBetsRes.data ?? []) as MyThirdBet[]
  const myTournamentBet: MyTournamentBet | null = myTournamentBetRes.data as MyTournamentBet | null
  const myApelido: string = (myParticipantRes.data as { apelido?: string } | null)?.apelido ?? 'Você'

  const myBetMap      = new Map(myBets.map(b => [b.match_id, b]))
  const myGroupBetMap = new Map(myGroupBets.map(b => [b.group_name, b]))
  const myThirdBetMap = new Map(myThirdBets.map(b => [b.group_name, b.team]))

  // Palpites de torneio (G4, grupos) ficam visíveis após o primeiro prazo da rodada 1
  const tournamentStarted = matches.some(m => isPastDeadline(m.betting_deadline))

  const knockoutPhases  = new Set(['quarterfinal', 'semifinal', 'third_place', 'final'])
  const knockoutMatches = matches.filter(m => knockoutPhases.has(m.phase))

  const realBetsByMatch = new Map<string, RealBet[]>()
  for (const bet of allRealBets) {
    const arr = realBetsByMatch.get(bet.match_id) ?? []
    arr.push(bet)
    realBetsByMatch.set(bet.match_id, arr)
  }

  type AiScored = AiModel & { score: ReturnType<typeof calcAiScore> }
  const aiScored: AiScored[] = aiModels.map(model => ({
    ...model,
    score: calcAiScore(model, matches, realBetsByMatch, realGroupBets, realTournamentBets, rules, knockoutMatches, scorerMapping),
  }))

  const aiRanked = [...aiScored].sort((a, b) => b.score.total - a.score.total)

  function humanRankPosition(aiTotal: number): number {
    return allParticipantTotals.filter((p: number) => p > aiTotal).length + 1
  }

  let divergeAgree = 0, divergeTotal = 0
  for (const match of matches) {
    if (!isAdmin && !isPastDeadline(match.betting_deadline)) continue
    const bets = aiModels.map(m => m.palpites.matches[match.id]).filter(Boolean)
    if (bets.length < 2) continue
    divergeTotal++
    const results = bets.map(b => getMatchResult(b!.score_home, b!.score_away))
    if (results.every(r => r === results[0])) divergeAgree++
  }
  const divergeDisagree = divergeTotal - divergeAgree
  const agreePct    = divergeTotal > 0 ? Math.round((divergeAgree / divergeTotal) * 100) : 0
  const disagreePct = divergeTotal > 0 ? Math.round((divergeDisagree / divergeTotal) * 100) : 0

  const matchesByPhase: Record<string, Match[]> = {}
  for (const m of matches) {
    matchesByPhase[m.phase] = [...(matchesByPhase[m.phase] ?? []), m]
  }
  const orderedPhases = PHASE_ORDER.filter(p => matchesByPhase[p]?.length > 0)

  // Group names sorted from the matches data
  const groupNames = [...new Set(
    matches.filter(m => m.group_name).map(m => m.group_name!)
  )].sort()

  const aiShortNames: Record<string, string> = {
    'Claude Opus 4.7 Adaptativo (pago)': 'Claude',
    'Gemini Pro Estendido (pago)':        'Gemini',
    'ChatGPT Plus Thinking (pago)':       'ChatGPT',
    'Grok Fast (gratuito)':               'Grok',
  }

  // Total number of columns: Aposta + Você (if participantId) + AIs
  const showYou = !!participantId
  const totalCols = 1 + (showYou ? 1 : 0) + aiScored.length

  // Helper: cell class for a match bet vs actual result
  function matchCellClass(betHome: number, betAway: number, match: Match): string {
    if (match.score_home === null || match.score_away === null) return 'text-white/70'
    if (betHome === match.score_home && betAway === match.score_away) return 'text-verde-400 font-bold'
    if (getMatchResult(betHome, betAway) === getMatchResult(match.score_home, match.score_away)) return 'text-amarelo-400 font-semibold'
    return 'text-white/30'
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-azul-navy px-4 py-6 sm:px-8">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">🤖 IA no MB</h1>
            <p className="mt-1 text-sm text-white/60">
              Benchmarking de modelos de IA — não são participantes oficiais
            </p>
          </div>
          {false && isAdmin && <ImportButton />}
        </div>

        {aiModels.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-azul-dark p-8 text-center">
            <p className="text-white/60">Nenhum dado encontrado.</p>
          </div>
        ) : (
          <>
            {/* ── Ranking Cards ──────────────────────────────────────────────── */}
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">
                Ranking de Performance
              </h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {aiRanked.map((ai, rankIdx) => {
                  const pos = humanRankPosition(ai.score.total)
                  return (
                    <div key={ai.id} className="relative rounded-xl border border-white/10 bg-azul-dark p-4">
                      {rankIdx === 0 && <span className="absolute right-3 top-3 text-lg">🥇</span>}
                      {rankIdx === 1 && <span className="absolute right-3 top-3 text-lg">🥈</span>}
                      {rankIdx === 2 && <span className="absolute right-3 top-3 text-lg">🥉</span>}
                      <p className="text-[11px] font-semibold leading-tight text-white/60">{ai.model_name}</p>
                      {ai.model_version && <p className="mt-0.5 text-[10px] text-white/30">{ai.model_version}</p>}
                      <div className="mt-3">
                        <span className="text-3xl font-extrabold text-ouro">{ai.score.total}</span>
                        <span className="ml-1 text-sm text-white/40">pts</span>
                      </div>
                      <div className="mt-3 flex flex-col gap-1 text-[10px] text-white/40">
                        <span>🎯 Jogos: <span className="text-white/70">{ai.score.matchPts} pts</span></span>
                        <span>📊 Grupos: <span className="text-white/70">{ai.score.groupPts} pts</span></span>
                        <span>🏆 G4+Art: <span className="text-white/70">{ai.score.tournamentPts} pts</span></span>
                      </div>
                      {hasRealScores && totalParticipants > 0 ? (
                        <div className="mt-3 rounded-lg bg-azul-mid px-2 py-1.5 text-center">
                          <p className="text-[10px] text-white/50">se fosse humano</p>
                          <p className="text-xs font-bold text-amarelo-400">{pos}ª posição de {totalParticipants}</p>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg bg-azul-mid px-2 py-1.5 text-center">
                          <p className="text-[10px] text-white/40">aguardando resultados</p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* ── Divergence Stats ───────────────────────────────────────────── */}
            {divergeTotal > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">
                  Estatística de Divergência
                </h2>
                <div className="rounded-xl border border-white/10 bg-azul-dark p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="text-sm text-white/60">
                      Total analisado: <span className="font-bold text-white">{divergeTotal} jogos</span>
                    </span>
                    <span className="text-sm text-verde-600">
                      ✓ Concordaram no desfecho: <span className="font-bold">{divergeAgree} ({agreePct}%)</span>
                    </span>
                    <span className="text-sm text-amarelo-400">
                      ✗ Divergiram: <span className="font-bold">{divergeDisagree} ({disagreePct}%)</span>
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-azul-mid">
                    <div className="h-full rounded-full bg-verde-600 transition-all" style={{ width: `${agreePct}%` }} />
                  </div>
                  <p className="mt-3 text-xs text-white/40">
                    Compara apenas quem vence ou se há empate — não o placar exato. Quando todas as IAs concordam, preste mais atenção.
                  </p>
                </div>
              </section>
            )}

            {/* ── G4 + Artilheiro ────────────────────────────────────────────── */}
            <section className="mb-8">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">
                G4 + Artilheiro
              </h2>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-azul-dark">
                      <th className="px-3 py-2.5 text-left font-semibold text-white/60">Aposta</th>
                      {showYou && (
                        <th className="px-3 py-2.5 text-center font-semibold text-white">
                          {myApelido}
                        </th>
                      )}
                      {aiScored.map(ai => (
                        <th key={ai.id} className="px-3 py-2.5 text-center font-semibold text-amarelo-400">
                          {aiShortNames[ai.model_name] ?? ai.model_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {G4_ROWS.map(({ key, label }, idx) => (
                      <tr key={key} className={`border-b border-white/5 ${idx % 2 === 0 ? 'bg-azul-dark' : 'bg-azul-mid/20'}`}>
                        <td className="px-3 py-2 font-semibold text-white/60">{label}</td>
                        {showYou && (
                          <td className="px-3 py-2 text-center text-white/80">
                            {myTournamentBet?.[key]
                              ? (key === 'top_scorer' ? normalizeScorer(myTournamentBet[key]) : myTournamentBet[key])
                              : <span className="text-white/20">—</span>}
                          </td>
                        )}
                        {aiScored.map(ai => {
                          if (!isAdmin && !tournamentStarted) {
                            return <td key={ai.id} className="px-3 py-2 text-center text-white/20">—</td>
                          }
                          const raw = ai.palpites.tournament_bet?.[key]
                          const val = raw && key === 'top_scorer' ? normalizeScorer(raw) : raw
                          return (
                            <td key={ai.id} className="px-3 py-2 text-center text-white/70">
                              {val || <span className="text-white/20">—</span>}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── Classificação de Grupos ────────────────────────────────────── */}
            {groupNames.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">
                  Classificação de Grupos
                </h2>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-azul-dark">
                        <th className="px-3 py-2.5 text-left font-semibold text-white/60">Aposta</th>
                        {showYou && (
                          <th className="px-3 py-2.5 text-center font-semibold text-white">
                            {myApelido}
                          </th>
                        )}
                        {aiScored.map(ai => (
                          <th key={ai.id} className="px-3 py-2.5 text-center font-semibold text-amarelo-400">
                            {aiShortNames[ai.model_name] ?? ai.model_name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groupNames.map((group, gIdx) => (
                        <Fragment key={group}>
                          {/* Phase-like header row per group */}
                          <tr className="border-b border-white/5 bg-azul-mid/40">
                            <td
                              colSpan={totalCols}
                              className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/40"
                            >
                              Grupo {group}
                            </td>
                          </tr>

                          {/* 1º lugar */}
                          <tr className={`border-b border-white/5 ${gIdx % 2 === 0 ? 'bg-azul-dark' : 'bg-azul-mid/20'}`}>
                            <td className="px-3 py-2 text-white/50">1º lugar</td>
                            {showYou && (
                              <td className="px-3 py-2 text-center text-white/80">
                                {myGroupBetMap.get(group)?.first_place || <span className="text-white/20">—</span>}
                              </td>
                            )}
                            {aiScored.map(ai => (
                              <td key={ai.id} className="px-3 py-2 text-center text-white/70">
                                {(!isAdmin && !tournamentStarted) ? <span className="text-white/20">—</span> : (ai.palpites.group_bets[group]?.first_place || <span className="text-white/20">—</span>)}
                              </td>
                            ))}
                          </tr>

                          {/* 2º lugar */}
                          <tr className={`border-b border-white/5 ${gIdx % 2 === 0 ? 'bg-azul-dark' : 'bg-azul-mid/20'}`}>
                            <td className="px-3 py-2 text-white/50">2º lugar</td>
                            {showYou && (
                              <td className="px-3 py-2 text-center text-white/80">
                                {myGroupBetMap.get(group)?.second_place || <span className="text-white/20">—</span>}
                              </td>
                            )}
                            {aiScored.map(ai => (
                              <td key={ai.id} className="px-3 py-2 text-center text-white/70">
                                {(!isAdmin && !tournamentStarted) ? <span className="text-white/20">—</span> : (ai.palpites.group_bets[group]?.second_place || <span className="text-white/20">—</span>)}
                              </td>
                            ))}
                          </tr>

                          {/* 3º avança */}
                          <tr className={`border-b border-white/5 ${gIdx % 2 === 0 ? 'bg-azul-dark' : 'bg-azul-mid/20'}`}>
                            <td className="px-3 py-2 text-white/50">3º avança</td>
                            {showYou && (
                              <td className="px-3 py-2 text-center text-white/80">
                                {myThirdBetMap.get(group) || <span className="text-white/20">—</span>}
                              </td>
                            )}
                            {aiScored.map(ai => (
                              <td key={ai.id} className="px-3 py-2 text-center text-white/70">
                                {(!isAdmin && !tournamentStarted) ? <span className="text-white/20">—</span> : (ai.palpites.third_place_bets[group] || <span className="text-white/20">—</span>)}
                              </td>
                            ))}
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ── Tabelão das Máquinas ───────────────────────────────────────── */}
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">
                O Tabelão das Máquinas
              </h2>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-azul-dark">
                      <th className="sticky left-0 z-10 bg-azul-dark px-3 py-2.5 text-left font-semibold text-white/60">
                        Jogo
                      </th>
                      {showYou && (
                        <th className="px-3 py-2.5 text-center font-semibold text-white">
                          {myApelido}
                        </th>
                      )}
                      {aiScored.map(ai => (
                        <th key={ai.id} className="px-3 py-2.5 text-center font-semibold text-amarelo-400">
                          {aiShortNames[ai.model_name] ?? ai.model_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orderedPhases.map(phase => (
                      <Fragment key={phase}>
                        <tr className="border-b border-white/5 bg-azul-mid/40">
                          <td
                            colSpan={totalCols}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40"
                          >
                            {PHASE_LABELS[phase] ?? phase}
                          </td>
                        </tr>

                        {(matchesByPhase[phase] ?? []).map((match, idx) => {
                          const hasResult = match.score_home !== null && match.score_away !== null
                          const isOdd     = idx % 2 === 0
                          const myBet     = myBetMap.get(match.id)

                          return (
                            <tr
                              key={match.id}
                              className={`border-b border-white/5 ${isOdd ? 'bg-azul-dark' : 'bg-azul-mid/20'}`}
                            >
                              <td className="sticky left-0 z-10 min-w-[180px] px-3 py-2.5" style={{ backgroundColor: isOdd ? '#001133' : '#001930' }}>
                                <div className="flex flex-col gap-0.5">
                                  <span className="font-semibold text-white">
                                    {match.team_home} <span className="text-white/30">vs</span> {match.team_away}
                                  </span>
                                  {hasResult ? (
                                    <span className="text-[10px] font-bold text-verde-600">
                                      {match.score_home}–{match.score_away}
                                      {match.phase === 'group' && match.round != null && (
                                        <span className="ml-1 font-normal text-white/30">R{match.round}</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-white/30">
                                      {new Date(match.match_datetime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Participant bet */}
                              {showYou && (
                                <td className="px-3 py-2.5 text-center">
                                  {myBet ? (
                                    <span className={matchCellClass(myBet.score_home, myBet.score_away, match)}>
                                      {myBet.score_home}–{myBet.score_away}
                                    </span>
                                  ) : (
                                    <span className="text-white/20">—</span>
                                  )}
                                </td>
                              )}

                              {/* AI bets */}
                              {aiScored.map(ai => {
                                if (!isAdmin && !isPastDeadline(match.betting_deadline)) {
                                  return <td key={ai.id} className="px-3 py-2.5 text-center text-white/20">—</td>
                                }
                                const aiBet = ai.palpites.matches[match.id]
                                const res   = ai.score.perMatch[match.id]
                                if (!aiBet) {
                                  return <td key={ai.id} className="px-3 py-2.5 text-center text-white/20">—</td>
                                }
                                let cellClass = 'text-white/70'
                                if (hasResult && res) {
                                  if (res.exact)        cellClass = 'text-verde-400 font-bold'
                                  else if (res.correct) cellClass = 'text-amarelo-400 font-semibold'
                                  else if (res.pts > 0) cellClass = 'text-amarelo-600'
                                  else                  cellClass = 'text-white/30'
                                }
                                return (
                                  <td key={ai.id} className="px-3 py-2.5 text-center">
                                    <span className={cellClass}>{aiBet.score_home}–{aiBet.score_away}</span>
                                    {hasResult && res && res.pts > 0 && (
                                      <span className="ml-1 text-[9px] text-white/40">+{res.pts}</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[10px] text-white/40">
                <span><span className="font-bold text-verde-400">2–1</span> Placar exato</span>
                <span><span className="font-semibold text-amarelo-400">2–1</span> Resultado certo</span>
                <span><span className="text-white/30">2–1</span> Resultado errado</span>
                <span>+N pts acumulados no placar</span>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  )
}
