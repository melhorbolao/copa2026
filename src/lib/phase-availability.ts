/**
 * Disponibilidade de etapas em "Meus Palpites" e cálculo de qualificados.
 *
 * Existem duas dimensões independentes para cada etapa do palpite:
 *
 *  - **Visível a todos** (`released_rounds` em tournament_settings):
 *    palpites alheios da etapa são visíveis publicamente após o prazo.
 *    Já existia — apenas relabel da UI (era "Liberado").
 *
 *  - **Disponível para preenchimento** (`available_rounds` em tournament_settings):
 *    a aba da etapa é mostrada/habilitada em /palpites. Quando true, ela é
 *    liberada **apenas para os participantes classificados naquela fase**,
 *    conforme regras de corte do regulamento (itens 27–30):
 *      • 1º corte (após fase de grupos): top 50% por pontos da fase de grupos
 *        + bônus, arredondado para CIMA até o próximo múltiplo de 10. Empates
 *        na linha de corte: todos passam.
 *      • 2º corte (após oitavas): 50% dos habilitados após o 1º corte, usando
 *        pontos acumulados até oitavas. Empates na linha: todos passam.
 *
 * Pontos da fase de grupos = bets.points em partidas de grupo + group_bets.points
 *   + third_place_bets.points + tournament_bets.points (bônus artilheiro/G4).
 *   Os pontos de bônus são incluídos porque já compõem pts_total no ranking;
 *   excluí-los geraria empates diferentes entre ranking e corte.
 * Pontos até oitavas = pontos da fase de grupos + bets.points em R32 e R16.
 */

import { createAuthAdminClient } from '@/lib/supabase/server'

// As 8 etapas exibidas no StageFilter (e na tabela /participantes).
// "final" agrega 3º lugar + final.
export const STAGE_KEYS = ['r1','r2','r3','r32','r16','qf','sf','final'] as const
export type StageKey = typeof STAGE_KEYS[number]

export const STAGE_LABELS: Record<StageKey, string> = {
  r1:    'Rodada 1',
  r2:    'Rodada 2',
  r3:    'Rodada 3',
  r32:   '16 avos',
  r16:   'Oitavas',
  qf:    'Quartas',
  sf:    'Semi',
  final: '3º e Final',
}

/** Etapas que dependem de corte para liberação. r1/r2/r3 são abertas a todos. */
export const KNOCKOUT_STAGES: StageKey[] = ['r32','r16','qf','sf','final']

/** Stages que dependem do 1º corte (após fase de grupos). */
const STAGES_AFTER_CUTOFF_1 = new Set<StageKey>(['r32','r16'])
/** Stages que dependem do 2º corte (após oitavas). */
const STAGES_AFTER_CUTOFF_2 = new Set<StageKey>(['qf','sf','final'])

/** Mapeia roundKey do production-mode para StageKey. */
export function roundKeyToStage(roundKey: string): StageKey | null {
  if (roundKey === 'group_r1') return 'r1'
  if (roundKey === 'group_r2') return 'r2'
  if (roundKey === 'group_r3') return 'r3'
  if (roundKey === 'round_of_32') return 'r32'
  if (roundKey === 'round_of_16') return 'r16'
  if (roundKey === 'quarterfinal') return 'qf'
  if (roundKey === 'semifinal') return 'sf'
  if (roundKey === 'third_place' || roundKey === 'final') return 'final'
  return null
}

/** Inverso. Para "final" retorna ambos os roundKeys. */
export function stageToRoundKeys(stage: StageKey): string[] {
  if (stage === 'r1') return ['group_r1']
  if (stage === 'r2') return ['group_r2']
  if (stage === 'r3') return ['group_r3']
  if (stage === 'r32') return ['round_of_32']
  if (stage === 'r16') return ['round_of_16']
  if (stage === 'qf') return ['quarterfinal']
  if (stage === 'sf') return ['semifinal']
  return ['third_place', 'final']
}

// ── Settings (released + available) ───────────────────────────────────────

