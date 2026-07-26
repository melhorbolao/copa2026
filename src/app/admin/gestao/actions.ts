'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { calculateQualifiedSetsRaw, getQualifiedSets } from '@/lib/phase-availability'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

// ── Modo Produção ─────────────────────────────────────────────

export async function setSobeDesceVisible(visible: boolean): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  await admin
    .from('tournament_settings')
    .upsert({ key: 'sobe_desce_visible', value: String(visible) }, { onConflict: 'key' })

  revalidatePath('/copa2026/classificacaoMB')
  revalidatePath('/admin/gestao')
}

export async function setProductionMode(enabled: boolean): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  await admin
    .from('tournament_settings')
    .upsert({ key: 'production_mode', value: String(enabled) }, { onConflict: 'key' })

  revalidatePath('/copa2026/tabelaMB')
  revalidatePath('/admin/gestao')
}

// ── Liberação de rodadas ───────────────────────────────────────

async function toggleRoundKeyInSetting(
  settingKey: 'released_rounds' | 'available_rounds',
  roundKey: string,
  add: boolean,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { data: row } = await admin
    .from('tournament_settings').select('value').eq('key', settingKey).maybeSingle()

  let current: string[] = []
  if (row?.value) {
    try { current = JSON.parse(row.value) } catch { /* ignore */ }
  }

  const next = add
    ? [...new Set([...current, roundKey])]
    : current.filter((k: string) => k !== roundKey)

  await admin
    .from('tournament_settings')
    .upsert({ key: settingKey, value: JSON.stringify(next) }, { onConflict: 'key' })
}

export async function setRoundReleased(roundKey: string, released: boolean): Promise<void> {
  await requireAdmin()
  await toggleRoundKeyInSetting('released_rounds', roundKey, released)
  revalidatePath('/copa2026/tabelaMB')
  revalidatePath('/admin/gestao')
}

/**
 * Marca uma etapa como "Disponível para preenchimento" (visível em /palpites
 * apenas para participantes classificados naquela fase). Persiste em
 * `tournament_settings.available_rounds`. Aceita o roundKey canônico do
 * production-mode (ex.: 'round_of_32') OU a StageKey direta ('r32') — ambas
 * são desserializadas corretamente em `getPhaseSettings`.
 */
export async function setRoundAvailable(roundKey: string, available: boolean): Promise<void> {
  await requireAdmin()
  await toggleRoundKeyInSetting('available_rounds', roundKey, available)
  revalidatePath('/copa2026/palpites')
  revalidatePath('/copa2026/participantes')
  revalidatePath('/admin/gestao')
}

// ── Cortes de participantes ────────────────────────────────────

const CORTE_REVALIDATE_PATHS = ['/palpites', '/participantes', '/admin/gestao']

function revalidateAll(paths: string[]) {
  for (const p of paths) revalidatePath(p)
}

/**
 * Congela o 1º corte com base na pontuação atual e libera a fase dos 16 avos
 * para preenchimento apenas pelos classificados.
 */
export async function executarCorte1(): Promise<{ classified: number; total: number }> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const { cutoff1, totalParticipants } = await calculateQualifiedSetsRaw()
  const classifiedIds = [...cutoff1]
  const now = new Date().toISOString()

  await Promise.all([
    admin.from('tournament_settings').upsert(
      { key: 'corte1_participantes', value: JSON.stringify(classifiedIds) },
      { onConflict: 'key' },
    ),
    admin.from('tournament_settings').upsert(
      { key: 'corte1_executado_em', value: now },
      { onConflict: 'key' },
    ),
  ])
  await toggleRoundKeyInSetting('available_rounds', 'round_of_32', true)

  revalidateAll(CORTE_REVALIDATE_PATHS)
  return { classified: classifiedIds.length, total: totalParticipants }
}

/**
 * Congela o 2º corte com base na pontuação acumulada até as oitavas
 * (usando o cutoff1 já congelado, se existir) e libera as quartas de final.
 */
