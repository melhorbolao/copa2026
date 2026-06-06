export interface ZebraScorer {
  participantId: string
  apelido: string
  position: number | null
  isExact: boolean
  pts: number
}

export interface ZebraMatch {
  id: string
  matchNumber: number
  teamHome: string
  teamAway: string
  flagHome: string
  flagAway: string
  scoreHome: number
  scoreAway: number
  actualResult: 'H' | 'A' | 'D'
  matchDatetime: string
  totalBets: number
  homeCount: number
  drawCount: number
  awayCount: number
  scorers: ZebraScorer[]
}

export interface ZebraRankingEntry {
  participantId: string
  apelido: string
  position: number | null
  cravadas: number
  colunas: number
  pts: number
}

export interface PotentialUpset {
  id: string
  teamHome: string
  teamAway: string
  flagHome: string
  flagAway: string
  matchDatetime: string
  phase: string
  groupName: string | null
  round: number | null
  city: string | null
  homePct: number
  drawPct: number
  awayPct: number
  zebraColumns: ('H' | 'D' | 'A')[]
}

export interface PotentialGroupZebra {
  groupName: string
  teamName: string
  flagCode: string
  pct: number
  count: number
  total: number
}

export interface PotentialG4Zebra {
  teamName: string
  flagCode: string
  pct: number   // % de bets G4 que incluem este time em qualquer posição
  count: number // quantos participantes apostaram neste time em qualquer posição G4
  total: number // total de bets G4
}
