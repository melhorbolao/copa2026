export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { MatchBetRow } from './MatchBetRow'
import { GroupBetRow } from './GroupBetRow'
import { TournamentSection } from './TournamentSection'
import { ThirdPlaceSection } from './ThirdPlaceSection'
import { GroupFilter } from './GroupFilter'
import { StageFilter } from './StageFilter'
import { ThirdPlaceProvider } from './ThirdPlaceContext'
import { Countdown } from './Countdown'
import { ExcelActions } from './ExcelActions'
import { RoundProgress } from './RoundProgress'
import { StickyStats } from './StickyStats'
import { AutoFillButton } from './AutoFillButton'
import { formatBrasilia } from '@/utils/date'
import type { MatchPhase } from '@/types/database'
import { calcGroupStandings, rankThirds, resolveThirdSlots, buildR32Teams, buildKnockoutTeamMap, R32_MATCHES } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

// Mapeamento etapa → phase(s) do banco
const ETAPA_TO_PHASES: Record<string, MatchPhase[]> = {
  r32:   ['round_of_32'],
  r16:   ['round_of_16'],
  qf:    ['quarterfinal'],
  sf:    ['semifinal'],
  final: ['third_place', 'final'],
}

const PHASE_LABELS: Partial<Record<MatchPhase, string>> = {
  round_of_32:  'Rodada de 32',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar e Final',
  final:        '3º Lugar e Final',
}

const KNOCKOUT_PHASES: MatchPhase[] = [
  'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final',
]

// Etapas de mata-mata
const KNOCKOUT_ETAPAS = new Set(['r32', 'r16', 'qf', 'sf', 'final'])

