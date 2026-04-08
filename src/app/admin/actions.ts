'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { notifyUserApproved, sendReminderEmail } from '@/lib/email'
import { isEmailEnabled } from '@/lib/email-settings'
import type { MatchPhase } from '@/types/database'

type Rules = Record<string, number>

// ── Guard: garante que o chamador é admin ─────────────────────
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

// ── Cadastro manual de participante ──────────────────────────
export async function createManualUser(data: {
  name: string
  email: string
  whatsapp: string
  padrinho: string
  apelido: string
  observacao: string
}) {
  await requireAdmin()
  const supabase = await createAdminClient()

  const { error } = await supabase.from('users').insert({
    name:       data.name.trim(),
    email:      data.email.trim(),
    whatsapp:   data.whatsapp.trim(),
    padrinho:   data.padrinho,
    apelido:    data.apelido.trim() || null,
    observacao: data.observacao.trim() || null,
    provider:  'manual',
    status:    'aprovado',
    approved:  true,
    paid:      false,
    is_admin:  false,
    is_manual: true,
  })

  if (error) throw new Error(error.message)
  revalidatePath('/admin/usuarios')
}

// ── Atualização de observação ────────────────────────────────
export async function updateObservacao(userId: string, observacao: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase.from('users').update({ observacao: observacao || null }).eq('id', userId)
  revalidatePath('/admin/usuarios')
}

// ── Atualização de apelido ────────────────────────────────────
export async function updateApelido(userId: string, apelido: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase.from('users').update({ apelido: apelido || null }).eq('id', userId)
  revalidatePath('/admin/usuarios')
}

// ── Atualização de padrinho ───────────────────────────────────
export async function updatePadrinho(userId: string, padrinho: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase.from('users').update({ padrinho: padrinho || null }).eq('id', userId)
  revalidatePath('/admin/usuarios')
}

// ── Exclusão de usuário ───────────────────────────────────────
export async function deleteUser(userId: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  // Remove da tabela pública (cascade apaga bets, etc.)
  await supabase.from('users').delete().eq('id', userId)
  // Remove da autenticação do Supabase
  await supabase.auth.admin.deleteUser(userId)
  revalidatePath('/admin/usuarios')
}

// ── Aprovação de usuário ──────────────────────────────────────
export async function toggleApproved(userId: string, current: boolean) {
  await requireAdmin()
  const supabase = await createAdminClient()

  const newApproved = !current
  const newStatus   = newApproved ? 'aprovado' : 'aprovacao_pendente'

  await supabase
    .from('users')
    .update({ approved: newApproved, status: newStatus })
    .eq('id', userId)

  // Envia boas-vindas quando aprovando pela primeira vez
  if (newApproved) {
    const { data: u } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', userId)
      .single()
    if (u && await isEmailEnabled('notify_approved')) {
      try { await notifyUserApproved({ name: u.name, email: u.email }) } catch { /* silent */ }
    }
  }

  revalidatePath('/admin/usuarios')
}

// ── Lembrete em massa ─────────────────────────────────────────
export async function sendReminderEmails(
  recipients: 'all' | 'pending' | 'cut1' | 'cut2',
  stage: string,
  body: string,
) {
  await requireAdmin()
  const supabase = await createAdminClient()

  // Busca usuários aprovados
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email')
    .eq('status', 'aprovado')

  if (!users?.length) return { sent: 0 }

  let targets = users

  if (recipients === 'pending') {
    // Mapeia phase/round para o stage selecionado
    const stageFilter = buildStageFilter(stage)
    const { data: matches } = await supabase
      .from('matches')
      .select('id')
      .match(stageFilter.match ?? {})
      .in('phase', stageFilter.phases as MatchPhase[])

    if (matches?.length) {
      const matchIds = new Set(matches.map(m => m.id))
      const { data: bets } = await supabase
        .from('bets')
        .select('user_id, match_id')
        .in('user_id', users.map(u => u.id))

      const betCountByUser = new Map<string, number>()
      for (const bet of bets ?? []) {
        if (matchIds.has(bet.match_id)) {
          betCountByUser.set(bet.user_id, (betCountByUser.get(bet.user_id) ?? 0) + 1)
        }
      }

      targets = users.filter(u => (betCountByUser.get(u.id) ?? 0) < matchIds.size)
    }
  }

  // Filtros de corte: classificados = quem apostou na fase indicada
  if (recipients === 'cut1' || recipients === 'cut2') {
    const cutPhase = recipients === 'cut1' ? ['round_of_32'] : ['quarterfinal']
    const { data: cutMatches } = await supabase
      .from('matches')
      .select('id')
      .in('phase', cutPhase as MatchPhase[])

    if (cutMatches?.length) {
      const cutMatchIds = new Set(cutMatches.map(m => m.id))
      const { data: bets } = await supabase
        .from('bets')
        .select('user_id, match_id')
        .in('user_id', users.map(u => u.id))

      const usersWithBets = new Set<string>()
      for (const bet of bets ?? []) {
        if (cutMatchIds.has(bet.match_id)) usersWithBets.add(bet.user_id)
      }

      targets = users.filter(u => usersWithBets.has(u.id))
    } else {
      targets = []
    }
  }

  let sent = 0
  for (const u of targets) {
    try {
      await sendReminderEmail({ name: u.name, email: u.email, body })
      sent++
    } catch { /* continua mesmo se um falhar */ }
  }

  return { sent }
}

