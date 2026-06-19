// Server-only. Computes participant_points_by_day from current bet data.
// Full delete + reinsert on each call — safe for the dataset size.

import { createAuthAdminClient } from '@/lib/supabase/server'

// UTC-6: jogos que começam às 1h ou 2h BRT são atribuídos ao dia anterior no bolão
function toBRDate(isoDatetime: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Etc/GMT+6' }).format(new Date(isoDatetime))
}

interface DayRow {
  event_date:     string
  participant_id: string
  pts_matches:    number
  pts_groups:     number
  pts_thirds:     number
  pts_tournament: number
}

export async function recalculateDailyPoints(options?: { upToDate?: string }): Promise<{ count: number }> {
  const upToDate = options?.upToDate
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
    { data: tournamentBets },
  ] = await Promise.all([
    admin.from('participants').select('id'),
    admin.from('matches').select('id, phase, group_name, match_datetime'),
    fetchAll('bets', 'participant_id, match_id, points'),
    fetchAll('group_bets', 'participant_id, group_name, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, points'),
    admin.from('tournament_bets').select('participant_id, points'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allIds: string[] = (participants ?? []).map((p: any) => p.id as string)
  if (allIds.length === 0) return { count: 0 }

  // Index: matchId → { date, phase, group_name }
  const matchInfo = new Map<string, { date: string; phase: string; group_name: string | null }>()
  // Index: group_name → date of last match in that group
  const groupLastDate = new Map<string, string>()
  let finalDate: string | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of (matches ?? []) as any[]) {
    const date = toBRDate(m.match_datetime as string)
    matchInfo.set(m.id as string, { date, phase: m.phase as string, group_name: m.group_name as string | null })
    if (m.phase === 'group' && m.group_name) {
      const prev = groupLastDate.get(m.group_name as string)
      if (!prev || date > prev) groupLastDate.set(m.group_name as string, date)
    }
    if (m.phase === 'final') {
      if (!finalDate || date > finalDate) finalDate = date
    }
  }

  // Accumulator: key = "date:pid"
  const acc = new Map<string, DayRow>()

  function getRow(date: string, pid: string): DayRow {
    const key = `${date}:${pid}`
    let row = acc.get(key)
    if (!row) {
      row = { event_date: date, participant_id: pid, pts_matches: 0, pts_groups: 0, pts_thirds: 0, pts_tournament: 0 }
      acc.set(key, row)
    }
    return row
  }

  // Match bets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of (bets ?? []) as any[]) {
    const pts = (b.points ?? 0) as number
    if (!pts) continue
    const info = matchInfo.get(b.match_id as string)
    if (!info) continue
    getRow(info.date, b.participant_id as string).pts_matches += pts
  }

  // Quando upToDate é fornecido, pontos atribuídos a datas futuras (ex: última partida do grupo
  // que ainda não ocorreu, ou data da final) são "antecipados" para upToDate em vez de serem
  // descartados. Isso garante que o acumulado histórico até upToDate coincida com participant_scores.
  // Quando a data natural chegar (<= upToDate), o ponto volta à posição correta naturalmente.
  function cap(date: string): string {
    return upToDate && date > upToDate ? upToDate : date
  }

  // Group bets (attributed to last match date of that group, capped at upToDate)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (groupBets ?? []) as any[]) {
    const pts = (g.points ?? 0) as number
    if (!pts) continue
    const naturalDate = groupLastDate.get(g.group_name as string)
    if (!naturalDate) continue
    getRow(cap(naturalDate), g.participant_id as string).pts_groups += pts
  }

  // Third-place bets (same date attribution as group bets, capped at upToDate)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (thirdBets ?? []) as any[]) {
    const pts = (t.points ?? 0) as number
    if (!pts) continue
    const naturalDate = groupLastDate.get(t.group_name as string)
    if (!naturalDate) continue
    getRow(cap(naturalDate), t.participant_id as string).pts_thirds += pts
  }

  // Tournament bets (G4 + artilheiro) — attributed to date of the final, capped at upToDate
  // Se a final ainda não ocorreu (finalDate > upToDate ou sem final cadastrada), usa upToDate.
  const effectiveFinalDate = finalDate
    ? cap(finalDate)
    : upToDate  // sem final no calendário: atribui a upToDate
  if (effectiveFinalDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tb of (tournamentBets ?? []) as any[]) {
      const pts = (tb.points ?? 0) as number
      if (!pts) continue
      getRow(effectiveFinalDate, tb.participant_id as string).pts_tournament += pts
    }
  }

  // Se upToDate fornecido, descarta linhas de datas futuras (evita dados parciais do dia)
  const rows = upToDate
    ? [...acc.values()].filter(r => r.event_date <= upToDate)
    : [...acc.values()]

  // Full replace — usa UPSERT para sobreviver a chamadas concorrentes:
  // se duas execuções simultâneas derem DELETE ao mesmo tempo e ambas tentarem
  // inserir as mesmas linhas, o UPSERT faz UPDATE em vez de criar duplicatas.
  // Requer constraint UNIQUE (event_date, participant_id) no banco.
  await admin.from('participant_points_by_day').delete().gte('event_date', '1900-01-01')

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from('participant_points_by_day')
        .upsert(rows.slice(i, i + 500), { onConflict: 'event_date,participant_id' })
      if (error) throw new Error(error.message)
    }
  }

  return { count: rows.length }
}
