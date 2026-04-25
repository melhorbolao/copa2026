// Pure scoring functions — no DB calls, mirrors the logic in ScoreSimulator / GroupSimulator exactly.

export type RuleMap = Record<string, number>
export type MatchResult = 'H' | 'A' | 'D'

export function getMatchResult(scoreHome: number, scoreAway: number): MatchResult {
  if (scoreHome > scoreAway) return 'H'
  if (scoreAway > scoreHome) return 'A'
  return 'D'
}

// ── Match scoring ─────────────────────────────────────────────────────────────
// Mirrors calcSimulator() from ScoreSimulator.tsx, plus Brazil multiplier.

export function scoreMatchBet(
  betHome: number,
  betAway: number,
  realHome: number,
  realAway: number,
  isZebra: boolean,
  isBrazil: boolean,
  rules: RuleMap,
): number {
  const betResult  = Math.sign(betHome  - betAway)
  const realResult = Math.sign(realHome - realAway)

  let base = 0

  if (betHome === realHome && betAway === realAway) {
    base = rules['placar_exato'] ?? 12
  } else if (betResult !== realResult) {
    base = 0
  } else if (betResult === 0) {
    base = rules['empate_gols_errados'] ?? 7
  } else {
    const winnerBet  = betResult  > 0 ? betHome  : betAway
    const winnerReal = realResult > 0 ? realHome  : realAway
    const loserBet   = betResult  > 0 ? betAway  : betHome
    const loserReal  = realResult > 0 ? realAway  : realHome

    if (winnerBet === winnerReal) {
      base = rules['vencedor_gols_vencedor'] ?? 6
    } else if ((betHome - betAway) === (realHome - realAway)) {
      base = rules['vencedor_diferenca_gols'] ?? 5
    } else if (loserBet === loserReal) {
      base = rules['vencedor_gols_perdedor'] ?? 5
    } else {
      base = rules['somente_vencedor'] ?? 4
    }
  }

  const zebraBonus = (isZebra && base > 0) ? (rules['bonus_zebra_jogo'] ?? 6) : 0
  const total      = base + zebraBonus
  const multiplier = isBrazil ? (rules['multiplicador_brasil'] ?? 2) : 1

  return Math.round(total * multiplier)
}

export function detectMatchZebra(
  bets: Array<{ score_home: number; score_away: number }>,
  actualResult: MatchResult,
  threshold: number,
): boolean {
  if (bets.length === 0) return false
  const winning = bets.filter(b => getMatchResult(b.score_home, b.score_away) === actualResult).length
  return (winning / bets.length) * 100 <= threshold
}

// ── Group scoring ─────────────────────────────────────────────────────────────
// Mirrors calcGroupPoints() from GroupSimulator.tsx (top-2 only; thirds scored separately).

export function scoreGroupBet(
  betFirst: string,
  betSecond: string,
  actualFirst: string,
  actualSecond: string,
  isZebra1: boolean,
  rules: RuleMap,
): number {
  const exactOrder = betFirst === actualFirst && betSecond === actualSecond
  const inverted   = betFirst === actualSecond && betSecond === actualFirst
  const only1st    = betFirst === actualFirst && betSecond !== actualSecond && betSecond !== actualFirst
  const only2nd    = betSecond === actualSecond && betFirst !== actualFirst && betFirst !== actualSecond
  const oneInTop2  =
    !exactOrder && !inverted &&
    (betFirst === actualSecond || betSecond === actualFirst) &&
    !( betFirst === actualFirst) && !(betSecond === actualSecond)

  let pts = 0
  const first1stCorrect = exactOrder || only1st

  if      (exactOrder) pts = rules['grupo_ordem_certa']     ?? 16
  else if (inverted)   pts = rules['grupo_ordem_invertida'] ?? 10
  else if (only1st)    pts = rules['grupo_primeiro_certo']  ?? 8
  else if (only2nd)    pts = rules['grupo_segundo_certo']   ?? 6
  else if (oneInTop2)  pts = rules['grupo_um_dos_dois']     ?? 3

  const zebraBonus = (isZebra1 && first1stCorrect) ? (rules['bonus_zebra_grupo_1'] ?? 6) : 0
  return pts + zebraBonus
}

