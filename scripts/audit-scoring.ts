// Auditoria geral de pontuação — SOMENTE LEITURA, nenhuma escrita no banco.
// Recalcula tudo do zero a partir dos dados brutos (matches + bets) usando
// as MESMAS funções puras do motor real (src/lib/scoring/engine.ts e
// src/lib/bracket/engine.ts), e compara com o que está gravado no banco.
//
// Uso: npx tsx scripts/audit-scoring.ts

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import {
  calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap,
  type MatchSlim, type BetSlim, type KnockoutTeamOverride,
} from '../src/lib/bracket/engine'
import {
  scoreMatchBet, scoreGroupBet, scoreTournamentBetBreakdown,
  detectMatchZebra, detectGroupZebra, detectG4ZebraTeams, getMatchResult,
  type RuleMap, type TournamentResults,
} from '../src/lib/scoring/engine'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '../.env.local')
const envContent = fs.readFileSync(envPath, 'utf-8')
const env: Record<string, string> = {}
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── pagination helper (max-rows=1000 do PostgREST) ────────────────────────────
async function fetchAll<T>(table: string, select: string, orderCol = 'id'): Promise<T[]> {
  const PAGE = 1000
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase.from(table).select(select).order(orderCol, { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...(data as T[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

type Discrepancy = { kind: string; detail: string }
const discrepancies: Discrepancy[] = []
const log = (s: string) => console.log(s)

async function main() {
  log('== Auditoria geral de pontuação — bolão Copa 2026 ==\n')

  // ── 1. Carrega dados brutos ────────────────────────────────────────────────
  const rulesRows = await fetchAll<{ key: string; points: number }>('scoring_rules', 'key, points')
  const rules: RuleMap = Object.fromEntries(rulesRows.map(r => [r.key, r.points]))
  log(`Regras de pontuação carregadas: ${rulesRows.length}`)

  const matches = await fetchAll<any>('matches', 'id, match_number, phase, group_name, team_home, team_away, flag_home, flag_away, score_home, score_away, penalty_winner, is_brazil', 'match_number')
  log(`Partidas: ${matches.length}`)

  const participants = await fetchAll<any>('participants', 'id, apelido, paid')
  log(`Participantes: ${participants.length}`)

  const bets = await fetchAll<any>('bets', 'id, participant_id, match_id, score_home, score_away, points')
  const groupBets = await fetchAll<any>('group_bets', 'id, participant_id, group_name, first_place, second_place, points')
  const thirdBets = await fetchAll<any>('third_place_bets', 'id, participant_id, group_name, team, points')
  const tournamentBets = await fetchAll<any>('tournament_bets', 'id, participant_id, champion, runner_up, semi1, semi2, top_scorer, points')
  const participantScores = await fetchAll<any>('participant_scores', 'participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament, pts_total', 'participant_id')
  log(`bets: ${bets.length} | group_bets: ${groupBets.length} | third_place_bets: ${thirdBets.length} | tournament_bets: ${tournamentBets.length} | participant_scores: ${participantScores.length}\n`)

  const { data: scorerSetting } = await supabase.from('tournament_settings').select('value').eq('key', 'official_top_scorer').maybeSingle()
  let officialScorers: string[] = []
  if (scorerSetting?.value) {
    try { officialScorers = JSON.parse(scorerSetting.value) } catch { officialScorers = [scorerSetting.value] }
  }
  const mappingRows = await fetchAll<any>('top_scorer_mapping', 'raw_name, standardized_name', 'raw_name')
  const scorerMapping: Record<string, string> = Object.fromEntries(mappingRows.map((m: any) => [m.raw_name.toLowerCase().trim(), m.standardized_name]))
  log(`Artilheiro(s) oficial(is): ${JSON.stringify(officialScorers)}`)

  // ── 2. Reconstrói o chaveamento (mesma lógica de buildBracketMaps) ────────
  const groupMatches = matches.filter(m => m.phase === 'group')
  const slimGroup: MatchSlim[] = groupMatches.map(m => ({ id: m.id, group_name: m.group_name, phase: m.phase, team_home: m.team_home, team_away: m.team_away, flag_home: m.flag_home, flag_away: m.flag_away }))
  const betMapOfficial = new Map<string, BetSlim>()
  const byGroup = new Map<string, { total: number; scored: number }>()
  for (const m of groupMatches) {
    if (m.score_home !== null && m.score_away !== null) betMapOfficial.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
    if (m.group_name) {
      const e = byGroup.get(m.group_name) ?? { total: 0, scored: 0 }
      e.total++
      if (m.score_home !== null && m.score_away !== null) e.scored++
      byGroup.set(m.group_name, e)
    }
  }
  const completeGroups = new Set<string>()
  for (const [g, { total, scored }] of byGroup) if (total > 0 && scored === total) completeGroups.add(g)
  const allGroupsComplete = byGroup.size > 0 && completeGroups.size === byGroup.size
  log(`Grupos completos: ${completeGroups.size}/${byGroup.size} (allGroupsComplete=${allGroupsComplete})`)

  const standings = calcGroupStandings(slimGroup, betMapOfficial)
  const thirds = rankThirds(standings)
  const thirdSlots = resolveThirdSlots(thirds)
  const r32Slots = buildR32Teams(standings, thirds, thirdSlots, undefined, completeGroups, allGroupsComplete)
  const knockoutMatchesForMap = matches.filter(m => ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase))
  const derivedTeamMap: Map<string, KnockoutTeamOverride> = buildKnockoutTeamMap(r32Slots, knockoutMatchesForMap)

  const isBrazilMap = new Map<string, boolean>()
  for (const m of matches) {
    const ov = derivedTeamMap.get(m.id)
    const effHome = ov?.team_home || m.team_home
    const effAway = ov?.team_away || m.team_away
    isBrazilMap.set(m.id, m.is_brazil || effHome === 'Brasil' || effAway === 'Brasil')
  }

  // ── 3. Recalcula bets de partidas (jogo a jogo) ────────────────────────────
  log('\n--- Conferência: pontos de PARTIDAS (bets) ---')
  const betsByMatch = new Map<string, any[]>()
  for (const b of bets) {
    if (!betsByMatch.has(b.match_id)) betsByMatch.set(b.match_id, [])
    betsByMatch.get(b.match_id)!.push(b)
  }

  let matchBetMismatches = 0
  let sumStoredMatchPts = 0
  let sumComputedMatchPts = 0
  const scoredMatches = matches.filter(m => m.score_home !== null && m.score_away !== null)

  for (const m of matches) {
    const matchBets = betsByMatch.get(m.id) ?? []
    if (m.score_home === null || m.score_away === null) {
      for (const b of matchBets) {
        if (b.points !== null) {
          discrepancies.push({ kind: 'match-residual-points', detail: `Jogo #${m.match_number} (${m.team_home} x ${m.team_away}) sem placar mas bet ${b.id} (participant ${b.participant_id}) tem points=${b.points}` })
        }
      }
      continue
    }
    const actualResult = getMatchResult(m.score_home, m.score_away)
    const threshold = rules['percentual_zebra'] ?? 15
    const isZebra = detectMatchZebra(matchBets.map(b => ({ score_home: b.score_home, score_away: b.score_away })), actualResult, threshold)
    const isBrazil = isBrazilMap.get(m.id) ?? (m.is_brazil || m.team_home === 'Brasil' || m.team_away === 'Brasil')

    for (const b of matchBets) {
      const expected = scoreMatchBet(b.score_home, b.score_away, m.score_home, m.score_away, isZebra, isBrazil, rules)
      const stored = b.points ?? 0
      sumStoredMatchPts += stored
      sumComputedMatchPts += expected
      if (expected !== stored) {
        matchBetMismatches++
        discrepancies.push({ kind: 'match-bet-mismatch', detail: `Jogo #${m.match_number} (${m.team_home} x ${m.team_away}, placar ${m.score_home}x${m.score_away}, zebra=${isZebra}, brasil=${isBrazil}) — bet ${b.id} participant ${b.participant_id}: palpite ${b.score_home}x${b.score_away} → esperado ${expected}, gravado ${b.points}` })
      }
    }
  }
  log(`Jogos com placar lançado: ${scoredMatches.length}/${matches.length}`)
  log(`Apostas de placar conferidas: ${bets.length}`)
  log(`Divergências em pontos de partida: ${matchBetMismatches}`)
  log(`Soma pontos de partida — gravado: ${sumStoredMatchPts} | recalculado: ${sumComputedMatchPts} | diff: ${sumStoredMatchPts - sumComputedMatchPts}`)

  // ── 4. Recalcula group_bets ─────────────────────────────────────────────────
  log('\n--- Conferência: pontos de GRUPO (group_bets) ---')
  let groupBetMismatches = 0
  let sumStoredGroupPts = 0
  let sumComputedGroupPts = 0
  const groupNames = [...new Set(groupMatches.map(m => m.group_name))].filter(Boolean).sort()

  for (const groupName of groupNames) {
    const gMatches = groupMatches.filter(m => m.group_name === groupName)
    const allScored = gMatches.every(m => m.score_home !== null && m.score_away !== null)
    const gBets = groupBets.filter(b => b.group_name === groupName)
    if (!allScored) {
      for (const b of gBets) {
        if (b.points !== null) discrepancies.push({ kind: 'group-residual-points', detail: `Grupo ${groupName} incompleto mas group_bet ${b.id} tem points=${b.points}` })
      }
      continue
    }
    const groupStanding = standings.find(s => s.group === groupName)
    if (!groupStanding || groupStanding.teams.length < 2) continue
    const actual1st = groupStanding.teams[0].team
    const actual2nd = groupStanding.teams[1].team
    const threshold = rules['percentual_zebra'] ?? 15
    const isZebra1 = detectGroupZebra(gBets.map(b => ({ first_place: b.first_place })), actual1st, threshold)

    for (const b of gBets) {
      const expected = scoreGroupBet(b.first_place, b.second_place, actual1st, actual2nd, isZebra1, rules)
      const stored = b.points ?? 0
      sumStoredGroupPts += stored
      sumComputedGroupPts += expected
      if (expected !== stored) {
        groupBetMismatches++
        discrepancies.push({ kind: 'group-bet-mismatch', detail: `Grupo ${groupName} (1º=${actual1st}, 2º=${actual2nd}, zebra1=${isZebra1}) — group_bet ${b.id} participant ${b.participant_id}: palpite 1º=${b.first_place}/2º=${b.second_place} → esperado ${expected}, gravado ${b.points}` })
      }
    }
  }
  log(`Grupos conferidos: ${groupNames.length}`)
  log(`Apostas de grupo conferidas: ${groupBets.length}`)
  log(`Divergências em pontos de grupo: ${groupBetMismatches}`)
  log(`Soma pontos de grupo — gravado: ${sumStoredGroupPts} | recalculado: ${sumComputedGroupPts} | diff: ${sumStoredGroupPts - sumComputedGroupPts}`)

  // ── 5. Recalcula third_place_bets ───────────────────────────────────────────
  log('\n--- Conferência: pontos de 3º COLOCADO (third_place_bets) ---')
  let thirdBetMismatches = 0
  let sumStoredThirdPts = 0
  let sumComputedThirdPts = 0

  if (!allGroupsComplete) {
    for (const b of thirdBets) {
      if (b.points !== 0 && b.points !== null) discrepancies.push({ kind: 'third-residual-points', detail: `Fase de grupos incompleta mas third_place_bet ${b.id} tem points=${b.points}` })
    }
    log('Fase de grupos incompleta — todos os pontos de 3º deveriam ser 0.')
  } else {
    const actualThirdByGroup = new Map<string, string>(thirds.filter(t => t.advances).map(t => [t.group, t.team]))
    const thirdPts = rules['terceiro_classificado'] ?? 3
    for (const b of thirdBets) {
      const actualThird = actualThirdByGroup.get(b.group_name)
      const expected = (actualThird && actualThird === b.team) ? thirdPts : 0
      const stored = b.points ?? 0
      sumStoredThirdPts += stored
      sumComputedThirdPts += expected
      if (expected !== stored) {
        thirdBetMismatches++
        discrepancies.push({ kind: 'third-bet-mismatch', detail: `Grupo ${b.group_name} (3º real=${actualThird}) — third_place_bet ${b.id} participant ${b.participant_id}: palpite=${b.team} → esperado ${expected}, gravado ${b.points}` })
      }
    }
  }
  log(`Apostas de 3º colocado conferidas: ${thirdBets.length}`)
  log(`Divergências em pontos de 3º: ${thirdBetMismatches}`)
  log(`Soma pontos de 3º — gravado: ${sumStoredThirdPts} | recalculado: ${sumComputedThirdPts} | diff: ${sumStoredThirdPts - sumComputedThirdPts}`)

  // ── 6. Recalcula tournament_bets (G4 + artilheiro) ─────────────────────────
  log('\n--- Conferência: pontos de TORNEIO (tournament_bets: campeão/vice/semis/artilheiro) ---')
  const knockoutMatches = matches.filter(m => ['quarterfinal', 'semifinal', 'third_place', 'final'].includes(m.phase)).sort((a, b) => a.match_number - b.match_number)
  const resolveTeams = (m: any) => {
    const ov = derivedTeamMap.get(m.id)
    return { home: ov?.team_home || m.team_home, away: ov?.team_away || m.team_away }
  }
  const matchWinner = (m: any, home: string, away: string): string | null => {
    if (m.score_home === null || m.score_away === null) return null
    if (m.score_home > m.score_away) return home
    if (m.score_away > m.score_home) return away
    return m.penalty_winner ?? null
  }
  const results: TournamentResults = { semifinalists: [], finalists: [], champion: null, runnerUp: null, third: null, fourth: null, officialScorers }
  for (const m of knockoutMatches.filter(m => m.phase === 'quarterfinal')) {
    const { home, away } = resolveTeams(m)
    const w = matchWinner(m, home, away)
    if (w) results.semifinalists.push(w)
  }
  for (const m of knockoutMatches.filter(m => m.phase === 'semifinal')) {
    const { home, away } = resolveTeams(m)
    const w = matchWinner(m, home, away)
    if (w) results.finalists.push(w)
  }
  const thirdMatch = knockoutMatches.find(m => m.phase === 'third_place')
  if (thirdMatch) {
    const { home, away } = resolveTeams(thirdMatch)
    const w = matchWinner(thirdMatch, home, away)
    results.third = w
    results.fourth = w ? (w === home ? away : home) : null
  }
  const finalMatch = knockoutMatches.find(m => m.phase === 'final')
  if (finalMatch) {
    const { home, away } = resolveTeams(finalMatch)
    const w = matchWinner(finalMatch, home, away)
    results.champion = w
    results.runnerUp = w ? (w === home ? away : home) : null
  }
  log(`Semifinalistas (QF winners): ${JSON.stringify(results.semifinalists)}`)
  log(`Finalistas (SF winners): ${JSON.stringify(results.finalists)}`)
  log(`Campeão: ${results.champion} | Vice: ${results.runnerUp} | 3º: ${results.third} | 4º: ${results.fourth}`)

  const threshold = rules['percentual_zebra'] ?? 15
  const zebraTeams = detectG4ZebraTeams(tournamentBets.map(b => ({ champion: b.champion ?? '', runner_up: b.runner_up ?? '', semi1: b.semi1 ?? '', semi2: b.semi2 ?? '' })), threshold)
  log(`Times "zebra" no G4 (<=${threshold}% indicaram): ${JSON.stringify([...zebraTeams])}`)

  let tournamentBetMismatches = 0
  let sumStoredTournamentPts = 0
  let sumComputedTournamentPts = 0
  const tournamentBreakdownTotals = { champion: 0, runner_up: 0, semi1: 0, semi2: 0, top_scorer: 0 }

  for (const b of tournamentBets) {
    const breakdown = scoreTournamentBetBreakdown({ champion: b.champion, runner_up: b.runner_up, semi1: b.semi1, semi2: b.semi2, top_scorer: b.top_scorer }, results, rules, zebraTeams, scorerMapping)
    const expected = breakdown.champion + breakdown.runner_up + breakdown.semi1 + breakdown.semi2 + breakdown.top_scorer
    tournamentBreakdownTotals.champion += breakdown.champion
    tournamentBreakdownTotals.runner_up += breakdown.runner_up
    tournamentBreakdownTotals.semi1 += breakdown.semi1
    tournamentBreakdownTotals.semi2 += breakdown.semi2
    tournamentBreakdownTotals.top_scorer += breakdown.top_scorer
    const stored = b.points ?? 0
    sumStoredTournamentPts += stored
    sumComputedTournamentPts += expected
    if (expected !== stored) {
      tournamentBetMismatches++
      discrepancies.push({ kind: 'tournament-bet-mismatch', detail: `tournament_bet ${b.id} participant ${b.participant_id}: campeão=${b.champion}/vice=${b.runner_up}/semi1=${b.semi1}/semi2=${b.semi2}/artilheiro=${b.top_scorer} → esperado ${expected} (breakdown ${JSON.stringify(breakdown)}), gravado ${b.points}` })
    }
  }
  log(`Apostas de torneio conferidas: ${tournamentBets.length}`)
  log(`Divergências em pontos de torneio: ${tournamentBetMismatches}`)
  log(`Soma pontos de torneio — gravado: ${sumStoredTournamentPts} | recalculado: ${sumComputedTournamentPts} | diff: ${sumStoredTournamentPts - sumComputedTournamentPts}`)
  log(`Breakdown recalculado (soma de todos os participantes): ${JSON.stringify(tournamentBreakdownTotals)}`)

  // ── 7. Confere participant_scores (totais agregados) ───────────────────────
  log('\n--- Conferência: TOTAIS por participante (participant_scores) ---')
  const sumByParticipant = (rows: any[], pid: string) => rows.filter(r => r.participant_id === pid).reduce((acc, r) => acc + (r.points ?? 0), 0)

  let participantMismatches = 0
  let sumStoredTotal = 0
  let sumComputedTotal = 0
  const psMap = new Map(participantScores.map((p: any) => [p.participant_id, p]))

  for (const p of participants) {
    const computedMatches = sumByParticipant(bets, p.id)
    const computedGroups = sumByParticipant(groupBets, p.id)
    const computedThirds = sumByParticipant(thirdBets, p.id)
    const computedTournament = tournamentBets.find(b => b.participant_id === p.id)?.points ?? 0
    const computedTotal = computedMatches + computedGroups + computedThirds + computedTournament

    const stored = psMap.get(p.id)
    const storedTotal = stored?.pts_total ?? 0
    sumStoredTotal += storedTotal
    sumComputedTotal += computedTotal

    if (!stored) {
      participantMismatches++
      discrepancies.push({ kind: 'participant-scores-missing', detail: `Participante ${p.apelido} (${p.id}) não tem linha em participant_scores (deveria ter total ${computedTotal})` })
      continue
    }
    const fields: [string, number, number][] = [
      ['pts_matches', stored.pts_matches, computedMatches],
      ['pts_groups', stored.pts_groups, computedGroups],
      ['pts_thirds', stored.pts_thirds, computedThirds],
      ['pts_tournament', stored.pts_tournament, computedTournament],
      ['pts_total', stored.pts_total, computedTotal],
    ]
    let hasMismatch = false
    for (const [field, storedVal, computedVal] of fields) {
      if (storedVal !== computedVal) {
        hasMismatch = true
        discrepancies.push({ kind: 'participant-scores-mismatch', detail: `Participante ${p.apelido} (${p.id}) — ${field}: gravado ${storedVal}, recalculado da soma dos bets ${computedVal} (diff ${storedVal - computedVal})` })
      }
    }
    if (hasMismatch) participantMismatches++
  }
  log(`Participantes conferidos: ${participants.length}`)
  log(`Participantes com divergência de total: ${participantMismatches}`)
  log(`Soma GERAL pts_total (gravado): ${sumStoredTotal}`)
  log(`Soma GERAL pts_total (recalculado a partir dos bets): ${sumComputedTotal}`)
  log(`Diferença: ${sumStoredTotal - sumComputedTotal}`)

  // ── 8. Soma geral por categoria (consistência interna) ─────────────────────
  log('\n--- Soma GERAL de pontos por categoria (todos os participantes) ---')
  log(`Partidas    — gravado: ${sumStoredMatchPts.toLocaleString('pt-BR')} | recalculado: ${sumComputedMatchPts.toLocaleString('pt-BR')}`)
  log(`Grupos      — gravado: ${sumStoredGroupPts.toLocaleString('pt-BR')} | recalculado: ${sumComputedGroupPts.toLocaleString('pt-BR')}`)
  log(`3º colocado — gravado: ${sumStoredThirdPts.toLocaleString('pt-BR')} | recalculado: ${sumComputedThirdPts.toLocaleString('pt-BR')}`)
  log(`Torneio(G4) — gravado: ${sumStoredTournamentPts.toLocaleString('pt-BR')} | recalculado: ${sumComputedTournamentPts.toLocaleString('pt-BR')}`)
  const grandTotalStored = sumStoredMatchPts + sumStoredGroupPts + sumStoredThirdPts + sumStoredTournamentPts
  const grandTotalComputed = sumComputedMatchPts + sumComputedGroupPts + sumComputedThirdPts + sumComputedTournamentPts
  log(`TOTAL GERAL — gravado: ${grandTotalStored.toLocaleString('pt-BR')} | recalculado: ${grandTotalComputed.toLocaleString('pt-BR')} | diff: ${grandTotalStored - grandTotalComputed}`)
  log(`(confere com soma de participant_scores.pts_total gravado: ${sumStoredTotal.toLocaleString('pt-BR')})`)

  // ── 9. Sanity checks extras ─────────────────────────────────────────────────
  log('\n--- Checagens extras ---')
  const participantIds = new Set(participants.map(p => p.id))
  const orphanBets = bets.filter(b => !participantIds.has(b.participant_id))
  if (orphanBets.length) discrepancies.push({ kind: 'orphan-bets', detail: `${orphanBets.length} bets com participant_id que não existe em participants` })
  log(`Bets órfãos (participant_id inexistente): ${orphanBets.length}`)

  const tbParticipantIds = new Set(tournamentBets.map(b => b.participant_id))
  const missingTournamentBet = participants.filter(p => !tbParticipantIds.has(p.id))
  if (missingTournamentBet.length) log(`Participantes SEM aposta de torneio: ${missingTournamentBet.length} (${missingTournamentBet.map(p => p.apelido).join(', ')})`)

  const negativeTotals = participantScores.filter((p: any) => p.pts_total < 0)
  if (negativeTotals.length) discrepancies.push({ kind: 'negative-total', detail: `${negativeTotals.length} participantes com pts_total negativo` })

  const betKeySeen = new Map<string, number>()
  for (const b of bets) {
    const k = `${b.participant_id}::${b.match_id}`
    betKeySeen.set(k, (betKeySeen.get(k) ?? 0) + 1)
  }
  const dupBets = [...betKeySeen.entries()].filter(([, c]) => c > 1)
  if (dupBets.length) discrepancies.push({ kind: 'duplicate-bets', detail: `${dupBets.length} pares (participante,jogo) com apostas duplicadas` })
  log(`Apostas duplicadas (mesmo participante+jogo): ${dupBets.length}`)

  // ── 10. Resultado final ─────────────────────────────────────────────────────
  log('\n\n========================================')
  log('           RESULTADO DA AUDITORIA')
  log('========================================')
  if (discrepancies.length === 0) {
    log('NENHUMA DIVERGÊNCIA ENCONTRADA. Todos os pontos batem com o recálculo a partir dos dados brutos.')
  } else {
    log(`${discrepancies.length} divergência(s) encontrada(s):\n`)
    const byKind = new Map<string, Discrepancy[]>()
    for (const d of discrepancies) {
      if (!byKind.has(d.kind)) byKind.set(d.kind, [])
      byKind.get(d.kind)!.push(d)
    }
    for (const [kind, items] of byKind) {
      log(`\n[${kind}] — ${items.length} ocorrência(s)`)
      for (const it of items.slice(0, 50)) log(`  - ${it.detail}`)
      if (items.length > 50) log(`  ... e mais ${items.length - 50}`)
    }
  }

  const outPath = path.resolve(__dirname, '../audit-report.json')
  fs.writeFileSync(outPath, JSON.stringify({ discrepancies, summary: {
    sumStoredMatchPts, sumComputedMatchPts, sumStoredGroupPts, sumComputedGroupPts,
    sumStoredThirdPts, sumComputedThirdPts, sumStoredTournamentPts, sumComputedTournamentPts,
    grandTotalStored, grandTotalComputed, sumStoredTotal, sumComputedTotal,
  } }, null, 2))
  log(`\nRelatório completo salvo em: ${outPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
