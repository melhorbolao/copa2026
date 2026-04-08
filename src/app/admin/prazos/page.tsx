import { createClient } from '@/lib/supabase/server'
import { PrazosClient } from './PrazosClient'
import type { MatchPhase } from '@/types/database'
import type { MatchDeadlineRow, PhaseGroup } from './types'

const PHASE_ORDER: MatchPhase[] = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarterfinal',
  'semifinal',
  'third_place',
  'final',
]

const PHASE_LABELS: Record<MatchPhase, string> = {
  group:        'Fase de Grupos',
  round_of_32:  'Rodada de 32 (16avos)',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar',
  final:        'Final',
}

function makeGroup(
  key: string,
  label: string,
  phase: MatchPhase,
  groupRound: number | null,
  matches: MatchDeadlineRow[],
): PhaseGroup {
  const deadlines     = matches.map(m => m.betting_deadline)
  const minDeadline   = deadlines.reduce((a, b) => a < b ? a : b)
  const maxDeadline   = deadlines.reduce((a, b) => a > b ? a : b)
  const sharedDeadline = deadlines.every(d => d === deadlines[0]) ? deadlines[0] : null
  return { key, label, phase, groupRound, matches, sharedDeadline, minDeadline, maxDeadline }
}

export default async function AdminPrazosPage() {
  const supabase = await createClient()

  const { data: matches } = await supabase
    .from('matches')
    .select('id, match_number, phase, round, team_home, team_away, betting_deadline, match_datetime')
    .order('match_number', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (matches ?? []) as any[] as MatchDeadlineRow[]

  const phases: PhaseGroup[] = []

  for (const phase of PHASE_ORDER) {
    const phaseMatches = rows.filter(m => m.phase === phase)
    if (phaseMatches.length === 0) continue

    if (phase === 'group') {
      for (const roundNum of [1, 2, 3]) {
        const roundMatches = phaseMatches.filter(m => m.round === roundNum)
        if (roundMatches.length === 0) continue
        phases.push(makeGroup(
          `group_${roundNum}`,
          `Fase de Grupos — Rodada ${roundNum}`,
          phase,
          roundNum,
          roundMatches,
        ))
      }
    } else {
      phases.push(makeGroup(phase, PHASE_LABELS[phase], phase, null, phaseMatches))
    }
  }

  return <PrazosClient phases={phases} />
}