export interface PhaseSettings {
  visibleStages: Set<StageKey>       // antes "released_rounds"
  availableStages: Set<StageKey>     // novo
  availableRawKeys: Set<string>      // raw keys persistidos em available_rounds (inclui 'bonus')
}

/**
 * Lê as duas configurações em uma chamada. Converte os roundKeys persistidos
 * em StageKeys (canonical para a UI de Meus Palpites).
 */
export async function getPhaseSettings(): Promise<PhaseSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { data: rows } = await admin
    .from('tournament_settings')
    .select('key, value')
    .in('key', ['released_rounds', 'available_rounds'])

  const map: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rows ?? []).map((r: any) => [r.key, r.value]),
  )

  const parse = (raw: string | undefined): Set<StageKey> => {
    if (!raw) return new Set()
    try {
      const arr = JSON.parse(raw) as string[]
      const out = new Set<StageKey>()
      for (const k of arr) {
        const stage = roundKeyToStage(k)
        if (stage) out.add(stage)
        // Também aceita StageKey direto (legado/forward-compat)
        else if ((STAGE_KEYS as readonly string[]).includes(k)) out.add(k as StageKey)
      }
      return out
    } catch {
      return new Set()
    }
  }

  let availableRawKeys = new Set<string>()
  try {
    const arr = JSON.parse(map['available_rounds'] ?? '[]') as string[]
    availableRawKeys = new Set(arr)
  } catch { /* ignore */ }

  return {
    visibleStages: parse(map['released_rounds']),
    availableStages: parse(map['available_rounds']),
    availableRawKeys,
  }
}

// ── Cortes / qualificação ────────────────────────────────────────────────

interface ParticipantScores {
  participant_id: string
  group_phase_pts: number    // pts de partidas de grupo + group_bets + third_place_bets
  through_r16_pts: number    // group_phase_pts + bets.points em R32 e R16
}

/**
 * Sempre calcula os cortes dinamicamente a partir das pontuações atuais,
 * ignorando qualquer lista congelada. Use para executar um novo corte ou
 * exibir uma prévia do resultado antes de confirmar.
 */
