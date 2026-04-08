import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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

  const [{ data: matches }, { data: bets }, { data: groupBets }, { data: tBet }, { data: thirdBets }] = await Promise.all([
    supabase.from('matches').select('*').order('match_datetime', { ascending: true }),
    supabase.from('bets').select('match_id, score_home, score_away, points').eq('user_id', user.id),
    supabase.from('group_bets').select('group_name, first_place, second_place').eq('user_id', user.id),
    supabase.from('tournament_bets')
      .select('champion, runner_up, semi1, semi2, top_scorer')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('third_place_bets')
      .select('group_name, team')
      .eq('user_id', user.id),
  ])

  const betMap      = new Map((bets ?? []).map(b => [b.match_id, b]))
  const groupBetMap = new Map((groupBets ?? []).map(b => [b.group_name, b]))

  const groupMatches    = (matches ?? []).filter(m => m.phase === 'group')
  const knockoutMatches = (matches ?? []).filter(m => m.phase !== 'group')

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

  // Auto-fill flags
  const groupMatchIds = new Set(groupMatches.map(m => m.id))
  const groupBetCount = (bets ?? []).filter(b => groupMatchIds.has(b.match_id)).length
  const allGroupsFilled = groupMatches.length > 0 && groupBetCount >= groupMatches.length
  const alreadyFilled = (groupBets ?? []).filter(b => b.first_place && b.second_place).length > 0
    || (thirdBets ?? []).length > 0

  // Contadores bônus granulares — ignora valores vazios
  const thirdCount = (thirdBets ?? []).filter(b => b.team && b.team.trim().length > 0).length
  const bonusCount = tBet
    ? [tBet.champion, tBet.runner_up, tBet.semi1, tBet.semi2, tBet.top_scorer]
        .filter(v => v && String(v).length > 0).length
    : 0

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
        <th className="px-3 py-2 text-left w-12">#</th>
        <th className="px-3 py-2 text-right">Seleção A</th>
        <th className="px-3 py-2 text-center w-32">Palpite</th>
        <th className="px-3 py-2 text-left">Seleção B</th>
        <th className="hidden px-3 py-2 text-left sm:table-cell">Data · Cidade</th>
        <th className="hidden px-3 py-2 text-left sm:table-cell">Prazo</th>
        <th className="px-3 py-2 text-right w-16">Pts</th>
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
                filled={activeRoundBets}
                total={activeRoundTotal}
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
                      />
                    )
                  })}

                  {/* ── MATA-MATA ──────────────────────────────── */}
                  {visibleKnockoutPhases.map(phase => {
                    const phaseMatches = knockoutByPhase[phase]
                    if (!phaseMatches?.length) return null
                    if (phase === 'final') return (
                      phaseMatches.map(m => (
                        <MatchBetRow key={m.id} match={m} bet={betMap.get(m.id) ?? null} />
                      ))
                    )
                    return (
                      <>
                        <SectionRow key={`hdr-${phase}`} label={PHASE_LABELS[phase]!} />
                        {phaseMatches.map(m => (
                          <MatchBetRow key={m.id} match={m} bet={betMap.get(m.id) ?? null} />
                        ))}
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
              />
            )}

            {/* Aposta de Torneio (apenas em "Todos" ou "Rodada 1") */}
            {showBonusBets && !grupo && (
              <TournamentSection
                allTeams={allTeams}
                deadline={tournamentDeadline}
                existingBet={tBet ?? null}
              />
            )}

            {/* Link para Minha Tabela */}
            {showBonusBets && !grupo && (
              <div className="mt-2 text-center">
                <a
                  href="/tabela"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline"
                >
                  📊 Veja aqui a classificação com base nos seus palpites
                </a>
              </div>
            )}
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
