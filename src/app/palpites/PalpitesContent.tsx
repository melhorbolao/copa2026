'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { StickyStats } from './StickyStats'
import { Countdown } from './Countdown'
import { RoundProgress } from './RoundProgress'
import { StageFilter } from './StageFilter'
import { GroupFilter } from './GroupFilter'
import { MatchBetRow } from './MatchBetRow'
import { GroupBetRow } from './GroupBetRow'
import { TournamentSection } from './TournamentSection'
import { ThirdPlaceSection } from './ThirdPlaceSection'
import { ThirdPlaceProvider } from './ThirdPlaceContext'
import { AutoFillButton } from './AutoFillButton'
import { BetSaveQueueProvider, useBetSaveQueue } from './BetSaveQueueContext'
import type { CalcGroupStanding } from '@/lib/bracket/engine'
import { formatBrasilia } from '@/utils/date'
import type { MatchPhase } from '@/types/database'
import type { TournamentBetBreakdown } from '@/lib/scoring/engine'

// Lazy: TabelaClient só baixa quando o usuário entra na aba "Minha Tabela"
const TabelaClient = dynamic(
  () => import('@/app/tabela/TabelaClient').then(m => ({ default: m.TabelaClient })),
  { loading: () => <div className="py-10 text-center text-sm text-gray-400">Carregando classificação…</div> },
)
// Lazy: ExcelActions tem ~5kB de SVG inline + util de download; não é caminho crítico
const ExcelActions = dynamic(
  () => import('./ExcelActions').then(m => ({ default: m.ExcelActions })),
  { loading: () => <div className="h-7 w-44 animate-pulse rounded bg-gray-100" /> },
)

interface MatchRow {
  id: string
  match_number: number
  phase: string
  group_name: string | null
  round: number | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  match_datetime: string
  city: string
  betting_deadline: string
  score_home: number | null
  score_away: number | null
  is_brazil: boolean
}

interface BetVal { score_home: number; score_away: number; points: number | null }
interface GroupBetVal { first_place: string; second_place: string; points: number | null }

export interface PalpitesContentProps {
  groupMatches: MatchRow[]
  resolvedKnockoutByPhase: Partial<Record<string, MatchRow[]>>
  r32Labels: Record<number, { labelA: string; labelB: string }>
  betMap: Record<string, BetVal>
  groupBetMap: Record<string, GroupBetVal>
  tBet: { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string; points?: number | null } | null
  thirdBets: { group_name: string; team: string; points: number | null }[]
  groupTeams: Record<string, { teams: { team: string; flag: string }[]; deadline: string }>
  allTeams: { team: string; flag: string }[]
  tournamentDeadline: string
  calculatedTopPerGroup: Record<string, { first: string; second: string; third: string; tiedTeams: string[] }>
  officialThirdTeams: Record<string, string>
  liveScore: number | null
  liveBreakdown: TournamentBetBreakdown | null
  scorerMapping: Record<string, string>
  thirdPts: number
  participantId: string
  totalMatches: number
  totalBets: number
  totalGroupBets: number
  thirdCount: number
  bonusCount: number
  allGroupsFilled: boolean
  alreadyFilled: boolean
  nextDeadline: { iso: string; label: string } | null
  // Aba "Minha Tabela"
  calculatedStandings: CalcGroupStanding[]
  groupBetsOverride: Record<string, { first_place: string; second_place: string }>
  thirdBetsOverride: Record<string, { team: string }>
  g4Deadline: string
  hasTournamentBet: boolean
  groupAllBetsFilled: Record<string, boolean>
  filledBets: number
  totalGroupMatches: number
  /** Rodada da fase de grupos com prazo ainda aberto (1/2/3 ou null). Usado como
   *  filtro default quando a URL não tem `?etapa=`. */
  defaultActiveRound: number | null
}

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

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

const KNOCKOUT_ETAPAS = new Set(['r32', 'r16', 'qf', 'sf', 'final'])