export default async function PalpitesPage({
  searchParams,
}: {
  searchParams: Promise<{ grupo?: string; etapa?: string }>
}) {
  const { grupo, etapa } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  const { data: userProfile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  await requirePageAccess('palpites', userProfile?.is_admin ?? false)

  const admin = createAuthAdminClient()

  const [{ data: matches }, { data: bets }, { data: groupBets }, { data: tBet }, scorerMappingsRaw] = await Promise.all([
    supabase.from('matches').select('id, match_number, phase, group_name, round, team_home, team_away, flag_home, flag_away, match_datetime, city, betting_deadline, score_home, score_away, is_brazil').order('match_datetime', { ascending: true }),
    supabase.from('bets').select('match_id, score_home, score_away, points').eq('participant_id', participantId),
    supabase.from('group_bets').select('group_name, first_place, second_place, points').eq('participant_id', participantId),
    supabase.from('tournament_bets')
      .select('champion, runner_up, semi1, semi2, top_scorer, points')
      .eq('participant_id', participantId)
      .maybeSingle(),
    supabase.from('top_scorer_mapping').select('raw_name, standardized_name').then(r => r.data ?? [], () => []),
  ])

  // Admin client para contornar RLS em third_place_bets (tabela sem política SELECT explícita)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thirdBetsResult = await (admin as any)
    .from('third_place_bets')
    .select('group_name, team, points')
    .eq('participant_id', participantId)
  if (thirdBetsResult.error) console.error('[palpites/page] third_place_bets SELECT error:', thirdBetsResult.error)
  const thirdBets = (thirdBetsResult.data ?? []) as { group_name: string; team: string; points: number | null }[]

  const thirdPts: number = await supabase
    .from('scoring_rules').select('points').eq('key', 'terceiro_classificado').maybeSingle()
    .then(r => r.data?.points ?? 3, () => 3)

  const scorerMapping: Record<string, string> = Object.fromEntries(
    (scorerMappingsRaw as { raw_name: string; standardized_name: string }[]).map(m => [m.raw_name, m.standardized_name])
  )

  const betMap      = new Map((bets ?? []).map(b => [b.match_id, b]))
  const groupBetMap = new Map((groupBets ?? []).map(b => [b.group_name, b]))

  // Classificação calculada com base nos palpites de placar — usada para detectar divergências
  const slimBetMap = new Map<string, BetSlim>(
    (bets ?? []).map(b => [b.match_id, { match_id: b.match_id, score_home: b.score_home ?? 0, score_away: b.score_away ?? 0 }])
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slimGroupMatches: MatchSlim[] = ((matches ?? []) as any[])
    .filter((m: any) => m.phase === 'group')
    .map((m: any) => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away,
      flag_home: m.flag_home, flag_away: m.flag_away,
    }))
  const calculatedStandings = calcGroupStandings(slimGroupMatches, slimBetMap)
  const calculatedTopPerGroup: Record<string, { first: string; second: string; third: string; tiedTeams: string[] }> =
    Object.fromEntries(
      calculatedStandings.map(s => [
        s.group,
        {
          first: s.teams[0]?.team ?? '',
          second: s.teams[1]?.team ?? '',
          third: s.teams[2]?.team ?? '',
          tiedTeams: s.tiedTeams ?? [],
        },
      ])
    )

  const groupMatches    = (matches ?? []).filter(m => m.phase === 'group')
  const knockoutMatches = (matches ?? []).filter(m => m.phase !== 'group')

  // Resolve team names for knockout matches from official group standings
  const officialScoreMap = new Map<string, BetSlim>(
    groupMatches
      .filter(m => m.score_home !== null && m.score_away !== null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => [m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away }])
  )
  const officialStandings  = calcGroupStandings(slimGroupMatches, officialScoreMap)
  const officialThirdTeams: Record<string, string> = {}
  for (const s of officialStandings) {
    if (s.teams[2]?.team) officialThirdTeams[s.group] = s.teams[2].team
  }
  const officialThirds    = rankThirds(officialStandings)
  const officialThirdSlots = resolveThirdSlots(officialThirds)
  const officialR32Slots  = officialThirdSlots
    ? buildR32Teams(officialStandings, officialThirds, officialThirdSlots)
    : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knockoutTeamMap = buildKnockoutTeamMap(officialR32Slots, knockoutMatches as any)

  const r32LabelMap = new Map<number, { labelA: string; labelB: string }>()
  R32_MATCHES.forEach((m, i) => {
    const num = parseInt(m.matchNum.slice(1), 10)
    const slot = officialR32Slots[i]
    if (slot) r32LabelMap.set(num, { labelA: slot.labelA, labelB: slot.labelB })
  })

  // Mapa grupo → {teams, deadline}
  type TeamEntry = { team: string; flag: string }
  const groupTeams: Record<string, { teams: TeamEntry[]; deadline: string }> = {}
  for (const m of groupMatches) {
    if (!m.group_name) continue
    const g = m.group_name as string
    if (!groupTeams[g]) groupTeams[g] = { teams: [], deadline: m.betting_deadline }
    for (const [team, flag] of [[m.team_home, m.flag_home], [m.team_away, m.flag_away]] as [string,string][]) {
      if (team !== 'TBD' && !groupTeams[g].teams.find(t => t.team === team)) {
        groupTeams[g].teams.push({ team, flag })
      }
    }
  }

  // Todos os times para o formulário de torneio
  const seen = new Set<string>()
  const allTeams: TeamEntry[] = []
  for (const g of GROUP_ORDER) {
    for (const t of groupTeams[g]?.teams ?? []) {
      if (!seen.has(t.team)) { seen.add(t.team); allTeams.push(t) }
    }
  }
  allTeams.sort((a, b) => a.team.localeCompare(b.team, 'pt'))

  const tournamentDeadline = groupMatches[0]?.betting_deadline ?? new Date().toISOString()

  // Mata-mata agrupado por fase
  const knockoutByPhase: Partial<Record<MatchPhase, typeof knockoutMatches>> = {}
  for (const m of knockoutMatches) {
    const p = m.phase as MatchPhase
    if (!knockoutByPhase[p]) knockoutByPhase[p] = []
    knockoutByPhase[p]!.push(m)
  }

  // ── Filtros ────────────────────────────────────────────────────
  const isKnockoutEtapa = etapa ? KNOCKOUT_ETAPAS.has(etapa) : false
  const isGroupEtapa    = !etapa || etapa === 'r1' || etapa === 'r2' || etapa === 'r3'
  const groupRound      = etapa === 'r1' ? 1 : etapa === 'r2' ? 2 : etapa === 'r3' ? 3 : null

  // Partidas de grupo visíveis
  let visibleGroupMatches = groupMatches
  if (groupRound !== null) visibleGroupMatches = visibleGroupMatches.filter(m => m.round === groupRound)
  if (grupo)               visibleGroupMatches = visibleGroupMatches.filter(m => m.group_name === grupo)
  if (isKnockoutEtapa)     visibleGroupMatches = []

  // Grupos visíveis para apostas de classificação
  // Bônus (group bets + tournament) aparecem apenas em "Todos" ou "Rodada 1"
  const showBonusBets = !etapa || etapa === 'r1'
  const visibleGroupOrder = grupo
    ? GROUP_ORDER.filter(g => g === grupo)
    : GROUP_ORDER

  // Fases de mata-mata visíveis
  const visibleKnockoutPhases = isKnockoutEtapa && etapa
    ? ETAPA_TO_PHASES[etapa] ?? []
    : isGroupEtapa
      ? []            // filtrando por rodada de grupo → oculta mata-mata
      : KNOCKOUT_PHASES // "Todos" → mostra tudo

  // ── Contadores ─────────────────────────────────────────────────
  const totalMatches   = matches?.length ?? 0
  const totalBets      = bets?.length ?? 0
  // Conta apenas grupos com 1º e 2º realmente preenchidos
  const totalGroupBets = (groupBets ?? []).filter(b => b.first_place && b.second_place).length

  // Rodada ativa: filtro selecionado ou próxima com prazo aberto
  const now = new Date()
  const activeRound: number | null = groupRound ?? (() => {
    for (const r of [1, 2, 3]) {
      const m = groupMatches.find(m => m.round === r)
      if (m && new Date(m.betting_deadline) > now) return r
    }
    return null
  })()
  const activeRoundIds   = activeRound
    ? new Set(groupMatches.filter(m => m.round === activeRound).map(m => m.id))
    : new Set<string>()
  const activeRoundTotal = activeRoundIds.size
  const activeRoundBets  = (bets ?? []).filter(b => activeRoundIds.has(b.match_id)).length

  // Auto-fill flags — só habilita se todos os placares (score_home e score_away) estiverem preenchidos
  const groupMatchIds = new Set(groupMatches.map(m => m.id))
  const groupBetCount = (bets ?? []).filter(b =>
    groupMatchIds.has(b.match_id) && b.score_home !== null && b.score_away !== null
  ).length
  const allGroupsFilled = groupMatches.length > 0 && groupBetCount >= groupMatches.length

  const alreadyFilled = (groupBets ?? []).filter(b => b.first_place && b.second_place).length > 0
    || (thirdBets ?? []).length > 0

  // Contadores bônus granulares — ignora valores vazios
  const thirdCount = (thirdBets ?? []).filter(b => b.team && b.team.trim().length > 0).length
  const bonusCount = tBet
    ? [tBet.champion, tBet.runner_up, tBet.semi1, tBet.semi2, tBet.top_scorer]
        .filter(v => v && String(v).length > 0).length
    : 0

  // Para R1, o progresso inclui todos os 25 campos bônus (mesmo critério da aba Participantes)
  const r1ProgressFilled = activeRound === 1
    ? activeRoundBets + bonusCount + Math.min(totalGroupBets, 12) + Math.min(thirdCount, 8)
    : activeRoundBets
  const r1ProgressTotal = activeRound === 1
    ? activeRoundTotal + 5 + 12 + 8
    : activeRoundTotal

  // ── Próximo prazo ───────────────────────────────────────────────
  const DEADLINE_LABELS: Record<string, string> = {
    group_1: 'Rodada 1', group_2: 'Rodada 2', group_3: 'Rodada 3',
    round_of_32: '16 avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
    semifinal: 'Semifinal', third_place: 'Final', final: 'Final',
  }
  const upcomingDeadlines = (matches ?? [])
    .filter(m => new Date(m.betting_deadline) > now)
    .sort((a, b) => new Date(a.betting_deadline).getTime() - new Date(b.betting_deadline).getTime())
  const nextMatch = upcomingDeadlines[0]
  const nextDeadline = nextMatch ? {
    iso: nextMatch.betting_deadline,
    label: nextMatch.phase === 'group'
      ? (DEADLINE_LABELS[`group_${nextMatch.round}`] ?? 'Rodada')
      : (DEADLINE_LABELS[nextMatch.phase] ?? 'Próxima etapa'),
  } : null

  const tableHead = (
    <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
      <tr>
        <th className="px-1.5 py-2 text-left w-8 sm:px-3 sm:w-12">#</th>
        <th className="w-20 px-1.5 py-2 text-right sm:w-auto sm:px-3">Sel. A</th>
        <th className="px-1 py-2 text-center w-[4.5rem] sm:px-3 sm:w-32">Palpite</th>
        <th className="w-20 px-1.5 py-2 text-left sm:w-auto sm:px-3">Sel. B</th>
        <th className="hidden px-3 py-2 text-left sm:table-cell">Data · Cidade</th>
        <th className="hidden px-3 py-2 text-left sm:table-cell">Prazo</th>
        <th className="px-1.5 py-2 text-right w-10 sm:px-3 sm:w-16">Pts</th>
      </tr>
    </thead>
  )

  const hasAnything =
    visibleGroupMatches.length > 0 ||
    (showBonusBets && visibleGroupOrder.some(g => groupTeams[g])) ||
    visibleKnockoutPhases.some(p => knockoutByPhase[p as MatchPhase]?.length)

  return (
    <>
      <Navbar />
      <StickyStats
        totalBets={totalBets}
        totalMatches={totalMatches}
        activeRoundBets={activeRoundBets}
        activeRoundTotal={activeRoundTotal}
        activeRound={activeRound}
        totalGroupBets={totalGroupBets}
        thirdCount={thirdCount}
        bonusCount={bonusCount}
      />
      <div className="mx-auto max-w-5xl px-4 py-6 pb-32">

        {/* Cabeçalho */}
        <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Meus Palpites</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Jogos · classificação de grupos · torneio
            </p>
            <div className="mt-2">
              <ExcelActions />
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {nextDeadline && (
              <Countdown deadline={nextDeadline.iso} label={nextDeadline.label} />
            )}
            {activeRound !== null && !isKnockoutEtapa && (
              <RoundProgress
                filled={r1ProgressFilled}
                total={r1ProgressTotal}
                round={activeRound}
              />
            )}
          </div>
        </div>

        {/* Filtros */}
        <div className="mb-2 space-y-1.5">
          <Suspense fallback={null}>
            <StageFilter />
          </Suspense>
          {isGroupEtapa && (
            <Suspense fallback={null}>
              <GroupFilter />
            </Suspense>
          )}
        </div>

        <ThirdPlaceProvider
          initial={Object.fromEntries((thirdBets ?? []).map(b => [b.group_name, b.team]))}
        >
        {totalMatches === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
            <p className="text-4xl mb-3">⚽</p>
            <p className="font-bold text-gray-700">Nenhuma partida cadastrada</p>
            <p className="mt-1 text-sm text-gray-400">O admin precisa cadastrar as partidas.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full">
                {tableHead}
                <tbody>

                  {/* ── FASE DE GRUPOS ──────────────────────── */}
                  {visibleGroupMatches.length > 0 && (
                    <SectionRow label={
                      groupRound ? `Fase de Grupos — Rodada ${groupRound}` : 'Fase de Grupos'
                    } />
                  )}
                  {visibleGroupMatches.map(m => (
                    <MatchBetRow key={m.id} match={m} bet={betMap.get(m.id) ?? null} />
                  ))}

                  {/* ── BOTÃO AUTO-PREENCHIMENTO ────────────── */}
                  {visibleGroupMatches.length > 0 && (
                    <AutoFillButton
                      enabled={allGroupsFilled}
                      alreadyFilled={alreadyFilled}
                    />
                  )}

                  {/* ── CLASSIFICAÇÃO DOS GRUPOS (bônus) ─────── */}
                  {showBonusBets && visibleGroupOrder.some(g => groupTeams[g]) && (
                    <SectionRow
                      label="Classificação dos Grupos"
                      deadline={tournamentDeadline}
                      sub
                    />
                  )}
                  {showBonusBets && visibleGroupOrder.map(g => {
                    const data = groupTeams[g]
                    if (!data) return null
                    return (
                      <GroupBetRow
                        key={g}
                        groupName={g}
                        teams={data.teams}
                        deadline={data.deadline}
                        existingBet={groupBetMap.get(g) ?? null}
                        calculatedTop={calculatedTopPerGroup[g]}
                        userId={participantId}
                      />
                    )
                  })}

                  {/* ── MATA-MATA ──────────────────────────────── */}
                  {visibleKnockoutPhases.map(phase => {
                    const phaseMatches = knockoutByPhase[phase]
                    if (!phaseMatches?.length) return null
                    const resolvedMatches = phaseMatches.map(m => ({
                      ...m, ...(knockoutTeamMap.get(m.id) ?? {}),
                    }))
                    const isR32 = phase === 'round_of_32'
                    if (phase === 'final') return (
                      resolvedMatches.map(m => (
                        <MatchBetRow key={m.id} match={m} bet={betMap.get(m.id) ?? null} />
                      ))
                    )
                    return (
                      <>
                        <SectionRow key={`hdr-${phase}`} label={PHASE_LABELS[phase]!} />
                        {resolvedMatches.map(m => {
                          const r32Labels = isR32 ? r32LabelMap.get(m.match_number) : undefined
                          return (
                            <MatchBetRow
                              key={m.id}
                              match={m}
                              bet={betMap.get(m.id) ?? null}
                              slotLabelHome={r32Labels?.labelA}
                              slotLabelAway={r32Labels?.labelB}
                            />
                          )
                        })}
                      </>
                    )
                  })}

                  {/* Estado vazio */}
                  {!hasAnything && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-sm text-gray-400">
                        Nenhuma partida nesta etapa.
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </div>

            {/* Terceiros Classificados (apenas em "Todos", "Rodada 1" ou filtro de grupo) */}
            {showBonusBets && (
              <ThirdPlaceSection
                groupTeams={groupTeams}
                deadline={tournamentDeadline}
                existingBets={thirdBets ?? null}
                groupBets={Object.fromEntries(groupBetMap)}
                calculatedThirds={Object.fromEntries(
                  Object.entries(calculatedTopPerGroup).map(([g, t]) => [g, { third: t.third, tiedTeams: t.tiedTeams }])
                )}
                officialThirdTeams={officialThirdTeams}
                thirdPts={thirdPts}
              />
            )}

            {/* Aposta de Torneio (apenas em "Todos" ou "Rodada 1") */}
            {showBonusBets && !grupo && (
              <TournamentSection
                allTeams={allTeams}
                deadline={tournamentDeadline}
                existingBet={tBet ?? null}
                scorerMapping={scorerMapping}
              />
            )}

            {/* Link para Minha Tabela — sempre visível independente dos filtros */}
            <div className="mt-2 text-center">
              <a
                href="/tabela"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline"
              >
                📊 Veja aqui a classificação com base nos seus palpites
              </a>
            </div>
          </div>
        )}
        </ThirdPlaceProvider>
      </div>
    </>
  )
}

function SectionRow({ label, deadline, sub }: { label: string; deadline?: string; sub?: boolean }) {
  return (
    <tr>
      <td colSpan={7} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border-b border-t ${
        sub
          ? 'bg-blue-50 text-blue-400 border-blue-100'
          : 'bg-gray-800 text-gray-300 border-gray-700'
      }`}>
        <span className="flex items-center justify-between gap-2">
          <span>{label}</span>
          {deadline && (
            <span className={`font-normal normal-case tracking-normal ${sub ? 'text-blue-400' : 'text-gray-400'}`}>
              Prazo: {formatBrasilia(deadline, "dd/MM 'às' HH:mm")}
            </span>
          )}
        </span>
      </td>
    </tr>
  )
}
