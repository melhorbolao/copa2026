// Pure computation engine for the MB Comparador — no DB, no React.
// All functions are safe to call inside useMemo.

import { getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import type { MatchResult } from '@/lib/scoring/engine'
export type { MatchResult }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchInfo {
  id: string
  matchNumber: number
  phase: string
  groupName: string | null
  round: number | null
  teamHome: string
  teamAway: string
  flagHome: string
  flagAway: string
  matchDatetime: string
  bettingDeadline: string
  scoreHome: number | null
  scoreAway: number | null
  isBrazil: boolean
  isZebra: boolean   // pre-computed server-side from full bet distribution
}

export interface FlatBet {
  scoreHome: number
  scoreAway: number
  points: number | null
}

export interface ColPop {
  H: number   // absolute count
  D: number
  A: number
  total: number
}

export type DuelStatus =
  | 'same_score'      // ✅ Aposta Idêntica
  | 'same_column'     // ≈ Mesma Coluna, Placar Dif.
  | 'exact_vs_zero'   // 🎯 Cravou vs Zerou
  | 'zebra_vs_fav'    // ⚡ Zebra vs Favorito (played, diff col, zebra result)
  | 'diff_column'     // ↔ Colunas Diferentes
  | 'concordant'      // ○ Concordante (future, same col)
  | 'battlefield'     // ⚔ Campo de Batalha (future, diff col)
  | 'zebra_battle'    // ⚡ Duelo de Zebra (future, diff col, one on minority)
  | 'no_bets'         // — Sem palpites
  | 'hidden'          // prazo ainda aberto — bets not shown

export interface MatchDuelRow {
  match: MatchInfo
  betA: FlatBet | null
  betB: FlatBet | null
  colA: MatchResult | null
  colB: MatchResult | null
  realCol: MatchResult | null
  ptsA: number
  ptsB: number
  delta: number          // ptsA − ptsB (zero for future)
  status: DuelStatus
  aOnMinority: boolean   // A bet on the minority column (per colPopMap)
  bOnMinority: boolean
}

export interface DeltaBreakdown {
  // Totals (played only)
  ptsMatchesA: number
  ptsMatchesB: number
  delta: number

  // "Δ Cravadas": points A earned from exact scores − points B earned from exact scores
  exactPtsA: number
  exactPtsB: number
  deltaExact: number
  exactCountA: number
  exactCountB: number

  // "Δ Eficiência": points gained by getting the column right while opponent missed
  effPtsA: number
  effPtsB: number
  deltaEff: number

  // "Δ Bônus Zebra": all match points in games flagged as zebra
  zebraPtsA: number
  zebraPtsB: number
  deltaZebra: number
  zebraHitsA: number    // how many zebra matches A scored > 0
  zebraHitsB: number

  // Counts
  scoredA: number       // matches where A scored > 0
  scoredB: number
  battlefieldsPlayed: number
}

export interface ProjectionData {
  neutral:      MatchDuelRow[]   // same exact score — Δ always 0
  concordant:   MatchDuelRow[]   // same column, diff score (both bets visible)
  battlefields: MatchDuelRow[]
  onlyABet:     MatchDuelRow[]
  onlyBBet:     MatchDuelRow[]
  noBet:        MatchDuelRow[]
  maxSwingA: number    // max pts A can gain (battlefields + concordant exact bonus)
  maxSwingB: number    // max pts B can gain (risk for A)
}

export interface DuelBadges {
  reiCravadas:   'A' | 'B' | 'tie' | null
  cacadorZebras: 'A' | 'B' | 'tie' | null
  maisEficiente: 'A' | 'B' | 'tie' | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDeadlineOpen(deadline: string): boolean {
  return new Date(deadline).getTime() > Date.now()
}

function isMinority(pop: ColPop | undefined, col: MatchResult, threshold: number): boolean {
  if (!pop || pop.total === 0) return false
  return (pop[col] / pop.total) * 100 <= threshold
}

// Estimate "exact base pts" from stored points given brazil flag:
// We treat stored points ≥ placar_exato * multiplier as an exact score.
function isExactFromPoints(pts: number | null, isBrazil: boolean, rules: Record<string, number>): boolean {
  if (pts == null) return false
  const base     = rules['placar_exato']        ?? 12
  const mult     = isBrazil ? (rules['multiplicador_brasil'] ?? 2) : 1
  const zebraB   = rules['bonus_zebra_jogo']    ?? 6
  return pts >= Math.round(base * mult) || pts >= Math.round((base + zebraB) * mult)
}

// ── Core builder ─────────────────────────────────────────────────────────────

export function buildDuelMatrix(
  matches: MatchInfo[],
  betsA: Record<string, FlatBet>,    // matchId → FlatBet
  betsB: Record<string, FlatBet>,
  colPopMap: Record<string, ColPop>,
  zebraThreshold: number,
  rules: Record<string, number>,
  showFutureBets: boolean,           // false in production (deadline not passed)
): MatchDuelRow[] {
  return matches.map(m => {
    const betA   = betsA[m.id] ?? null
    const betB   = betsB[m.id] ?? null
    const played = m.scoreHome !== null && m.scoreAway !== null
    const realCol: MatchResult | null = played ? getMatchResult(m.scoreHome!, m.scoreAway!) : null

    const colA: MatchResult | null = betA ? getMatchResult(betA.scoreHome, betA.scoreAway) : null
    const colB: MatchResult | null = betB ? getMatchResult(betB.scoreHome, betB.scoreAway) : null

    const pop     = colPopMap[m.id]
    const aMin    = colA ? isMinority(pop, colA, zebraThreshold) : false
    const bMin    = colB ? isMinority(pop, colB, zebraThreshold) : false

    const ptsA = betA?.points ?? 0
    const ptsB = betB?.points ?? 0

    let status: DuelStatus

    if (!played) {
      const deadlineOpen = isDeadlineOpen(m.bettingDeadline)
      if (deadlineOpen && !showFutureBets) {
        status = 'hidden'
      } else if (!betA && !betB) {
        status = 'no_bets'
      } else if (colA && colB && colA === colB) {
        status = 'concordant'
      } else if (colA && colB && colA !== colB) {
        status = (aMin || bMin) ? 'zebra_battle' : 'battlefield'
      } else {
        // only one bet visible (other filtered or never bet) — not a concordance
        status = 'no_bets'
      }
    } else {
      if (!betA && !betB) {
        status = 'no_bets'
      } else if (!betA || !betB) {
        status = 'no_bets'
      } else if (betA.scoreHome === betB.scoreHome && betA.scoreAway === betB.scoreAway) {
        status = 'same_score'
      } else if (colA === colB) {
        status = 'same_column'
      } else {
        // diff column — played
        const aExact = isExactFromPoints(ptsA, m.isBrazil, rules)
        const bExact = isExactFromPoints(ptsB, m.isBrazil, rules)
        if ((aExact && ptsB === 0) || (bExact && ptsA === 0)) {
          status = 'exact_vs_zero'
        } else if (m.isZebra) {
          status = 'zebra_vs_fav'
        } else {
          status = 'diff_column'
        }
      }
    }

    return {
      match: m,
      betA,
      betB,
      colA,
      colB,
      realCol,
      ptsA: played ? ptsA : 0,
      ptsB: played ? ptsB : 0,
      delta: played ? ptsA - ptsB : 0,
      status,
      aOnMinority: aMin,
      bOnMinority: bMin,
    }
  })
}

// ── Breakdown ────────────────────────────────────────────────────────────────

export function computeBreakdown(
  rows: MatchDuelRow[],
  rules: Record<string, number>,
): DeltaBreakdown {
  let ptsMatchesA = 0, ptsMatchesB = 0
  let exactPtsA = 0, exactPtsB = 0
  let exactCountA = 0, exactCountB = 0
  let effPtsA = 0, effPtsB = 0
  let zebraPtsA = 0, zebraPtsB = 0
  let zebraHitsA = 0, zebraHitsB = 0
  let scoredA = 0, scoredB = 0
  let battlefieldsPlayed = 0

  for (const r of rows) {
    if (!r.match.scoreHome !== null ? false : r.match.scoreHome === null) continue
    if (r.match.scoreHome === null) continue  // not played

    ptsMatchesA += r.ptsA
    ptsMatchesB += r.ptsB

    const aExact = isExactFromPoints(r.betA?.points ?? null, r.match.isBrazil, rules)
    const bExact = isExactFromPoints(r.betB?.points ?? null, r.match.isBrazil, rules)

    if (aExact) { exactPtsA += r.ptsA; exactCountA++ }
    if (bExact) { exactPtsB += r.ptsB; exactCountB++ }

    // Efficiency: got column right, opponent missed
    if (r.colA === r.realCol && r.colB !== r.realCol && r.ptsA > 0) effPtsA += r.ptsA
    if (r.colB === r.realCol && r.colA !== r.realCol && r.ptsB > 0) effPtsB += r.ptsB

    // Zebra bonus context
    if (r.match.isZebra) {
      zebraPtsA += r.ptsA
      zebraPtsB += r.ptsB
      if (r.ptsA > 0) zebraHitsA++
      if (r.ptsB > 0) zebraHitsB++
    }

    if (r.ptsA > 0) scoredA++
    if (r.ptsB > 0) scoredB++
    if (r.colA !== r.colB && r.colA !== null && r.colB !== null) battlefieldsPlayed++
  }

  return {
    ptsMatchesA, ptsMatchesB,
    delta: ptsMatchesA - ptsMatchesB,
    exactPtsA, exactPtsB, deltaExact: exactPtsA - exactPtsB,
    exactCountA, exactCountB,
    effPtsA, effPtsB, deltaEff: effPtsA - effPtsB,
    zebraPtsA, zebraPtsB, deltaZebra: zebraPtsA - zebraPtsB,
    zebraHitsA, zebraHitsB,
    scoredA, scoredB,
    battlefieldsPlayed,
  }
}

// ── Projection ───────────────────────────────────────────────────────────────

export function computeProjection(
  rows: MatchDuelRow[],
  rules: Record<string, number>,
): ProjectionData {
  const future = rows.filter(r =>
    r.match.scoreHome === null && r.status !== 'hidden'
  )

  // Split concordant into neutral (identical score) and concordant (same col, diff score)
  const isNeutral = (r: MatchDuelRow) =>
    r.betA !== null && r.betB !== null &&
    r.betA.scoreHome === r.betB.scoreHome &&
    r.betA.scoreAway === r.betB.scoreAway
  const allConcordant = future.filter(r => r.status === 'concordant')
  const neutral     = allConcordant.filter(isNeutral)
  const concordant  = allConcordant.filter(r => !isNeutral(r))

  const battlefields = future.filter(r => r.status === 'battlefield' || r.status === 'zebra_battle')
  const onlyABet    = future.filter(r => r.betA && !r.betB)
  const onlyBBet    = future.filter(r => r.betB && !r.betA)
  const noBet       = future.filter(r => !r.betA && !r.betB && r.status !== 'concordant' && r.status !== 'battlefield' && r.status !== 'zebra_battle')

  // Max pts a given side can score in a battlefield (includes zebra bonus only if on minority)
  const rowMaxPts = (r: MatchDuelRow, onMinority: boolean) => {
    const base  = rules['placar_exato']     ?? 12
    const zebra = rules['bonus_zebra_jogo'] ?? 6
    const mult  = r.match.isBrazil ? (rules['multiplicador_brasil'] ?? 2) : 1
    return Math.round((base + (onMinority ? zebra : 0)) * mult)
  }

  // Exact Δ for a concordant row: one gets placar_exato, the other scores
  // whatever their specific bet would earn against the exact result.
  // isZebra=false because the zebra bonus would apply equally to both (same col).
  const rowConcordantPts = (r: MatchDuelRow): { forA: number; forB: number } => {
    if (!r.betA || !r.betB) return { forA: 0, forB: 0 }
    const mult     = r.match.isBrazil ? (rules['multiplicador_brasil'] ?? 2) : 1
    const exactPts = Math.round((rules['placar_exato'] ?? 12) * mult)
    const bScore   = scoreMatchBet(r.betB.scoreHome, r.betB.scoreAway, r.betA.scoreHome, r.betA.scoreAway, false, r.match.isBrazil, rules)
    const aScore   = scoreMatchBet(r.betA.scoreHome, r.betA.scoreAway, r.betB.scoreHome, r.betB.scoreAway, false, r.match.isBrazil, rules)
    return { forA: exactPts - bScore, forB: exactPts - aScore }
  }
  const concordantContribA = concordant.reduce((sum, r) => sum + rowConcordantPts(r).forA, 0)
  const concordantContribB = concordant.reduce((sum, r) => sum + rowConcordantPts(r).forB, 0)

  const maxSwingA = battlefields.reduce((sum, r) => sum + rowMaxPts(r, r.aOnMinority), 0) + concordantContribA
  const maxSwingB = battlefields.reduce((sum, r) => sum + rowMaxPts(r, r.bOnMinority), 0) + concordantContribB

  return { neutral, concordant, battlefields, onlyABet, onlyBBet, noBet, maxSwingA, maxSwingB }
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function computeBadges(bd: DeltaBreakdown): DuelBadges {
  const reiCravadas: DuelBadges['reiCravadas'] =
    bd.exactCountA > bd.exactCountB ? 'A' :
    bd.exactCountB > bd.exactCountA ? 'B' :
    bd.exactCountA > 0 ? 'tie' : null

  const cacadorZebras: DuelBadges['cacadorZebras'] =
    bd.zebraHitsA > bd.zebraHitsB ? 'A' :
    bd.zebraHitsB > bd.zebraHitsA ? 'B' :
    bd.zebraHitsA > 0 ? 'tie' : null

  const maisEficiente: DuelBadges['maisEficiente'] =
    bd.effPtsA > bd.effPtsB ? 'A' :
    bd.effPtsB > bd.effPtsA ? 'B' :
    bd.effPtsA > 0 ? 'tie' : null

  return { reiCravadas, cacadorZebras, maisEficiente }
}

// ── Status display helpers ────────────────────────────────────────────────────

export const STATUS_LABEL: Record<DuelStatus, string> = {
  same_score:    'Aposta Idêntica',
  same_column:   'Mesma Coluna',
  exact_vs_zero: 'Cravou vs Zerou',
  zebra_vs_fav:  'Zebra vs Favorito',
  diff_column:   'Colunas Diferentes',
  concordant:    'Concordante',
  battlefield:   'Batalha',
  zebra_battle:  'Batalha Zebra',
  no_bets:       'Sem palpites',
  hidden:        'A fazer',
}

export const STATUS_ICON: Record<DuelStatus, string> = {
  same_score:    '✅',
  same_column:   '≈',
  exact_vs_zero: '🎯',
  zebra_vs_fav:  '⚡',
  diff_column:   '↔',
  concordant:    '🤝',
  battlefield:   '⚔️',
  zebra_battle:  '⚡',
  no_bets:       '—',
  hidden:        '○',
}
