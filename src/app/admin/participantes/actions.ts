'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

export async function createParticipant(data: {
  userId: string
  apelido: string
  bio?: string
}): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }

  const supabase = createAuthAdminClient()
  const apelidoTrimmed = data.apelido.trim()
  if (!apelidoTrimmed) return { error: 'Nome no Bolão é obrigatório.' }

  // Verifica que o usuário tem whatsapp e padrinho preenchidos
  const { data: userRecord } = await supabase
    .from('users').select('whatsapp, padrinho').eq('id', data.userId).single()
  if (!userRecord?.whatsapp) return { error: 'O usuário não tem WhatsApp cadastrado.' }
  if (!userRecord?.padrinho) return { error: 'O usuário não tem padrinho cadastrado.' }

  // Verifica unicidade do apelido
  const { data: existing } = await supabase
    .from('participants').select('id').eq('apelido', apelidoTrimmed).maybeSingle()
  if (existing) return { error: `O nome "${apelidoTrimmed}" já está em uso por outro participante.` }

  // Cria participante
  const { data: p, error: pErr } = await supabase
    .from('participants')
    .insert({ apelido: apelidoTrimmed, bio: data.bio?.trim() || null, paid: false })
    .select('id')
    .single()
  if (pErr || !p?.id) return { error: pErr?.message ?? 'Erro ao criar participante.' }

  // Usuário selecionado é sempre o dono/primário deste participante
  const { error: linkErr } = await supabase.from('user_participants').insert({
    user_id: data.userId,
    participant_id: p.id,
    is_primary: true,
  })
  if (linkErr) return { error: linkErr.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function deleteParticipant(participantId: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const { error } = await supabase.from('participants').delete().eq('id', participantId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/participantes')
}

export async function setPrimaryUser(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Verifica que o usuário está vinculado ao participante
  const { data: link } = await supabase
    .from('user_participants').select('id').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (!link) return { error: 'Usuário não vinculado a este participante.' }

  // Remove is_primary de todos os usuários deste participante
  await supabase.from('user_participants').update({ is_primary: false }).eq('participant_id', participantId)
  // Define o novo primário
  const { error } = await supabase.from('user_participants').update({ is_primary: true })
    .eq('participant_id', participantId).eq('user_id', userId)
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function updateParticipantApelido(participantId: string, apelido: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const trimmed = apelido.trim()
  if (!trimmed) return

  // Verifica unicidade
  const { data: existing } = await supabase
    .from('participants').select('id').eq('apelido', trimmed).neq('id', participantId).maybeSingle()
  if (existing) throw new Error(`O nome "${trimmed}" já está em uso.`)

  await supabase.from('participants').update({ apelido: trimmed }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function updateParticipantBio(participantId: string, bio: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  await supabase.from('participants').update({ bio: bio.trim() || null }).eq('id', participantId)
  revalidatePath('/admin/participantes')
}

export async function toggleParticipantPaid(participantId: string, current: boolean): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const { error } = await supabase.from('participants').update({ paid: !current }).eq('id', participantId)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/participantes')
}

export async function linkUserToParticipant(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Verifica se já está vinculado
  const { data: existing } = await supabase
    .from('user_participants').select('id').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (existing) return { error: 'Usuário já vinculado a este participante.' }

  const { error } = await supabase.from('user_participants').insert({
    participant_id: participantId,
    user_id: userId,
    is_primary: false,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function unlinkUserFromParticipant(participantId: string, userId: string): Promise<{ error?: string }> {
  try { await requireAdmin() } catch { return { error: 'Acesso negado' } }
  const supabase = createAuthAdminClient()

  // Não permite remover o usuário primário
  const { data: link } = await supabase
    .from('user_participants').select('is_primary').eq('participant_id', participantId).eq('user_id', userId).maybeSingle()
  if (link?.is_primary) return { error: 'Não é possível remover o usuário principal.' }

  const { error } = await supabase
    .from('user_participants').delete().eq('participant_id', participantId).eq('user_id', userId)
  if (error) return { error: error.message }

  revalidatePath('/admin/participantes')
  return {}
}

export async function getParticipantesSummaryText(): Promise<string> {
  await requireAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createAuthAdminClient() as any
  const now = new Date().toISOString()

  // PostgREST limita a 1000 linhas por request mesmo com service_role.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllIn(table: string, select: string, col: string, vals: string[]): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await supabase.from(table).select(select).in(col, vals).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [
    { data: participants },
    { data: noteRow },
    { data: users },
    { data: allMatches },
  ] = await Promise.all([
    supabase.from('participants').select('id, paid'),
    supabase.from('admin_settings').select('value').eq('key', 'pagantes_note').maybeSingle(),
    supabase.from('users').select('status').in('status', ['aprovado', 'aprovacao_pendente']),
    supabase.from('matches').select('id, phase, round, betting_deadline').order('betting_deadline', { ascending: true }),
  ])

  const totalParticipants = participants?.length ?? 0
  const paidParticipants  = (participants ?? []).filter((p: { paid: boolean }) => p.paid).length
  const pagantesExtras    = noteRow?.value
    ? noteRow.value.split('\n').filter((l: string) => l.trim()).length
    : 0
  const usersApproved = (users ?? []).filter((u: { status: string }) => u.status === 'aprovado').length
  const usersPending  = (users ?? []).filter((u: { status: string }) => u.status === 'aprovacao_pendente').length

  const nextMatch = (allMatches ?? []).find((m: { betting_deadline: string }) => m.betting_deadline > now)

  let nextStageName: string | null = null
  let nextStageFullCount = 0

  if (nextMatch) {
    const nextPhase = nextMatch.phase as string
    const nextRound = nextMatch.round as number | null

    const sameStage = (allMatches ?? []).filter((m: { phase: string; round: number | null }) => {
      if (nextPhase === 'group') return m.phase === 'group' && m.round === nextRound
      if (nextPhase === 'third_place' || nextPhase === 'final') return m.phase === 'third_place' || m.phase === 'final'
      return m.phase === nextPhase
    })
    const stageMatchIds = sameStage.map((m: { id: string }) => m.id)

    const STAGE_NAME_MAP: Record<string, string> = {
      round_of_32: '16avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
      semifinal: 'Semifinais', third_place: 'Final', final: 'Final',
    }
    nextStageName = nextPhase === 'group'
      ? `Rodada ${nextRound}`
      : (STAGE_NAME_MAP[nextPhase] ?? nextPhase)

    // Paginado: N participantes × M partidas pode facilmente exceder 1000 linhas
    const bets = await fetchAllIn('bets', 'participant_id', 'match_id', stageMatchIds)

    const betCount = new Map<string, number>()
    for (const b of bets) betCount.set(b.participant_id, (betCount.get(b.participant_id) ?? 0) + 1)

    let stageTotal = stageMatchIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extraData: { trnBets?: any[]; grpBets?: any[]; thrdBets?: any[] } = {}

    if (nextPhase === 'group' && nextRound === 1) {
      stageTotal += 5 + 12 + 8 // torneio + grupos + terceiros
      const pids = (participants ?? []).map((p: { id: string }) => p.id)
      const [{ data: trnBets }, grpBets, thrdBets] = await Promise.all([
        // tournament_bets: 1 linha/participante → sem risco de truncamento
        supabase.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer').in('participant_id', pids),
        // group_bets e third_place_bets: até 12/8 linhas por participante → paginar
        fetchAllIn('group_bets', 'participant_id', 'participant_id', pids),
        fetchAllIn('third_place_bets', 'participant_id', 'participant_id', pids),
      ])
      extraData.trnBets  = trnBets  ?? []
      extraData.grpBets  = grpBets
      extraData.thrdBets = thrdBets
    }

    for (const p of (participants ?? [])) {
      let count = betCount.get(p.id) ?? 0
      if (nextPhase === 'group' && nextRound === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trn = (extraData.trnBets as any[]).find((t: any) => t.participant_id === p.id)
        count += trn ? [trn.champion, trn.runner_up, trn.semi1, trn.semi2, trn.top_scorer].filter(Boolean).length : 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        count += Math.min((extraData.grpBets as any[]).filter((g: any) => g.participant_id === p.id).length, 12)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        count += Math.min((extraData.thrdBets as any[]).filter((t: any) => t.participant_id === p.id).length, 8)
      }
      if (count >= stageTotal) nextStageFullCount++
    }
  }

  const numWord = (n: number, feminine = false): string => {
    const masc = ['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove']
    const fem  = ['zero','uma','duas','três','quatro','cinco','seis','sete','oito','nove']
    if (n < 10) return feminine ? fem[n] : masc[n]
    return String(n)
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  const parts: string[] = []

  parts.push(
    `${totalParticipants} participante${totalParticipants !== 1 ? 's' : ''} cadastrado${totalParticipants !== 1 ? 's' : ''} no sistema, dos quais ${paidParticipants} já ${paidParticipants !== 1 ? 'pagaram' : 'pagou'}.`
  )

  if (pagantesExtras === 1) {
    parts.push('Um outro pagou e ainda não se cadastrou.')
  } else if (pagantesExtras > 1) {
    parts.push(`${cap(numWord(pagantesExtras))} outros pagaram e ainda não se cadastraram.`)
  }

  if (nextStageName && totalParticipants > 0) {
    parts.push(
      `Dos ${totalParticipants} cadastrados, ${nextStageFullCount} já ${nextStageFullCount !== 1 ? 'estão' : 'está'} com 100% dos palpites de ${nextStageName} preenchidos.`
    )
  }

  const pendPart = usersPending === 0
    ? 'nenhum pendente de aprovação'
    : `${usersPending} pendente${usersPending !== 1 ? 's' : ''} de aprovação`
  parts.push(`Temos ${usersApproved} usuário${usersApproved !== 1 ? 's' : ''} criado${usersApproved !== 1 ? 's' : ''} e aprovado${usersApproved !== 1 ? 's' : ''}, ${pendPart}.`)

  return parts.join(' ')
}

export async function getPagantesNote(): Promise<string> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  const { data } = await supabase
    .from('admin_settings').select('value').eq('key', 'pagantes_note').maybeSingle()
  return data?.value ?? ''
}

export async function setPagantesNote(text: string): Promise<void> {
  await requireAdmin()
  const supabase = createAuthAdminClient()
  await supabase
    .from('admin_settings')
    .upsert({ key: 'pagantes_note', value: text, updated_at: new Date().toISOString() })
}
