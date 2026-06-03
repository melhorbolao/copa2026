import { createAuthAdminClient } from '@/lib/supabase/server'
import { ParticipantsClient } from './ParticipantsClient'
import { getPagantesNote } from './actions'

export default async function AdminParticipantesPage() {
  const supabase = createAuthAdminClient()
  const now      = new Date()
  const nowISO   = now.toISOString()

  const [{ data: rawParticipants }, { data: approvedUsers }, pagantesNote, { data: matchesRaw }] = await Promise.all([
    supabase
      .from('participants')
      .select('id, apelido, bio, paid, created_at, user_participants(user_id, is_primary, users(id, name, email))')
      .order('apelido'),
    supabase
      .from('users')
      .select('id, name, apelido, whatsapp, padrinho')
      .eq('status', 'aprovado')
      .order('name'),
    getPagantesNote(),
    supabase
      .from('matches')
      .select('id, phase, round, betting_deadline')
      .order('betting_deadline', { ascending: true }),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participants = (rawParticipants ?? []) as any[]
  const users        = (approvedUsers  ?? []) as { id: string; name: string; apelido: string | null; whatsapp: string | null; padrinho: string | null }[]
  const matches      = (matchesRaw    ?? []) as { id: string; phase: string; round: number | null; betting_deadline: string }[]

  // ── Rodada em andamento ────────────────────────────────────────────────────
  const STAGE_NAME_MAP: Record<string, string> = {
    round_of_32: '16avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
    semifinal: 'Semifinais', third_place: 'Final', final: 'Final',
  }

  const nextMatch = matches.find(m => m.betting_deadline > nowISO)
  let currentStageName: string | null = null
  let currentStageMatchIds: string[]  = []

  if (nextMatch) {
    const { phase, round } = nextMatch
    currentStageName = phase === 'group'
      ? `Rodada ${round}`
      : (STAGE_NAME_MAP[phase] ?? phase)

    currentStageMatchIds = matches
      .filter(m => {
        if (phase === 'group') return m.phase === 'group' && m.round === round
        if (phase === 'third_place' || phase === 'final') return m.phase === 'third_place' || m.phase === 'final'
        return m.phase === phase
      })
      .map(m => m.id)
  }

  // ── Preenchimento de palpites por participante ─────────────────────────────
  const betFillByPid: Record<string, 'zerado' | 'parcial' | 'completo'> = {}

  if (currentStageMatchIds.length > 0) {
    const { data: betsRaw } = await supabase
      .from('bets')
      .select('participant_id')
      .in('match_id', currentStageMatchIds)
      .range(0, 4999)

    const betCountByPid = new Map<string, number>()
    for (const b of (betsRaw ?? [])) {
      betCountByPid.set(b.participant_id, (betCountByPid.get(b.participant_id) ?? 0) + 1)
    }

    for (const p of participants) {
      const count = betCountByPid.get(p.id) ?? 0
      betFillByPid[p.id] = count === 0
        ? 'zerado'
        : count >= currentStageMatchIds.length ? 'completo' : 'parcial'
    }
  }

  return (
    <ParticipantsClient
      participants={participants}
      users={users}
      pagantesNote={pagantesNote}
      betFillByPid={betFillByPid}
      currentStageName={currentStageName}
    />
  )
}