function SectionRow({ label, deadline, sub }: { label: string; deadline?: string; sub?: boolean }) {
  return (
    <tr>
      <td colSpan={7} className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border-b border-t ${
        sub ? 'bg-blue-50 text-blue-400 border-blue-100' : 'bg-gray-800 text-gray-300 border-gray-700'
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

export function PalpitesContent(props: PalpitesContentProps) {
  return (
    <BetSaveQueueProvider>
      <PalpitesContentInner {...props} />
    </BetSaveQueueProvider>
  )
}

// Decide qual aba renderizar. Precisa de subcomponentes separados pois
// cada aba chama um conjunto diferente de hooks (ex: vários useMemo na
// aba Palpites). Misturar via early-return causaria "Rendered fewer
// hooks than expected" ao alternar de aba.
function PalpitesContentInner(props: PalpitesContentProps) {
  const sp  = useSearchParams()
  const tab = sp.get('tab') === 'tabela' ? 'tabela' : 'palpites'

  if (tab === 'tabela') return <TabelaTabPane {...props} />
  return <PalpitesTabPane {...props} />
}

function TabelaTabPane({
  participantId, calculatedStandings, groupBetsOverride, thirdBetsOverride,
  g4Deadline, hasTournamentBet, groupAllBetsFilled,
  filledBets, totalGroupMatches,
}: PalpitesContentProps) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader activeTab="tabela" />

      <div className="mb-4 mt-4">
        <p className="text-sm text-gray-500">
          Calculada com base em Meus Palpites
        </p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 overflow-hidden rounded-full bg-gray-200 h-2">
            <div
              className="h-2 rounded-full bg-verde-600 transition-all"
              style={{ width: `${totalGroupMatches > 0 ? (filledBets / totalGroupMatches) * 100 : 0}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {filledBets}/{totalGroupMatches} palpites
          </span>
        </div>
        {filledBets < totalGroupMatches && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
            ⚠️ Partidas sem palpite não são contabilizadas na classificação.{' '}
            <Link href="/palpites" className="font-semibold underline">Complete seus palpites →</Link>
          </p>
        )}
      </div>

      <TabelaClient
        standings={calculatedStandings}
        groupBetsOverride={groupBetsOverride}
        thirdBetsOverride={thirdBetsOverride}
        userId={participantId}
        g4Deadline={g4Deadline}
        hasTournamentBet={hasTournamentBet}
        groupAllBetsFilled={groupAllBetsFilled}
      />

      <div className="mt-4 text-center">
        <Link
          href="/palpites"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline"
        >
          📊 Veja aqui seus palpites
        </Link>
      </div>
    </div>
  )
}

function PalpitesTabPane({
  groupMatches, resolvedKnockoutByPhase, r32Labels,
  betMap, groupBetMap, tBet, thirdBets,
  groupTeams, allTeams, tournamentDeadline,
  calculatedTopPerGroup, officialThirdTeams,
  liveScore, liveBreakdown, scorerMapping, thirdPts, participantId,
  totalMatches, totalBets, totalGroupBets,
  thirdCount, bonusCount, allGroupsFilled, alreadyFilled, nextDeadline,
  defaultActiveRound,
}: PalpitesContentProps) {
  const sp = useSearchParams()
  // Default etapa = rodada ativa (se URL não trouxer `?etapa=`).
  // `?etapa=todos` é o sentinel para "ver tudo"; internamente vira ''.
  const etapaParam = sp.get('etapa')
  const etapa = etapaParam === 'todos'
    ? ''
    : (etapaParam ?? (defaultActiveRound !== null ? `r${defaultActiveRound}` : ''))
  const grupo = sp.get('grupo') ?? ''

  const isKnockoutEtapa = etapa ? KNOCKOUT_ETAPAS.has(etapa) : false
  const isGroupEtapa    = !etapa || etapa === 'r1' || etapa === 'r2' || etapa === 'r3'
  const groupRound      = etapa === 'r1' ? 1 : etapa === 'r2' ? 2 : etapa === 'r3' ? 3 : null
  const showBonusBets   = !etapa || etapa === 'r1'

  // Memoizar O(matches) — ~104 entradas. Sem isso, todo re-render do pai
  // (mudança de URL, context de terceiros etc.) refazia esses filtros.
  const visibleGroupMatches = useMemo(() => {
    if (isKnockoutEtapa) return []
    let v = groupMatches
    if (groupRound !== null) v = v.filter(m => m.round === groupRound)
    if (grupo)               v = v.filter(m => m.group_name === grupo)
    return v
  }, [groupMatches, groupRound, grupo, isKnockoutEtapa])

  const visibleGroupOrder = useMemo(
    () => grupo ? GROUP_ORDER.filter(g => g === grupo) : GROUP_ORDER,
    [grupo],
  )

  const visibleKnockoutPhases = useMemo(() => {
    if (isKnockoutEtapa && etapa) return ETAPA_TO_PHASES[etapa] ?? []
    if (isGroupEtapa) return []
    return KNOCKOUT_PHASES
  }, [etapa, isKnockoutEtapa, isGroupEtapa])

  const activeRound = useMemo<number | null>(() => {
    if (groupRound !== null) return groupRound
    const now = Date.now()
    for (const r of [1, 2, 3]) {
      const m = groupMatches.find(gm => gm.round === r)
      if (m && new Date(m.betting_deadline).getTime() > now) return r
    }
    return null
  }, [groupRound, groupMatches])

  const activeRoundIds = useMemo(
    () => activeRound !== null
      ? new Set(groupMatches.filter(m => m.round === activeRound).map(m => m.id))
      : new Set<string>(),
    [activeRound, groupMatches],
  )
  const activeRoundTotal = activeRoundIds.size
  const activeRoundBets  = useMemo(
    () => Object.keys(betMap).filter(id => activeRoundIds.has(id)).length,
    [betMap, activeRoundIds],
  )

  const r1ProgressFilled = activeRound === 1
    ? activeRoundBets + bonusCount + Math.min(totalGroupBets, 12) + Math.min(thirdCount, 8)
    : activeRoundBets
  const r1ProgressTotal = activeRound === 1
    ? activeRoundTotal + 5 + 12 + 8
    : activeRoundTotal

  const hasAnything = useMemo(
    () => visibleGroupMatches.length > 0
      || (showBonusBets && visibleGroupOrder.some(g => groupTeams[g]))
      || visibleKnockoutPhases.some(p => resolvedKnockoutByPhase[p]?.length),
    [visibleGroupMatches, showBonusBets, visibleGroupOrder, groupTeams, visibleKnockoutPhases, resolvedKnockoutByPhase],
  )

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

  return (
    <>
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

        <PageHeader activeTab="palpites" />

        <div className="mb-4 mt-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <ExcelActions />
            <SaveStatus />
          </div>
          <div className="flex flex-col items-end gap-2">
            {nextDeadline && <Countdown deadline={nextDeadline.iso} label={nextDeadline.label} />}
            {activeRound !== null && !isKnockoutEtapa && (
              <RoundProgress filled={r1ProgressFilled} total={r1ProgressTotal} round={activeRound} />
            )}
          </div>
        </div>

        <div className="mb-2 space-y-1.5">
          <StageFilter defaultActiveRound={defaultActiveRound} />
          {isGroupEtapa && <GroupFilter />}
        </div>

        <ThirdPlaceProvider initial={Object.fromEntries(thirdBets.map(b => [b.group_name, b.team]))}>
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

                    {visibleGroupMatches.length > 0 && (
                      <SectionRow label={groupRound ? `Fase de Grupos — Rodada ${groupRound}` : 'Fase de Grupos'} />
                    )}
                    {visibleGroupMatches.map(m => (
                      <MatchBetRow key={m.id} match={m} bet={betMap[m.id] ?? null} />
                    ))}

                    {visibleGroupMatches.length > 0 && (
                      <AutoFillButton enabled={allGroupsFilled} alreadyFilled={alreadyFilled} />
                    )}

                    {showBonusBets && visibleGroupOrder.some(g => groupTeams[g]) && (
                      <SectionRow label="Classificação dos Grupos" deadline={tournamentDeadline} sub />
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
                          existingBet={groupBetMap[g] ?? null}
                          calculatedTop={calculatedTopPerGroup[g]}
                          userId={participantId}
                        />
                      )
                    })}

                    {visibleKnockoutPhases.map(phase => {
                      const phaseMatches = resolvedKnockoutByPhase[phase]
                      if (!phaseMatches?.length) return null
                      const isR32 = phase === 'round_of_32'
                      if (phase === 'final') return phaseMatches.map(m => (
                        <MatchBetRow key={m.id} match={m} bet={betMap[m.id] ?? null} />
                      ))
                      return (
                        <>
                          <SectionRow key={`hdr-${phase}`} label={PHASE_LABELS[phase]!} />
                          {phaseMatches.map(m => {
                            const r32Label = isR32 ? r32Labels[m.match_number] : undefined
                            return (
                              <MatchBetRow
                                key={m.id}
                                match={m}
                                bet={betMap[m.id] ?? null}
                                slotLabelHome={r32Label?.labelA}
                                slotLabelAway={r32Label?.labelB}
                              />
                            )
                          })}
                        </>
                      )
                    })}

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

              {showBonusBets && (
                <ThirdPlaceSection
                  groupTeams={groupTeams}
                  deadline={tournamentDeadline}
                  existingBets={thirdBets}
                  groupBets={groupBetMap}
                  calculatedThirds={Object.fromEntries(
                    Object.entries(calculatedTopPerGroup).map(([g, t]) => [g, { third: t.third, tiedTeams: t.tiedTeams }])
                  )}
                  officialThirdTeams={officialThirdTeams}
                  thirdPts={thirdPts}
                />
              )}

              {showBonusBets && !grupo && (
                <TournamentSection
                  allTeams={allTeams}
                  deadline={tournamentDeadline}
                  existingBet={tBet}
                  scorerMapping={scorerMapping}
                  liveScore={liveScore}
                  liveBreakdown={liveBreakdown}
                />
              )}

              <div className="mt-2 text-center">
                <Link
                  href="/palpites?tab=tabela"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline"
                >
                  📊 Veja aqui a classificação com base nos seus palpites
                </Link>
              </div>
            </div>
          )}
        </ThirdPlaceProvider>
      </div>
    </>
  )
}

function PageHeader({ activeTab }: { activeTab: 'palpites' | 'tabela' }) {
  return (
    <div>
      <h1 className="text-2xl font-black text-gray-900">Meus Palpites</h1>
      <div className="mt-3 flex gap-1 border-b border-gray-200">
        <TabLink href="/palpites" label="Palpites" active={activeTab === 'palpites'} />
        <TabLink href="/palpites?tab=tabela" label="Minha Tabela" active={activeTab === 'tabela'} />
      </div>
    </div>
  )
}

function SaveStatus() {
  const { status, pendingCount } = useBetSaveQueue()
  if (status === 'idle' && pendingCount === 0) return null
  let text = ''
  let cls  = ''
  if (status === 'saving')      { text = 'Salvando…'; cls = 'text-amarelo-600' }
  else if (status === 'saved')  { text = 'Salvo ✓';   cls = 'text-verde-600'    }
  else if (status === 'error')  { text = 'Erro ao salvar'; cls = 'text-red-500' }
  else if (pendingCount > 0)    { text = `${pendingCount} alteração${pendingCount === 1 ? '' : 'ões'} pendente${pendingCount === 1 ? '' : 's'}`; cls = 'text-gray-400' }
  return <span className={`text-xs font-medium ${cls}`}>{text}</span>
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-semibold transition border-b-2 -mb-px ${
        active
          ? 'border-verde-600 text-verde-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {label}
    </Link>
  )
}