export function detectGroupZebra(
  groupBets: Array<{ first_place: string }>,
  actualFirst: string,
  threshold: number,
): boolean {
  if (groupBets.length === 0) return false
  const matching = groupBets.filter(b => b.first_place === actualFirst).length
  return (matching / groupBets.length) * 100 <= threshold
}

// ── Tournament (G4 + artilheiro) scoring ─────────────────────────────────────
// Progressive and cumulative per the regulation:
//   champion pick:  semifinalista + bonus_finalista + bonus_campeao (if all correct)
//   runner_up pick: semifinalista + bonus_finalista + bonus_vice (if all correct)
//   semi1/semi2:    semifinalista + bonus_terceiro or bonus_quarto

export interface TournamentResults {
  semifinalists: string[]   // 4 QF winners
  finalists:     string[]   // 2 SF winners
  champion:      string | null
  runnerUp:      string | null
  third:         string | null  // winner of 3rd-place match
  fourth:        string | null  // loser of 3rd-place match
  officialScorers: string[]     // standardized name(s)
}

export interface TournamentBetBreakdown {
  champion:   number
  runner_up:  number
  semi1:      number
  semi2:      number
  top_scorer: number
}

export function scoreTournamentBetBreakdown(
  bet: { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string },
  results: TournamentResults,
  rules: RuleMap,
  isZebraChampion: boolean,
  scorerMapping: Record<string, string>,
): TournamentBetBreakdown {
  const r = {
    semis:    rules['semifinalista']   ?? 4,
    finalist: rules['bonus_finalista'] ?? 8,
    campeao:  rules['bonus_campeao']   ?? 12,
    vice:     rules['bonus_vice']      ?? 8,
    terceiro: rules['bonus_terceiro']  ?? 6,
    quarto:   rules['bonus_quarto']    ?? 4,
    zebraG4:  rules['bonus_zebra_g4']  ?? 0,
    artilh:   rules['artilheiro']      ?? 18,
  }

  let champion = 0
  if (bet.champion) {
    if (results.semifinalists.includes(bet.champion)) champion += r.semis
    if (results.finalists.includes(bet.champion))     champion += r.finalist
    if (results.champion === bet.champion) {
      champion += r.campeao
      if (isZebraChampion) champion += r.zebraG4
    }
  }

  let runner_up = 0
  if (bet.runner_up) {
    if (results.semifinalists.includes(bet.runner_up)) runner_up += r.semis
    if (results.finalists.includes(bet.runner_up))     runner_up += r.finalist
    if (results.runnerUp === bet.runner_up)             runner_up += r.vice
  }

  let semi1 = 0
  if (bet.semi1) {
    if (results.semifinalists.includes(bet.semi1)) semi1 += r.semis
    if (results.third  === bet.semi1)              semi1 += r.terceiro
    else if (results.fourth === bet.semi1)         semi1 += r.quarto
  }

  let semi2 = 0
  if (bet.semi2) {
    if (results.semifinalists.includes(bet.semi2)) semi2 += r.semis
    if (results.third  === bet.semi2)              semi2 += r.terceiro
    else if (results.fourth === bet.semi2)         semi2 += r.quarto
  }

  let top_scorer = 0
  if (bet.top_scorer && results.officialScorers.length > 0) {
    const normalized = (scorerMapping[bet.top_scorer] ?? bet.top_scorer).trim().toLowerCase()
    const isCorrect  = results.officialScorers.some(s => s.trim().toLowerCase() === normalized)
    if (isCorrect) top_scorer += r.artilh
  }

  return { champion, runner_up, semi1, semi2, top_scorer }
}

export function scoreTournamentBet(
  bet: { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string },
  results: TournamentResults,
  rules: RuleMap,
  isZebraChampion: boolean,
  // scorerMapping: raw_name → standardized_name (pass {} if not needed)
  scorerMapping: Record<string, string>,
): number {
  const b = scoreTournamentBetBreakdown(bet, results, rules, isZebraChampion, scorerMapping)
  return b.champion + b.runner_up + b.semi1 + b.semi2 + b.top_scorer
}
