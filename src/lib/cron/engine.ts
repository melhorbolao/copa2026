/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Motor compartilhado dos cron jobs de e-mail.
 * Todas as funções recebem um cliente Supabase com service_role.
 */

export type JobType = 'alert_24h' | 'alert_6h' | 'receipt'

export interface Etapa {
  key: string        // 'group_r1' | 'group_r2' | 'group_r3' | 'round_of_32' | ...
  label: string      // ex: "Rodada 1 — Fase de Grupos"
  deadline: Date     // MIN(betting_deadline) das partidas da etapa
  phase: string      // valor do campo phase nas matches
  round: number | null
}

export interface Participant {
  id: string
  name: string
  email: string
  apelido: string | null
  matchCount: number   // total de partidas na etapa
  betCount: number     // palpites preenchidos pelo usuário
  pct100: boolean
}

// ── Mapeamento de etapas ──────────────────────────────────────

const ETAPA_LABELS: Record<string, string> = {
  group_r1:    'Rodada 1 — Fase de Grupos',
  group_r2:    'Rodada 2 — Fase de Grupos',
  group_r3:    'Rodada 3 — Fase de Grupos',
  round_of_32: 'Rodada de 32',
  round_of_16: 'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:   'Semifinais',
  final:       'Final',
}

function toEtapaKey(phase: string, round: number | null): string {
  if (phase === 'group' && round) return `group_r${round}`
  // third_place e final compartilham prazo → chave unificada
  if (phase === 'third_place' || phase === 'final') return 'final'
  return phase
}

// ── Busca a etapa cuja deadline cai dentro do janelo ─────────

/**
 * Retorna a etapa cujo MIN(betting_deadline) está dentro da janela:
 *   now + targetOffsetMs - toleranceMs  <=  deadline  <=  now + targetOffsetMs + toleranceMs
 *
 * Ex: targetOffsetMs=24h, toleranceMs=35min → etapa com deadline em ~24h
 * Ex: targetOffsetMs=0,   toleranceMs=5min  → etapa cuja deadline acabou de passar
 */
export async function findEtapaInWindow(
  supabase: any,
  targetOffsetMs: number,
  toleranceMs: number,
): Promise<Etapa | null> {
  const now = Date.now()
  const lo  = new Date(now + targetOffsetMs - toleranceMs).toISOString()
  const hi  = new Date(now + targetOffsetMs + toleranceMs).toISOString()

  const { data: rows } = await supabase
    .from('matches')
    .select('phase, round, betting_deadline')
    .gte('betting_deadline', lo)
    .lte('betting_deadline', hi)
    .order('betting_deadline', { ascending: true })

  if (!rows?.length) return null

  // Agrupa por (phase, round) e pega o menor deadline de cada
  const map = new Map<string, { phase: string; round: number | null; deadline: Date }>()
  for (const row of rows) {
    const key = toEtapaKey(row.phase, row.round)
    if (!map.has(key) || new Date(row.betting_deadline) < map.get(key)!.deadline) {
      map.set(key, { phase: row.phase, round: row.round, deadline: new Date(row.betting_deadline) })
    }
  }

  if (!map.size) return null

  // Pega a etapa com o prazo mais próximo do alvo
  const target = now + targetOffsetMs
  let best: Etapa | null = null
  let bestDist = Infinity

  for (const [key, val] of map) {
    const dist = Math.abs(val.deadline.getTime() - target)
    if (dist < bestDist) {
      bestDist = dist
      best = {
        key,
        label: ETAPA_LABELS[key] ?? key,
        deadline: val.deadline,
        phase: val.phase,
        round: val.round,
      }
    }
  }

  return best
}

// ── Participantes elegíveis com status de preenchimento ───────

export async function getParticipants(
  supabase: any,
  etapa: Etapa,
): Promise<Participant[]> {
  // Usuários aprovados + pagos
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, apelido')
    .eq('approved', true)
    .eq('paid', true)

  if (!users?.length) return []

  // Total de partidas desta etapa
  let matchQuery = supabase.from('matches').select('id').eq('phase', etapa.phase)
  if (etapa.round) matchQuery = matchQuery.eq('round', etapa.round)
  // Para a fase "final" que engloba third_place + final
  if (etapa.key === 'final') {
    matchQuery = supabase.from('matches').select('id').in('phase', ['third_place', 'final'])
  }
  const { data: matches } = await matchQuery
  const matchCount = matches?.length ?? 0
  const matchIds   = new Set((matches ?? []).map((m: any) => m.id as string))

  // Busca todos os palpites dessas partidas de uma vez
  const { data: allBets } = await supabase
    .from('bets')
    .select('user_id, match_id')
    .in('match_id', [...matchIds])

  // Agrupa por user_id
  const betsByUser = new Map<string, number>()
  for (const b of (allBets ?? []) as any[]) {
    betsByUser.set(b.user_id, (betsByUser.get(b.user_id) ?? 0) + 1)
  }

  return (users as any[]).map((u: any) => {
    const betCount = betsByUser.get(u.id) ?? 0
    return {
      id:         u.id,
      name:       u.name,
      email:      u.email,
      apelido:    u.apelido ?? null,
      matchCount,
      betCount,
      pct100:     matchCount > 0 && betCount >= matchCount,
    }
  })
}

// ── Deduplicação ──────────────────────────────────────────────

export async function wasAlreadySent(
  supabase: any,
  userId: string,
  jobType: JobType,
  etapaKey: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('email_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('job_type', jobType)
    .eq('etapa_key', etapaKey)
    .eq('status', 'sent')
    .maybeSingle()
  return !!data
}

// ── Log de auditoria ──────────────────────────────────────────

export async function logEmail(
  supabase: any,
  params: {
    userId: string
    email: string
    jobType: JobType
    etapaKey: string
    messageId: string | null
    status: 'sent' | 'error'
    errorMsg?: string
  },
): Promise<void> {
  await supabase.from('email_logs').insert({
    user_id:    params.userId,
    email:      params.email,
    job_type:   params.jobType,
    etapa_key:  params.etapaKey,
    message_id: params.messageId,
    status:     params.status,
    error_msg:  params.errorMsg ?? null,
  })
}
