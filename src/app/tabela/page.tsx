import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'
import { GroupCard } from './GroupCard'
import { ThirdsTable } from './ThirdsTable'
import {
  calcGroupStandings,
  rankThirds,
  resolveThirdSlots,
} from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

export const metadata = { title: 'Minha Tabela — Melhor Bolão' }

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

export default async function TabelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: rawMatches }, { data: rawBets }] = await Promise.all([
    supabase
      .from('matches')
      .select('*')
      .eq('phase', 'group')
      .order('match_datetime', { ascending: true }),
    supabase
      .from('bets')
      .select('match_id, score_home, score_away')
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

  const standings = calcGroupStandings(matches, betMap)
  const thirds     = rankThirds(standings)
  const thirdSlots = resolveThirdSlots(thirds)

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

        {/* Info Anexo C */}
        {thirdSlots && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-xs text-gray-500">
            <p className="font-semibold text-gray-700 mb-1">Chaveamento dos terceiros (Anexo C FIFA)</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(thirdSlots).sort().map(([slot, team]) => (
                <span key={slot} className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-mono">
                  {slot} ← <span className="font-semibold text-azul-escuro">{team}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">
              Slots: 1A=M79, 1B=M85, 1D=M81, 1E=M74, 1G=M82, 1I=M77, 1K=M87, 1L=M80
            </p>
          </div>
        )}
      </div>
    </>
  )
}
