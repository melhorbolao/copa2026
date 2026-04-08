import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'
import { GroupCard } from './GroupCard'
import { ThirdsTable } from './ThirdsTable'
import { BracketView } from './BracketView'
import {
  calcGroupStandings,
  rankThirds,
  resolveThirdSlots,
  buildR32Teams,
} from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

export const metadata = { title: 'Minha Tabela — Melhor Bolão' }

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

export default async function TabelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: rawMatches }, { data: rawBets }, { data: tBet }, { data: rawGroupBets }] = await Promise.all([
    supabase
      .from('matches')
      .select('*')
      .eq('phase', 'group')
      .order('match_datetime', { ascending: true }),
    supabase
      .from('bets')
      .select('match_id, score_home, score_away')
      .eq('user_id', user.id),
    supabase
      .from('tournament_bets')
      .select('champion')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('group_bets')
      .select('group_name, first_place, second_place')
      .eq('user_id', user.id),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: MatchSlim[] = ((rawMatches ?? []) as any[]).map((m: any) => ({
    id: m.id,
    group_name: m.group_name,
    phase: m.phase,
    team_home: m.team_home,
    team_away: m.team_away,
    flag_home: m.flag_home,
    flag_away: m.flag_away,
  }))

  const betMap = new Map<string, BetSlim>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((rawBets ?? []) as any[]).map((b: any) => [b.match_id, { match_id: b.match_id, score_home: b.score_home, score_away: b.score_away }]),
  )

  // Override de ranking: os palpites manuais de 1º/2º do grupo prevalecem sobre os placares calculados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupBetsOverride = new Map<string, { first_place: string; second_place: string }>(
    ((rawGroupBets ?? []) as any[]).map((gb: any) => [
      gb.group_name as string,
      { first_place: gb.first_place as string, second_place: gb.second_place as string },
    ]),
  )

  const standings  = calcGroupStandings(matches, betMap)
  const thirds     = rankThirds(standings)
  const thirdSlots = resolveThirdSlots(thirds)
  const r32Slots   = buildR32Teams(standings, thirds, thirdSlots, groupBetsOverride)

  // Prazo do G4 = menor betting_deadline dos jogos de grupo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g4Deadline = ((rawMatches ?? []) as any[])
    .map((m: any) => m.betting_deadline as string)
    .sort()[0] ?? ''
  const hasTournamentBet = !!(tBet?.champion)

  // Quais grupos têm o terceiro entre os 8 melhores
  const advancingThirdGroups = new Set(
    thirds.filter(t => t.advances).map(t => t.group),
  )

  // Ordenação canônica dos grupos
  const sortedStandings = GROUP_ORDER
    .map(g => standings.find(s => s.group === g))
    .filter(Boolean) as typeof standings

  // Contar palpites preenchidos
  const groupMatchIds = new Set(matches.map(m => m.id))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filledBets = ((rawBets ?? []) as any[]).filter((b: any) => groupMatchIds.has(b.match_id)).length
  const totalGroupMatches = matches.length

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8">

        {/* Cabeçalho */}
        <div className="mb-8">
          <h1 className="text-3xl font-black text-gray-900 mb-1">
            Minha Tabela
          </h1>
          <p className="text-sm text-gray-500">
            Classificação calculada com base nos seus palpites · Copa 2026
          </p>

          {/* Progresso dos palpites */}
          <div className="mt-4 flex items-center gap-3">
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
              <a href="/palpites" className="font-semibold underline">Complete seus palpites →</a>
            </p>
          )}
        </div>

        {/* Grade de grupos — 2 colunas em telas médias */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 mb-8">
          {sortedStandings.map(standing => (
            <GroupCard
              key={standing.group}
              standing={standing}
              advancingGroups={advancingThirdGroups}
            />
          ))}
        </div>

        {/* Melhores terceiros */}
        {thirds.length > 0 && (
          <div className="mb-8">
            <ThirdsTable thirds={thirds} />
          </div>
        )}

        {/* Chaveamento visual */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
            <span className="text-sm font-black uppercase tracking-widest text-white">
              🏆 Chaveamento — Mata-Mata — USO OPCIONAL
            </span>
            <span className="ml-auto text-[11px] font-medium text-white/60">
              baseado nos seus palpites
            </span>
          </div>
          <div className="p-4">
            <BracketView
              r32Slots={r32Slots}
              userId={user.id}
              g4Deadline={g4Deadline}
              hasTournamentBet={hasTournamentBet}
            />
          </div>
        </div>

        <div className="mt-4 text-center">
          <a
            href="/palpites"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-azul-escuro hover:underline"
          >
            📊 Veja aqui seus palpites
          </a>
        </div>
      </div>
    </>
  )
}