function buildStageFilter(stage: string): { phases: string[]; match?: Record<string, unknown> } {
  switch (stage) {
    case 'r1':    return { phases: ['group'], match: { round: 1 } }
    case 'r2':    return { phases: ['group'], match: { round: 2 } }
    case 'r3':    return { phases: ['group'], match: { round: 3 } }
    case 'r32':   return { phases: ['round_of_32'] }
    case 'r16':   return { phases: ['round_of_16'] }
    case 'qf':    return { phases: ['quarterfinal'] }
    case 'sf':    return { phases: ['semifinal'] }
    case 'final': return { phases: ['final', 'third_place'] }
    default:      return { phases: ['group'] }
  }
}

// ── Admin toggle (protege master) ────────────────────────────
const MASTER_ADMIN_EMAIL = 'gmousinho@gmail.com'

export async function toggleAdmin(userId: string, current: boolean) {
  await requireAdmin()
  const supabase = await createAdminClient()

  // Não permite alterar o master admin
  const { data: target } = await supabase
    .from('users').select('email').eq('id', userId).single()
  if (target?.email === MASTER_ADMIN_EMAIL) throw new Error('O Admin Master não pode ser alterado')

  await supabase.from('users').update({ is_admin: !current }).eq('id', userId)
  revalidatePath('/admin/usuarios')
}

// ── Configurações de e-mail ───────────────────────────────────
export async function toggleEmailSetting(key: string, enabled: boolean) {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase
    .from('email_settings')
    .upsert({ key, enabled, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  revalidatePath('/admin/emails')
}

// ── Pagamento ─────────────────────────────────────────────────
export async function togglePaid(userId: string, current: boolean) {
  await requireAdmin()
  const supabase = await createAdminClient()
  await supabase.from('users').update({ paid: !current }).eq('id', userId)
  revalidatePath('/admin/usuarios')
}

// ── Resultado de partida + recálculo de pontos ────────────────
export async function saveMatchScore(
  matchId: string,
  scoreHome: number | null,
  scoreAway: number | null,
) {
  await requireAdmin()
  const supabase = await createAdminClient()

  // 1. Busca dados da partida e regras de pontuação em paralelo
  const [{ data: match }, { data: rulesData }] = await Promise.all([
    supabase.from('matches').select('is_brazil').eq('id', matchId).single(),
    supabase.from('scoring_rules').select('key, points'),
  ])

  const isBrazil = match?.is_brazil ?? false
  const rules: Rules = Object.fromEntries(
    (rulesData ?? []).map(r => [r.key, r.points])
  )

  // 2. Salva o placar
  const { error } = await supabase
    .from('matches')
    .update({ score_home: scoreHome, score_away: scoreAway })
    .eq('id', matchId)

  if (error) throw new Error(error.message)

  // 3. Recalcula pontos de todos os palpites desta partida
  if (scoreHome !== null && scoreAway !== null) {
    const { data: bets } = await supabase
      .from('bets').select('id, score_home, score_away').eq('match_id', matchId)

    if (bets?.length) {
      const totalBets  = bets.length
      const realResult = Math.sign(scoreHome - scoreAway)

      // Quantos apostaram no mesmo resultado (direção)
      const countSameResult = bets.filter(
        b => Math.sign(b.score_home - b.score_away) === realResult
      ).length

      // Zebra: ≤ percentual_zebra % apostaram no resultado real
      const zebraLimit = (rules.percentual_zebra ?? 15) / 100
      const isZebra    = totalBets > 0 && countSameResult / totalBets <= zebraLimit
      const multiplier = isBrazil ? (rules.multiplicador_brasil ?? 2) : 1
      const zebraBonus = isZebra ? (rules.bonus_zebra_jogo ?? 6) * multiplier : 0

      const updates = bets.map(bet => {
        const base   = calcBetPoints(bet.score_home, bet.score_away, scoreHome, scoreAway, isBrazil, rules)
        const points = base > 0 ? base + zebraBonus : 0
        return { id: bet.id, points }
      })

      await Promise.all(
        updates.map(({ id, points }) =>
          supabase.from('bets').update({ points }).eq('id', id)
        )
      )
    }
  } else {
    // Placar removido → apaga pontuação
    await supabase.from('bets').update({ points: null }).eq('match_id', matchId)
  }

  revalidatePath('/admin/jogos')
}

// ── Regra de pontuação (valores do banco, fallback hardcoded) ─
//
// Multiplicador Brasil é aplicado ao base. Bônus zebra é somado
// depois (em saveMatchScore) e também usa o multiplicador.
//
function calcBetPoints(
  betHome:  number,
  betAway:  number,
  realHome: number,
  realAway: number,
  isBrazil: boolean,
  rules: Rules,
): number {
  const betResult  = Math.sign(betHome  - betAway)
  const realResult = Math.sign(realHome - realAway)

  let base: number

  if (betHome === realHome && betAway === realAway) {
    base = rules.placar_exato ?? 12
  } else if (betResult !== realResult) {
    base = 0
  } else if (betResult === 0) {
    base = rules.empate_gols_errados ?? 7
  } else {
    const winnerBet  = betResult  > 0 ? betHome  : betAway
    const winnerReal = realResult > 0 ? realHome  : realAway
    const loserBet   = betResult  > 0 ? betAway  : betHome
    const loserReal  = realResult > 0 ? realAway  : realHome

    if (winnerBet === winnerReal) {
      base = rules.vencedor_gols_vencedor ?? 6
    } else if ((betHome - betAway) === (realHome - realAway)) {
      base = rules.vencedor_diferenca_gols ?? 5
    } else if (loserBet === loserReal) {
      base = rules.vencedor_gols_perdedor ?? 5
    } else {
      base = rules.somente_vencedor ?? 4
    }
  }

  const multiplier = isBrazil ? (rules.multiplicador_brasil ?? 2) : 1
  return base * multiplier
}
