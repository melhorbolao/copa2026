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
