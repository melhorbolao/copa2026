// Utilities for "Modo Produção" visibility control.
// All filtering happens server-side so raw bet data never reaches the client when restricted.

import { createAuthAdminClient } from '@/lib/supabase/server'

// Retorna o timestamp atual do PostgreSQL para validação de prazos.
// Usar o relógio do banco (não new Date()) garante consistência com as
// políticas RLS e impede que usuários manipulem o relógio do próprio OS.
export async function getServerNow(): Promise<Date> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data, error } = await admin.rpc('get_server_now')
    if (!error && data) return new Date(data as string)
  } catch { /* fallback gracioso se a função ainda não existir no banco */ }
  return new Date()
}

export type RoundKey = string

const PHASE_ORDER: Record<string, number> = {
  group: 0,
  round_of_32: 100,
  round_of_16: 200,
  quarterfinal: 300,
  semifinal: 400,
  third_place: 500,
  final: 600,
}

export function getRoundKey(phase: string, round?: number | null): RoundKey {
  if (phase === 'group') return `group_r${round ?? 1}`
  return phase
}

export function getRoundLabel(phase: string, round?: number | null): string {
  if (phase === 'group') return `Rodada ${round ?? 1} — Fase de Grupos`
  const labels: Record<string, string> = {
    round_of_32: '16 Avos de Final',
    round_of_16: 'Oitavas de Final',
    quarterfinal: 'Quartas de Final',
    semifinal: 'Semifinais',
    third_place: '3º Lugar',
    final: 'Final',
  }
  return labels[phase] ?? phase
}

export interface RoundInfo {
  key: RoundKey
  label: string
  deadline: string | null
}

export interface VisibilitySettings {
  productionMode: boolean
  releasedRounds: Set<RoundKey>
}

export async function getVisibilitySettings(): Promise<VisibilitySettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { data: rows } = await admin
    .from('tournament_settings')
    .select('key, value')
    .in('key', ['production_mode', 'released_rounds'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map: Record<string, string> = Object.fromEntries((rows ?? []).map((r: any) => [r.key, r.value]))

  const productionMode = map['production_mode'] === 'true'
  let releasedRounds: Set<RoundKey> = new Set()
  if (map['released_rounds']) {
    try { releasedRounds = new Set(JSON.parse(map['released_rounds'])) } catch { /* ignore */ }
  }

  return { productionMode, releasedRounds }
}

// Build chronologically-ordered list of available rounds from a matches list.
export function buildAvailableRounds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  matches: any[]
): RoundInfo[] {
  const sorted = [...matches].sort((a, b) => {
    const pa = PHASE_ORDER[a.phase] ?? 999
    const pb = PHASE_ORDER[b.phase] ?? 999
    if (pa !== pb) return pa - pb
    return (a.round ?? 0) - (b.round ?? 0)
  })

  const seen = new Set<string>()
  const rounds: RoundInfo[] = []

  for (const m of sorted) {
    const key = getRoundKey(m.phase, m.round)
    if (!seen.has(key)) {
      seen.add(key)
      rounds.push({ key, label: getRoundLabel(m.phase, m.round), deadline: m.betting_deadline })
    }
    // Insert bonus round right after group_r1 (shares the same deadline)
    if (key === 'group_r1' && !seen.has('bonus')) {
      seen.add('bonus')
      rounds.push({ key: 'bonus', label: 'Bônus — Classificados, G4 e Artilheiro', deadline: m.betting_deadline })
    }
  }

  return rounds
}

// Returns true if this match's bets should be visible given current settings.
// Nenhum papel (admin/master/user) pode ver palpites alheios antes do prazo.
// Após o prazo: admin bypassa o gate de releasedRounds; usuário comum precisa
// que a rodada esteja explicitamente liberada.
export function isMatchBetsVisible(
  phase: string,
  round: number | null,
  betting_deadline: string,
  now: Date,
  settings: VisibilitySettings,
  isAdmin = false,
): boolean {
  if (new Date(betting_deadline) > now) return false     // prazo não passou: oculto para todos
  if (isAdmin) return true                               // prazo passou: admin vê sem precisar liberar a rodada
  return settings.releasedRounds.has(getRoundKey(phase, round))
}

// Returns true if bonus bets (group standings, thirds, G4, scorer) should be visible.
export function isBonusVisible(
  bonusDeadline: string | null,
  now: Date,
  settings: VisibilitySettings,
  isAdmin = false,
): boolean {
  if (!bonusDeadline || new Date(bonusDeadline) > now) return false  // prazo não passou: oculto para todos
  if (isAdmin) return true
  return settings.releasedRounds.has('bonus')
}

// Filtra palpites pelo prazo da partida.
// Ninguém (nem admin nem master) vê palpites alheios de partidas com prazo aberto.
// O participante sempre vê os seus próprios (ownParticipantId).
export function filterBetsByDeadline<T extends { match_id: string; participant_id?: string }>(
  bets: T[],
  deadlineByMatch: Record<string, string>,   // match_id → betting_deadline ISO string
  now: Date,
  _isAdmin: boolean,                         // mantido para compatibilidade, não tem mais efeito
  ownParticipantId?: string | null,
): T[] {
  return bets.filter(bet => {
    const dl = deadlineByMatch[bet.match_id]
    if (!dl) return false
    if (new Date(dl) <= now) return true            // prazo passou: público
    return !!ownParticipantId && bet.participant_id === ownParticipantId
  })
}
