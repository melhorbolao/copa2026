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
    { data: artilhRule },
  ] = await Promise.all([
    getServerNow(),
    getVisibilitySettings(),
    admin.from('tournament_bets').select('participant_id, top_scorer'),
    admin.from('top_scorer_mapping').select('raw_name, standardized_name'),
    admin.from('participants').select('id, apelido'),
    admin.from('participant_scores').select('participant_id, pts_total'),
    admin.from('tournament_settings').select('key, value').in('key', ['tournament_started', 'artillary_points_active']),
    admin.from('top_scorers').select('id, player_name, team, goals_count, photo_url'),
    admin.from('matches').select('betting_deadline')
      .order('betting_deadline', { ascending: true }).limit(1),
    supabase.from('scoring_rules').select('points').eq('key', 'artilheiro').maybeSingle(),
  ])

  // ── Visibilidade (anti-spoiler) ───────────────────────────────────────────
  const bonusDeadline = (firstMatch as { betting_deadline: string }[] | null)?.[0]?.betting_deadline ?? null
  const showBettors = isBonusVisible(bonusDeadline, serverNow, visSettings, isAdmin)

  const tSettingsMap = Object.fromEntries(
    ((tSettings ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value])
  )
  const hasRealScores = ((scores ?? []) as { pts_total: number }[]).some(s => (s.pts_total ?? 0) > 0)
  const showPositions = tSettingsMap['tournament_started'] === 'true' && showBettors && hasRealScores
  const artillaryPointsActive = tSettingsMap['artillary_points_active'] === 'true'
  const artilheiroPoints = (artilhRule as { points: number } | null)?.points ?? 18

  // ── Normalização de nomes via mapeamento ──────────────────────────────────
  const mappingRows = (mapping ?? []) as { raw_name: string; standardized_name: string | null }[]
  // Constrói nameMap ignorando entradas com standardized_name nulo ou trivial (alias = canônico)
  const nameMap: Record<string, string> = {}
  for (const m of mappingRows) {
    const key = m.raw_name.toLowerCase().trim()
    const val = (m.standardized_name ?? '').trim()
    if (val && val.toLowerCase() !== key) nameMap[key] = val
  }
  const normalize = (name: string) => nameMap[name.toLowerCase().trim()] ?? name

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
  const toSeedFromBets = predictedNamesRaw.filter(n => !existingNamesSet.has(n.toLowerCase()))
  // Garante que aliases já no banco tenham o nome canônico inserido
  const toSeedCanonicals = ((existingScorers ?? []) as { player_name: string }[])
    .flatMap(s => {
      const canonical = nameMap[s.player_name.toLowerCase().trim()]
      return canonical && !existingNamesSet.has(canonical.toLowerCase()) ? [canonical] : []
    })
  const toSeed = [...new Set([...toSeedFromBets, ...toSeedCanonicals])]
  if (toSeed.length > 0) {
    // Ignora erros: o índice único no banco rejeita corridas concorrentes silenciosamente.
    await admin.from('top_scorers').insert(
      toSeed.map((name: string) => ({
        player_name: name,
        team: '',
        goals_count: 0,
        updated_by: user.id,
      }))
    ).then(() => null, () => null)
  }

  // ── Recarrega lista final após seeding ────────────────────────────────────
  const { data: allScorers } = await admin
    .from('top_scorers')
    .select('id, player_name, team, goals_count, photo_url')
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
      const betKey = normalizedName.toLowerCase().trim()  // lowercase: consistente com mergeKey
      if (!scorerBettors[betKey]) scorerBettors[betKey] = []
      scorerBettors[betKey].push({
        apelido: participantMap[bet.participant_id] ?? '?',
        position: showPositions ? (positionMap[bet.participant_id] ?? null) : null,
      })
    }

    for (const key in scorerBettors) {
      scorerBettors[key].sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'))
    }
  }

  // ── Monta lista final com apostadores (mescla duplicatas pelo nome normalizado, case-insensitive) ──
  const mergedMap = new Map<string, TopScorerItem>()
  for (const s of (allScorers ?? []) as { id: string; player_name: string; team: string; goals_count: number; photo_url?: string }[]) {
    const displayName = normalize(s.player_name)
    const mergeKey = displayName.toLowerCase().trim()  // chave case-insensitive evita duplicatas de capitalização
    const existing = mergedMap.get(mergeKey)
    if (!existing) {
      mergedMap.set(mergeKey, {
        id: s.id,
        player_name: displayName,
        team: s.team || '',
        goals_count: s.goals_count,
        photo_url: s.photo_url ?? undefined,
        bettors: scorerBettors[mergeKey] ?? [],  // usa mergeKey (lowercase) para achar apostadores
      })
    } else {
      // Mantém o maior goals_count; prioriza a entrada que tem foto; usa nome do entry mais completo
      const useThis = s.goals_count > existing.goals_count || (!existing.photo_url && s.photo_url)
      if (useThis) {
        mergedMap.set(mergeKey, {
          ...existing,
          player_name: displayName,
          team: s.team || existing.team || '',
          goals_count: Math.max(existing.goals_count, s.goals_count),
          photo_url: s.photo_url ?? existing.photo_url ?? undefined,
          bettors: scorerBettors[mergeKey] ?? existing.bettors,
        })
      }
    }
  }
  // Remove aliases que escaparam do merge (player_name é raw_name conhecido com canônico diferente)
  const knownAliases = new Set(Object.keys(nameMap))
  const scorersWithBettors: TopScorerItem[] = [...mergedMap.values()]
    .filter(s => !knownAliases.has(s.player_name.toLowerCase().trim()))
    .sort((a, b) =>
      b.goals_count - a.goals_count ||
      b.bettors.length - a.bettors.length ||
      a.player_name.localeCompare(b.player_name, 'pt-BR')
    )

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ArtilhariaClient
          initialScorers={scorersWithBettors}
          showBettors={showBettors}
          showPositions={showPositions}
          isAdmin={isAdmin}
          artillaryPointsActive={artillaryPointsActive}
          artilheiroPoints={artilheiroPoints}
        />
      </div>
    </>
  )
}
