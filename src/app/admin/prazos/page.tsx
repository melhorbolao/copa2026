import { createClient } from '@/lib/supabase/server'
import { PrazosClient } from './PrazosClient'
import type { MatchPhase } from '@/types/database'

const PHASE_ORDER: MatchPhase[] = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarterfinal',
  'semifinal',
  'third_place',
  'final',
]

export const PHASE_LABELS: Record<MatchPhase, string> = {
  group:        'Fase de Grupos',
  round_of_32:  'Rodada de 32 (16avos)',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar',
  final:        'Final',
}

export interface MatchDeadlineRow {
  id: string
  match_number: number
  phase: MatchPhase
  team_home: string
  team_away: string
  betting_deadline: string
  match_datetime: string
}

export interface PhaseGroup {
  phase: MatchPhase
  label: string
  matches: MatchDeadlineRow[]
  sharedDeadline: string | null   // null quando há prazos diferentes entre as partidas
  minDeadline: string
  maxDeadline: string
}

export default async function AdminPrazosPage() {
  const supabase = await createClient()

  const { data: matches } = await supabase
    .from('matches')
    .select('id, match_number, phase, team_home, team_away, betting_deadline, match_datetime')
    .order('match_number', { ascending: true })

  const rows = (matches ?? []) as MatchDeadlineRow[]

  // Agrupa por fase na ordem canônica
  const phases: PhaseGroup[] = PHASE_ORDER
    .map(phase => {
      const phaseMatches = rows.filter(m => m.phase === phase)
      if (phaseMatches.length === 0) return null

      const deadlines = phaseMatches.map(m => m.betting_deadline)
      const minDeadline = deadlines.reduce((a, b) => a < b ? a : b)
      const maxDeadline = deadlines.reduce((a, b) => a > b ? a : b)
      const sharedDeadline = deadlines.every(d => d === deadlines[0]) ? deadlines[0] : null

      return {
        phase,
        label: PHASE_LABELS[phase],
        matches: phaseMatches,
        sharedDeadline,
        minDeadline,
        maxDeadline,
      }
    })
    .filter(Boolean) as PhaseGroup[]

  return <PrazosClient phases={phases} />
}
