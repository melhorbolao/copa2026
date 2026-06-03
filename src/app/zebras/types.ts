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
  slot: 'champion' | 'runner_up' | 'semi'
  teamName: string
  flagCode: string
  pct: number
  count: number
  total: number
}
