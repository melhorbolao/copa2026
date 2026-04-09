import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { Navbar } from '@/components/layout/Navbar'
import { TabelaClient } from './TabelaClient'
import { calcGroupStandings } from '@/lib/bracket/engine'
import type { BetSlim, MatchSlim } from '@/lib/bracket/engine'

export const metadata = {}

export default async function TabelaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  let participantId: string
  try {
    participantId = await getActiveParticipantId(supabase, user.id)
  } catch {
    redirect('/aguardando-aprovacao')
  }

  const [{ data: rawMatches }, { data: rawBets }, { data: tBet }, { data: rawGroupBets }] = await Promise.all([
    supabase
      .from('matches')
      .select('*')
      .eq('phase', 'group')
      .order('match_datetime', { ascending: true }),
    supabase
      .from('bets')
      .select('match_id, score_home, score_away')
      .eq('participant_id', participantId),
    supabase
      .from('tournament_bets')
      .select('champion')
      .eq('participant_id', participantId)
      .maybeSingle(),
    supabase
      .from('group_bets')
      .select('group_name, first_place, second_place')
      .eq('participant_id', participantId),
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupBetsOverride = Object.fromEntries(
    ((rawGroupBets ?? []) as any[]).map((gb: any) => [
      gb.group_name as string,
      { first_place: gb.first_place as string, second_place: gb.second_place as string },
    ]),
  )

  const standings = calcGroupStandings(matches, betMap)

  // Prazo do G4 = menor betting_deadline dos jogos de grupo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g4Deadline = ((rawMatches ?? []) as any[])
    .map((m: any) => m.betting_deadline as string)
    .sort()[0] ?? ''
  const hasTournamentBet = !!(tBet?.champion)

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

        {/* Conteúdo interativo: grupos, terceiros, chaveamento */}
        <TabelaClient
          standings={standings}
          groupBetsOverride={groupBetsOverride}
          userId={participantId}
          g4Deadline={g4Deadline}
          hasTournamentBet={hasTournamentBet}
        />

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