export async function calculateQualifiedSetsRaw(): Promise<{
  cutoff1: Set<string>
  cutoff2: Set<string>
  totalParticipants: number
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // PostgREST aplica max-rows=1000 mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [
    { data: participants },
    { data: matches },
    bets,
    groupBets,
    thirdBets,
    tournamentBets,
  ] = await Promise.all([
    admin.from('participants').select('id'),
    admin.from('matches').select('id, phase'),
    fetchAll('bets', 'participant_id, match_id, points'),
    fetchAll('group_bets', 'participant_id, points'),
    fetchAll('third_place_bets', 'participant_id, points'),
    fetchAll('tournament_bets', 'participant_id, points'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const phaseByMatch = new Map<string, string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (matches ?? []).map((m: any) => [m.id as string, m.phase as string]),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allIds: string[] = (participants ?? []).map((p: any) => p.id as string)
  if (allIds.length === 0) return { cutoff1: new Set(), cutoff2: new Set(), totalParticipants: 0 }

  const scores = new Map<string, ParticipantScores>()
  for (const pid of allIds) {
    scores.set(pid, { participant_id: pid, group_phase_pts: 0, through_r16_pts: 0 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of (bets ?? []) as any[]) {
    const s = scores.get(b.participant_id)
    if (!s) continue
    const pts = (b.points ?? 0) as number
    if (!pts) continue
    const phase = phaseByMatch.get(b.match_id)
    if (phase === 'group') { s.group_phase_pts += pts; s.through_r16_pts += pts }
    else if (phase === 'round_of_32' || phase === 'round_of_16') s.through_r16_pts += pts
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (groupBets ?? []) as any[]) {
    const s = scores.get(g.participant_id); if (!s) continue
    const pts = (g.points ?? 0) as number
    s.group_phase_pts += pts; s.through_r16_pts += pts
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (thirdBets ?? []) as any[]) {
    const s = scores.get(t.participant_id); if (!s) continue
    const pts = (t.points ?? 0) as number
    s.group_phase_pts += pts; s.through_r16_pts += pts
  }
  // Bônus (artilheiro / G4): incluídos em pts_total do ranking, portanto também
  // devem compor group_phase_pts para que empates visíveis na classificação
  // se reflitam igualmente no corte.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tb of (tournamentBets ?? []) as any[]) {
    const s = scores.get(tb.participant_id); if (!s) continue
    const pts = (tb.points ?? 0) as number
    s.group_phase_pts += pts; s.through_r16_pts += pts
  }

  const cutoff1 = applyCutoff(
    [...scores.values()],
    s => s.group_phase_pts,
    Math.ceil(allIds.length / 2 / 10) * 10,  // 50% arredondado pra cima a múltiplo de 10
  )

  const cutoff1List = [...scores.values()].filter(s => cutoff1.has(s.participant_id))
  const cutoff2 = applyCutoff(
    cutoff1List,
    s => s.through_r16_pts,
    Math.ceil(cutoff1List.length / 2),       // 50% dos habilitados
  )

  return { cutoff1, cutoff2, totalParticipants: allIds.length }
}

/**
 * Calcula o conjunto de participantes qualificados para cada corte.
 * Se existirem listas congeladas (salvas pelo admin via "Executar Corte"),
 * usa-as em vez do cálculo dinâmico — garantindo que o resultado do corte
 * não mude após execução, mesmo que pontuações sejam recalculadas.
 *
 * Regra de empates (item 30): todos os empatados na linha de corte passam.
 * Regra do 1º corte: arredonda para cima ao próximo múltiplo de 10.
 * Regra do 2º corte: 50% dos habilitados pelo 1º (sem arredondamento explícito).
 */
export async function getQualifiedSets(): Promise<{
  cutoff1: Set<string>
  cutoff2: Set<string>
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const { data: frozenRows } = await admin
    .from('tournament_settings')
    .select('key, value')
    .in('key', ['corte1_participantes', 'corte2_participantes'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frozenMap: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (frozenRows ?? []).map((r: any) => [r.key as string, r.value as string]),
  )

  const parseFrozen = (raw: string | undefined): Set<string> | null => {
    if (!raw) return null
    try {
      const arr = JSON.parse(raw) as string[]
      return arr.length > 0 ? new Set(arr) : null
    } catch { return null }
  }

  const frozenCutoff1 = parseFrozen(frozenMap['corte1_participantes'])
  const frozenCutoff2 = parseFrozen(frozenMap['corte2_participantes'])

  if (frozenCutoff1 && frozenCutoff2) return { cutoff1: frozenCutoff1, cutoff2: frozenCutoff2 }

  const { cutoff1: dyn1, cutoff2: dyn2 } = await calculateQualifiedSetsRaw()
  return {
    cutoff1: frozenCutoff1 ?? dyn1,
    cutoff2: frozenCutoff2 ?? dyn2,
  }
}

/**
 * Ordena por score desc, pega os primeiros N, e ESTENDE o resultado para
 * incluir todos os empatados com o N-ésimo (item 30 do regulamento).
 */
function applyCutoff<T extends { participant_id: string }>(
  list: T[],
  scoreOf: (t: T) => number,
  cutN: number,
): Set<string> {
  if (list.length === 0 || cutN <= 0) return new Set()
  const sorted = [...list].sort((a, b) => scoreOf(b) - scoreOf(a))
  const limit = Math.min(cutN, sorted.length)
  const cutoffScore = scoreOf(sorted[limit - 1])
  const passed = sorted.filter(t => scoreOf(t) >= cutoffScore)
  return new Set(passed.map(t => t.participant_id))
}

/**
 * Decide, para um participante específico, em quais etapas ele pode preencher
 * palpites — combinando:
 *   1) availability administrativa (admin marcou "Disponível para preenchimento")
 *   2) regras de corte (regulamento itens 27–30)
 *
 * Para r1/r2/r3 (fase de grupos): basta a flag administrativa.
 * Para r32/r16 (após 1º corte): flag + estar em cutoff1.
 * Para qf/sf/final (após 2º corte): flag + estar em cutoff2.
 */
export function canFillStage(
  stage: StageKey,
  participantId: string,
  settings: PhaseSettings,
  qualified: { cutoff1: Set<string>; cutoff2: Set<string> },
): boolean {
  if (!settings.availableStages.has(stage)) return false
  if (STAGES_AFTER_CUTOFF_1.has(stage)) return qualified.cutoff1.has(participantId)
  if (STAGES_AFTER_CUTOFF_2.has(stage)) return qualified.cutoff2.has(participantId)
  return true
}

/**
 * "Cortado" para uma etapa = a etapa está disponível para preenchimento, mas
 * o participante não passou no corte exigido. Distinção importante para a
 * UI de /participantes (mostrar ícone de corte ≠ "ainda não disponível").
 */
export function isCutFromStage(
  stage: StageKey,
  participantId: string,
  settings: PhaseSettings,
  qualified: { cutoff1: Set<string>; cutoff2: Set<string> },
): boolean {
  if (!settings.availableStages.has(stage)) return false
  if (STAGES_AFTER_CUTOFF_1.has(stage)) return !qualified.cutoff1.has(participantId)
  if (STAGES_AFTER_CUTOFF_2.has(stage)) return !qualified.cutoff2.has(participantId)
  return false
}

/**
 * Mapeia uma `match_phase` (+ round, para 'group') para a StageKey do
 * StageFilter. Útil em server actions que recebem matchId e precisam validar.
 */
export function matchPhaseToStage(phase: string, round: number | null): StageKey | null {
  if (phase === 'group') {
    if (round === 1) return 'r1'
    if (round === 2) return 'r2'
    if (round === 3) return 'r3'
    return null
  }
  if (phase === 'round_of_32') return 'r32'
  if (phase === 'round_of_16') return 'r16'
  if (phase === 'quarterfinal') return 'qf'
  if (phase === 'semifinal') return 'sf'
  if (phase === 'third_place' || phase === 'final') return 'final'
  return null
}

/**
 * Lança erro se o participante não pode preencher palpites para a etapa da
 * partida. Para uso em server actions (`saveBet`, `saveBetsBatch`, ...).
 * Sob `availableStages` vazio (config inicial: nada marcado), libera tudo —
 * preserva comportamento legado até o admin começar a usar a feature.
 */
export async function assertCanFillForMatch(
  matchPhase: string,
  matchRound: number | null,
  participantId: string,
): Promise<void> {
  const stage = matchPhaseToStage(matchPhase, matchRound)
  if (!stage) return
  const [settings, qualified] = await Promise.all([getPhaseSettings(), getQualifiedSets()])
  if (settings.availableStages.size === 0) return  // feature ainda não em uso
  if (!canFillStage(stage, participantId, settings, qualified)) {
    throw new Error('Etapa não disponível para você (admin ainda não liberou ou você foi cortado)')
  }
}

/**
 * Um participante é considerado **eliminado do bolão** quando, no estado
 * atual, ele já não pode preencher nenhuma etapa de mata-mata futura. Isto é:
 * está fora do cutoff2 E o cutoff2 está aplicável (alguma etapa pós-corte 2
 * já foi marcada como disponível) — ou está fora do cutoff1 E o cutoff1 está
 * aplicável.
 */
export function isParticipantEliminated(
  participantId: string,
  settings: PhaseSettings,
  qualified: { cutoff1: Set<string>; cutoff2: Set<string> },
): boolean {
  const anyCutoff2Available = [...STAGES_AFTER_CUTOFF_2].some(s => settings.availableStages.has(s))
  if (anyCutoff2Available && !qualified.cutoff2.has(participantId)) return true
  const anyCutoff1Available = [...STAGES_AFTER_CUTOFF_1].some(s => settings.availableStages.has(s))
  if (anyCutoff1Available && !qualified.cutoff1.has(participantId)) return true
  return false
}
