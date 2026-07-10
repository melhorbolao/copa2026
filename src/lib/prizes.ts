// Fonte única da distribuição de premiação — usada pela página Premiação e pela
// Classificação (coluna Prêmio). Ver Regulamento, item 9 e item 33.

export const ENTRY_FEE = 250

export const PRIZE_DIST: { place: string; pct: number }[] = [
  { place: '1º',  pct: 55.0 },
  { place: '2º',  pct: 15.0 },
  { place: '3º',  pct:  9.0 },
  { place: '4º',  pct:  6.0 },
  { place: '5º',  pct:  5.0 },
  { place: '6º',  pct:  3.0 },
  { place: '7º',  pct:  2.5 },
  { place: '8º',  pct:  2.0 },
  { place: '9º',  pct:  1.5 },
  { place: '10º', pct:  1.0 },
]

export function brl(value: number, opts?: { cents?: boolean }): string {
  const cents = opts?.cents ?? true
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(value)
}

export function calcTotalPrize(paidCount: number): number {
  return paidCount * ENTRY_FEE
}

/** Valor em R$ de cada posição premiada — índice 0 = 1º lugar. Posições sem faixa definida em PRIZE_DIST valem 0. */
export function getPrizeAmounts(paidCount: number, premioSpots: number): number[] {
  const totalPrize = calcTotalPrize(paidCount)
  return Array.from({ length: premioSpots }, (_, i) => totalPrize * (PRIZE_DIST[i]?.pct ?? 0) / 100)
}

/**
 * Rateio de prêmio em caso de empate (Regulamento item 33): soma-se o prêmio das
 * posições ocupadas pelo grupo empatado e divide-se igualmente entre eles.
 * `rank` é a colocação (1-indexed) e `tieCount` quantos participantes a compartilham.
 * Retorna 0 se a colocação estiver fora da zona de premiação.
 */
export function prizeForTiedRank(prizeAmounts: number[], rank: number, tieCount: number): number {
  if (rank > prizeAmounts.length) return 0
  let sum = 0
  for (let slot = rank; slot < rank + tieCount; slot++) sum += prizeAmounts[slot - 1] ?? 0
  return sum / tieCount
}
