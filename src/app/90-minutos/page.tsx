export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { getActiveParticipantId } from '@/lib/participant'
import { Navbar } from '@/components/layout/Navbar'
import { NinetyMinClient } from './NinetyMinClient'
import type { MatchWith90, BetRaw, Participant } from './NinetyMinClient'

export const metadata = { title: 'Universo 90\' — Bolão Copa' }

export default async function NinetyMinPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_admin, role')
    .eq('id', user.id)
    .single()
  const isAdmin = profile?.is_admin ?? false

  await requirePageAccess('90-minutos', profile?.role ?? 'user')

  const admin = createAuthAdminClient() as any

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)

  // ── Matches (uma única chamada: LEFT JOIN via nested select) ──────────────
  const { data: matchesRaw } = await supabase
    .from('matches')
    .select(`
      id, match_number, phase, round, group_name,
      team_home, team_away, flag_home, flag_away,
      match_datetime, city, score_home, score_away,
      penalty_winner, is_brazil, betting_deadline,
      match_90min_results ( score_home_90min, score_away_90min )
    `)
    .order('match_datetime', { ascending: true })
    .then((r: any) => r, () => ({ data: [] }))

  const matches: MatchWith90[] = (matchesRaw ?? []).map((m: any) => {
    const r90 = Array.isArray(m.match_90min_results)
      ? m.match_90min_results[0]
      : m.match_90min_results
    return {
      id:              m.id,
      match_number:    m.match_number,
      phase:           m.phase,
      round:           m.round,
      group_name:      m.group_name,
      team_home:       m.team_home,
      team_away:       m.team_away,
      flag_home:       m.flag_home,
      flag_away:       m.flag_away,
      match_datetime:  m.match_datetime,
      city:            m.city,
      score_home:      m.score_home,
      score_away:      m.score_away,
      penalty_winner:  m.penalty_winner,
      is_brazil:       m.is_brazil,
      betting_deadline: m.betting_deadline,
      score_home_90min: r90?.score_home_90min ?? null,
      score_away_90min: r90?.score_away_90min ?? null,
    }
  })

  // ── Bets (admin bypassa RLS para ver todas) ───────────────────────────────
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
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

  const [betsRaw, participantsRaw, rulesRaw, settingsRaw] = await Promise.all([
    fetchAll('bets', 'participant_id, match_id, score_home, score_away'),
    supabase.from('participants').select('id, apelido').order('apelido'),
    supabase.from('scoring_rules').select('key, points'),
    admin.from('tournament_settings').select('key, value').in('key', ['premio_spots']),
  ])

  const bets        = betsRaw as BetRaw[]
  const participants = (participantsRaw.data ?? []) as Participant[]
  const rules: Record<string, number> = Object.fromEntries(
    (rulesRaw.data ?? []).map((r: any) => [r.key, r.points])
  )

  let premioSpots = 10
  for (const row of (settingsRaw.data ?? []) as { key: string; value: string }[]) {
    const n = parseInt(row.value, 10)
    if (!isNaN(n) && n > 0 && row.key === 'premio_spots') premioSpots = n
  }

  return (
    <>
      <Navbar />
      <NinetyMinClient
        isAdmin={isAdmin}
        userId={user.id}
        activeParticipantId={activeParticipantId ?? ''}
        matches={matches}
        bets={bets}
        participants={participants}
        rules={rules}
        premioSpots={premioSpots}
      />
    </>
  )
}
