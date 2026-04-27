'use client'

import { useSearchParams } from 'next/navigation'
import { StickyStats } from './StickyStats'
import { Countdown } from './Countdown'
import { RoundProgress } from './RoundProgress'
import { ExcelActions } from './ExcelActions'
import { StageFilter } from './StageFilter'
import { GroupFilter } from './GroupFilter'
import { MatchBetRow } from './MatchBetRow'
import { GroupBetRow } from './GroupBetRow'
import { TournamentSection } from './TournamentSection'
import { ThirdPlaceSection } from './ThirdPlaceSection'
import { ThirdPlaceProvider } from './ThirdPlaceContext'
import { AutoFillButton } from './AutoFillButton'
import { formatBrasilia } from '@/utils/date'
import type { MatchPhase } from '@/types/database'
import type { TournamentBetBreakdown } from '@/lib/scoring/engine'

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

export function PalpitesContent({
  groupMatches, resolvedKnockoutByPhase, r32Labels,
  betMap, groupBetMap, tBet, thirdBets,
  groupTeams, allTeams, tournamentDeadline,
  calculatedTopPerGroup, officialThirdTeams,
  liveScore, liveBreakdown, scorerMapping, thirdPts, participantId,
  totalMatches, totalBets, totalGroupBets,
  thirdCount, bonusCount, allGroupsFilled, alreadyFilled, nextDeadline,
}: PalpitesContentProps) {
  const sp    = useSearchParams()
  const etapa = sp.get('etapa') ?? ''
  const grupo = sp.get('grupo') ?? ''

  const isKnockoutEtapa = etapa ? KNOCKOUT_ETAPAS.has(etapa) : false
  const isGroupEtapa    = !etapa || etapa === 'r1' || etapa === 'r2' || etapa === 'r3'
  const groupRound      = etapa === 'r1' ? 1 : etapa === 'r2' ? 2 : etapa === 'r3' ? 3 : null

  let visibleGroupMatches = groupMatches
  if (groupRound !== null) visibleGroupMatches = visibleGroupMatches.filter(m => m.round === groupRound)
  if (grupo)               visibleGroupMatches = visibleGroupMatches.filter(m => m.group_name === grupo)
  if (isKnockoutEtapa)     visibleGroupMatches = []

  const showBonusBets     = !etapa || etapa === 'r1'
  const visibleGroupOrder = grupo ? GROUP_ORDER.filter(g => g === grupo) : GROUP_ORDER

  const visibleKnockoutPhases = isKnockoutEtapa && etapa
    ? ETAPA_TO_PHASES[etapa] ?? []
    : isGroupEtapa
      ? []
      : KNOCKOUT_PHASES

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
  const activeRoundBets  = Object.keys(betMap).filter(id => activeRoundIds.has(id)).length

  const r1ProgressFilled = activeRound === 1
    ? activeRoundBets + bonusCount + Math.min(totalGroupBets, 12) + Math.min(thirdCount, 8)
    : activeRoundBets
  const r1ProgressTotal = activeRound === 1
    ? activeRoundTotal + 5 + 12 + 8
    : activeRoundTotal

  const hasAnything =
    visibleGroupMatches.length > 0 ||
    (showBonusBets && visibleGroupOrder.some(g => groupTeams[g])) ||
    visibleKnockoutPhases.some(p => resolvedKnockoutByPhase[p]?.length)

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

        <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-black text-gray-900">Meus Palpites</h1>
            <div className="mt-2"><ExcelActions /></div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {nextDeadline && <Countdown deadline={nextDeadline.iso} label={nextDeadline.label} />}
            {activeRound !== null && !isKnockoutEtapa && (
              <RoundProgress filled={r1ProgressFilled} total={r1ProgressTotal} round={activeRound} />
            )}
          </div>
        </div>

        <div className="mb-2 space-y-1.5">
          <StageFilter />
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
