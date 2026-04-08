import type { MatchPhase } from '@/types/database'

export interface MatchDeadlineRow {
  id: string
  match_number: number
  phase: MatchPhase
  round: number | null
  team_home: string
  team_away: string
  betting_deadline: string
  match_datetime: string
}

export interface PhaseGroup {
  /** Identificador único do bloco (ex: "group_1", "round_of_32") */
  key: string
  label: string
  phase: MatchPhase
  /** Para rodadas da fase de grupos: 1, 2 ou 3. null para as demais fases. */
  groupRound: number | null
  matches: MatchDeadlineRow[]
  sharedDeadline: string | null
  minDeadline: string
  maxDeadline: string
}