export async function executarCorte2(): Promise<{ classified: number; total: number }> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // Usa cutoff1 congelado se disponível; senão recalcula tudo
  const { cutoff1, cutoff2 } = await getQualifiedSets()
  const classifiedIds = [...cutoff2]
  const now = new Date().toISOString()

  await Promise.all([
    admin.from('tournament_settings').upsert(
      { key: 'corte2_participantes', value: JSON.stringify(classifiedIds) },
      { onConflict: 'key' },
    ),
    admin.from('tournament_settings').upsert(
      { key: 'corte2_executado_em', value: now },
      { onConflict: 'key' },
    ),
  ])
  await toggleRoundKeyInSetting('available_rounds', 'quarterfinal', true)

  revalidateAll(CORTE_REVALIDATE_PATHS)
  return { classified: classifiedIds.length, total: cutoff1.size }
}

/** Remove a lista congelada do 1º corte (volta ao cálculo dinâmico). */
export async function desfazerCorte1(): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  await Promise.all([
    admin.from('tournament_settings').delete().eq('key', 'corte1_participantes'),
    admin.from('tournament_settings').delete().eq('key', 'corte1_executado_em'),
  ])
  revalidateAll(CORTE_REVALIDATE_PATHS)
}

/** Remove a lista congelada do 2º corte (volta ao cálculo dinâmico). */
export async function desfazerCorte2(): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  await Promise.all([
    admin.from('tournament_settings').delete().eq('key', 'corte2_participantes'),
    admin.from('tournament_settings').delete().eq('key', 'corte2_executado_em'),
  ])
  revalidateAll(CORTE_REVALIDATE_PATHS)
}

// ── Gestão de dados ────────────────────────────────────────────

export async function clearAllBets(): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const { data: participants } = await admin.from('participants').select('id')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pids = (participants ?? []).map((p: any) => p.id as string)
  if (pids.length === 0) return

  await Promise.all([
    admin.from('bets').delete().in('participant_id', pids),
    admin.from('group_bets').delete().in('participant_id', pids),
    admin.from('third_place_bets').delete().in('participant_id', pids),
    admin.from('tournament_bets').delete().in('participant_id', pids),
  ])

  await admin.from('participant_scores').update({
    pts_matches: 0, pts_groups: 0, pts_thirds: 0, pts_tournament: 0, pts_total: 0,
  }).in('participant_id', pids)

  revalidatePath('/copa2026/classificacaoMB')
  revalidatePath('/copa2026/tabelaMB')
}

export async function clearAllResults(): Promise<void> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [{ data: matches }, { data: participants }] = await Promise.all([
    admin.from('matches').select('id'),
    admin.from('participants').select('id'),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mids = (matches ?? []).map((m: any) => m.id as string)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pids = (participants ?? []).map((p: any) => p.id as string)

  const ops: Promise<unknown>[] = []
  if (mids.length > 0) {
    ops.push(
      admin.from('matches').update({ score_home: null, score_away: null, penalty_winner: null }).in('id', mids),
      admin.from('bets').update({ points: null }).in('match_id', mids),
    )
  }
  if (pids.length > 0) {
    ops.push(
      admin.from('group_bets').update({ points: null }).in('participant_id', pids),
      admin.from('third_place_bets').update({ points: null }).in('participant_id', pids),
      admin.from('tournament_bets').update({ points: null }).in('participant_id', pids),
    )
  }

  await Promise.all(ops)

  if (pids.length > 0) {
    await admin.from('participant_scores').update({
      pts_matches: 0, pts_groups: 0, pts_thirds: 0, pts_tournament: 0, pts_total: 0,
    }).in('participant_id', pids)
  }

  revalidatePath('/copa2026/classificacaoMB')
  revalidatePath('/copa2026/tabelaMB')
  revalidatePath('/admin/jogos')
}
