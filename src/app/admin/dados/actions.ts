'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

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

  revalidatePath('/classificacaoMB')
  revalidatePath('/tabelaMB')
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
      admin.from('matches')
        .update({ score_home: null, score_away: null, penalty_winner: null })
        .in('id', mids),
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

  revalidatePath('/classificacaoMB')
  revalidatePath('/tabelaMB')
  revalidatePath('/admin/jogos')
}
