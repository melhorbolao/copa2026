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

  if (currentStageMatchIds.length > 0 && nextMatch) {
    const isR1     = nextMatch.phase === 'group' && nextMatch.round === 1
    const R1_BONUS = 5 + 12 + 8   // torneio (5) + grupos (12) + terceiros (8)
    const stageTotal = currentStageMatchIds.length + (isR1 ? R1_BONUS : 0)
    const PAGE = 1000

    // Match bets — paginado para evitar truncamento
    const betCountByPid = new Map<string, number>()
    for (let from = 0;;) {
      const { data, error } = await supabase
        .from('bets').select('participant_id')
        .in('match_id', currentStageMatchIds)
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      for (const b of data) betCountByPid.set(b.participant_id, (betCountByPid.get(b.participant_id) ?? 0) + 1)
      if (data.length < PAGE) break
      from += PAGE
    }

    // Bônus da R1: torneio, grupos, terceiros
    const trnCountMap   = new Map<string, number>()
    const grpCountMap   = new Map<string, number>()
    const thirdCountMap = new Map<string, number>()

    if (isR1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pids = participants.map((p: any) => p.id)

      const { data: trnData } = await supabase
        .from('tournament_bets')
        .select('participant_id, champion, runner_up, semi1, semi2, top_scorer')
        .in('participant_id', pids)
      for (const t of (trnData ?? []))
        trnCountMap.set(t.participant_id,
          [t.champion, t.runner_up, t.semi1, t.semi2, t.top_scorer].filter(Boolean).length)

      for (let from = 0;;) {
        const { data, error } = await supabase
          .from('group_bets').select('participant_id').in('participant_id', pids).range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const g of data) grpCountMap.set(g.participant_id, (grpCountMap.get(g.participant_id) ?? 0) + 1)
        if (data.length < PAGE) break
        from += PAGE
      }

      for (let from = 0;;) {
        const { data, error } = await supabase
          .from('third_place_bets').select('participant_id').in('participant_id', pids).range(from, from + PAGE - 1)
        if (error || !data || data.length === 0) break
        for (const t of data) thirdCountMap.set(t.participant_id, (thirdCountMap.get(t.participant_id) ?? 0) + 1)
        if (data.length < PAGE) break
        from += PAGE
      }
    }

    for (const p of participants) {
      let count = betCountByPid.get(p.id) ?? 0
      if (isR1) {
        count += trnCountMap.get(p.id) ?? 0
        count += Math.min(grpCountMap.get(p.id) ?? 0, 12)
        count += Math.min(thirdCountMap.get(p.id) ?? 0, 8)
      }
      betFillByPid[p.id] = count === 0 ? 'zerado' : count >= stageTotal ? 'completo' : 'parcial'
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
