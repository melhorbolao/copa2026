export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { getActiveParticipantId } from '@/lib/participant'
import { getServerNow, getVisibilitySettings, isBonusVisible } from '@/lib/production-mode'
import { Navbar } from '@/components/layout/Navbar'
import { ArtilhariaClient } from './ArtilhariaClient'
import type { TopScorerItem } from './ArtilhariaClient'

export default async function ArtilhariaPage() {
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [participantId, { data: userProfile }] = await Promise.all([
    getActiveParticipantId(supabase, user.id).catch(() => null),
    supabase.from('users').select('is_admin').eq('id', user.id).single(),
  ])
  if (!participantId) redirect('/aguardando-aprovacao')

  const isAdmin = userProfile?.is_admin ?? false
  await requirePageAccess('artilharia', isAdmin)

  // ── Carrega dados em paralelo ─────────────────────────────────────────────
  const [
    serverNow,
    visSettings,
    { data: tBets },
    { data: mapping },
    { data: participants },
    { data: scores },
    { data: tSettings },
    { data: existingScorers },
    { data: firstMatch },
  ] = await Promise.all([
    getServerNow(),
    getVisibilitySettings(),
    admin.from('tournament_bets').select('participant_id, top_scorer'),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    admin.from('participants').select('id, apelido'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('tournament_settings').select('key, value').in('key', ['tournament_started']),
    admin.from('top_scorers').select('id, player_name, team, goals_count'),
    admin.from('matches').select('betting_deadline')
      .order('betting_deadline', { ascending: true }).limit(1),
  ])

  // ── Visibilidade (anti-spoiler) ───────────────────────────────────────────
  const bonusDeadline = (firstMatch as { betting_deadline: string }[] | null)?.[0]?.betting_deadline ?? null
  const showBettors = isBonusVisible(bonusDeadline, serverNow, visSettings, isAdmin)

  const tSettingsMap = Object.fromEntries(
    ((tSettings ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value])
  )
  const showPositions = tSettingsMap['tournament_started'] === 'true' && showBettors

  // ── Normalização de nomes via mapeamento ──────────────────────────────────
  const nameMap = Object.fromEntries(
    ((mapping ?? []) as { raw_name: string; standardized_name: string }[])
      .map(m => [m.raw_name, m.standardized_name ?? m.raw_name])
  )
  const normalize = (name: string) => nameMap[name] ?? name

  // ── Auto-seeding: insere jogadores apostados que ainda não estão na tabela ─
  const predictedNamesRaw: string[] = [
    ...new Set(
      ((tBets ?? []) as { top_scorer: string }[])
        .map(b => b.top_scorer)
        .filter(Boolean)
        .map(normalize)
    ),
  ]
  const existingNamesSet = new Set(
    ((existingScorers ?? []) as { player_name: string }[]).map(s => s.player_name.toLowerCase())
  )
  const toSeed = predictedNamesRaw.filter(n => !existingNamesSet.has(n.toLowerCase()))
  if (toSeed.length > 0) {
    await admin.from('top_scorers').insert(
      toSeed.map((name: string) => ({
        player_name: name,
        team: '',
        goals_count: 0,
        updated_by: user.id,
      }))
    )
  }

  // ── Recarrega lista final após seeding ────────────────────────────────────
  const { data: allScorers } = await admin
    .from('top_scorers')
    .select('id, player_name, team, goals_count')
    .order('goals_count', { ascending: false })
    .order('player_name', { ascending: true })

  // ── Monta mapa apostador → posição ────────────────────────────────────────
  const scorerBettors: Record<string, { apelido: string; position: number | null }[]> = {}

  if (showBettors) {
    const sortedScores = [...((scores ?? []) as { participant_id: string; pts_total: number }[])]
      .sort((a, b) => (b.pts_total ?? 0) - (a.pts_total ?? 0))
    const positionMap: Record<string, number> = {}
    sortedScores.forEach((s, i) => { positionMap[s.participant_id] = i + 1 })

    const participantMap = Object.fromEntries(
      ((participants ?? []) as { id: string; apelido: string }[]).map(p => [p.id, p.apelido])
    )

    for (const bet of (tBets ?? []) as { participant_id: string; top_scorer: string }[]) {
      if (!bet.top_scorer) continue
      const normalizedName = normalize(bet.top_scorer)
      if (!scorerBettors[normalizedName]) scorerBettors[normalizedName] = []
      scorerBettors[normalizedName].push({
        apelido: participantMap[bet.participant_id] ?? '?',
        position: showPositions ? (positionMap[bet.participant_id] ?? null) : null,
      })
    }

    for (const key in scorerBettors) {
      scorerBettors[key].sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'))
    }
  }

  // ── Monta lista final com apostadores ────────────────────────────────────
  const scorersWithBettors: TopScorerItem[] = (
    (allScorers ?? []) as { id: string; player_name: string; team: string; goals_count: number }[]
  ).map(s => ({
    id: s.id,
    player_name: s.player_name,
    team: s.team,
    goals_count: s.goals_count,
    bettors: scorerBettors[s.player_name] ?? [],
  }))

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ArtilhariaClient
          initialScorers={scorersWithBettors}
          showBettors={showBettors}
          showPositions={showPositions}
        />
      </div>
    </>
  )
}
