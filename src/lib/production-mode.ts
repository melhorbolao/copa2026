// Utilities for "Modo Produção" visibility control.
// All filtering happens server-side so raw bet data never reaches the client when restricted.

import { createAuthAdminClient } from '@/lib/supabase/server'

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
// isAdmin: when true AND productionMode=false (test mode), bypass all filters.
export function isMatchBetsVisible(
  phase: string,
  round: number | null,
  betting_deadline: string,
  now: Date,
  settings: VisibilitySettings,
  isAdmin = false,
): boolean {
  if (isAdmin && !settings.productionMode) return true   // test-mode admin: vê tudo
  if (new Date(betting_deadline) > now) return false     // prazo não passou: oculto
  return settings.releasedRounds.has(getRoundKey(phase, round))
}

// Returns true if bonus bets (group standings, thirds, G4, scorer) should be visible.
export function isBonusVisible(
  bonusDeadline: string | null,
  now: Date,
  settings: VisibilitySettings,
  isAdmin = false,
): boolean {
  if (isAdmin && !settings.productionMode) return true
  if (!bonusDeadline || new Date(bonusDeadline) > now) return false
  return settings.releasedRounds.has('bonus')
}

// Filtra palpites pelo prazo da partida.
// - Test-mode admin (isAdmin && !productionMode): vê todos.
// - Demais: vê só palpites de partidas cujo prazo já passou,
//   mais os seus próprios (ownParticipantId) para qualquer partida.
export function filterBetsByDeadline<T extends { match_id: string; participant_id?: string }>(
  bets: T[],
  deadlineByMatch: Record<string, string>,   // match_id → betting_deadline ISO string
  now: Date,
  isTestModeAdmin: boolean,
  ownParticipantId?: string | null,
): T[] {
  if (isTestModeAdmin) return bets
  return bets.filter(bet => {
    const dl = deadlineByMatch[bet.match_id]
    if (!dl) return false
    if (new Date(dl) <= now) return true            // prazo passou: público
    return !!ownParticipantId && bet.participant_id === ownParticipantId
  })
}
