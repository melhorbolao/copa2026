export * from './database'

// ── Tipos de domínio adicionais ───────────────────────────────────────────────

export interface RankingEntry {
  user_id: string
  name: string
  total_points: number
  games_scored: number
  exact_scores: number  // "cravadas"
  bonus_points: number
  position: number
  tied: boolean
}

export interface MatchWithBet {
  match: import('./database').MatchRow
  userBet?: import('./database').BetRow
  deadline_passed: boolean
}

export interface GroupStanding {
  group_name: string
  teams: {
    team: string
    flag: string
    played: number
    won: number
    drawn: number
    lost: number
    goals_for: number
    goals_against: number
    points: number
  }[]
}
