// Server-only. Computes participant_points_by_day from current bet data.
// Full delete + reinsert on each call — safe for the dataset size.

import { createAuthAdminClient } from '@/lib/supabase/server'

function toBRDate(isoDatetime: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(isoDatetime))
}

interface DayRow {
  event_date:     string
  participant_id: string
  pts_matches:    number
  pts_groups:     number
  pts_thirds:     number
  pts_tournament: number
}

export async function recalculateDailyPoints(): Promise<{ count: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [
    { data: participants },
    { data: matches },
    { data: bets },
    { data: groupBets },
    { data: thirdBets },
    { data: tournamentBets },
  ] = await Promise.all([
    admin.from('participants').select('id'),
    admin.from('matches').select('id, phase, group_name, match_datetime'),
    admin.from('bets').select('participant_id, match_id, points'),
    admin.from('group_bets').select('participant_id, group_name, points'),
    admin.from('third_place_bets').select('participant_id, group_name, points'),
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

  // Group bets (attributed to last match date of that group)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (groupBets ?? []) as any[]) {
    const pts = (g.points ?? 0) as number
    if (!pts) continue
    const date = groupLastDate.get(g.group_name as string)
    if (!date) continue
    getRow(date, g.participant_id as string).pts_groups += pts
  }

  // Third-place bets (same date attribution as group bets)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (thirdBets ?? []) as any[]) {
    const pts = (t.points ?? 0) as number
    if (!pts) continue
    const date = groupLastDate.get(t.group_name as string)
    if (!date) continue
    getRow(date, t.participant_id as string).pts_thirds += pts
  }

  // Tournament bets (G4 + artilheiro) — attributed to date of the final
  if (finalDate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const tb of (tournamentBets ?? []) as any[]) {
      const pts = (tb.points ?? 0) as number
      if (!pts) continue
      getRow(finalDate, tb.participant_id as string).pts_tournament += pts
    }
  }

  const rows = [...acc.values()]

  // Full replace
  await admin.from('participant_points_by_day').delete().gte('event_date', '1900-01-01')

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('participant_points_by_day').insert(rows.slice(i, i + 500))
      if (error) throw new Error(error.message)
    }
  }

  return { count: rows.length }
}
