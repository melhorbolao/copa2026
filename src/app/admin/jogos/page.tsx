import { createClient } from '@/lib/supabase/server'
import { formatBrasilia } from '@/utils/date'
import { MatchScoreForm } from './MatchScoreForm'
import type { MatchPhase } from '@/types/database'

// Ordem de exibição das fases
const PHASE_ORDER: MatchPhase[] = [
  'group',
  'round_of_32',
  'round_of_16',
  'quarterfinal',
  'semifinal',
  'third_place',
  'final',
]

const PHASE_LABELS: Record<MatchPhase, string> = {
  group:        'Fase de Grupos',
  round_of_32:  'Rodada de 32',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar',
  final:        'Final',
}

export default async function AdminJogosPage() {
  const supabase = await createClient()

  // Busca partidas
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .order('match_number', { ascending: true })

  // Busca contagem de palpites por partida
  const { data: betCounts } = await supabase
    .from('bets')
    .select('match_id')

  const betsByMatch = (betCounts ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.match_id] = (acc[row.match_id] ?? 0) + 1
    return acc
  }, {})

  const total    = matches?.length ?? 0
  const finished = matches?.filter((m) => m.score_home !== null).length ?? 0
  const pending  = total - finished

  // Agrupa por fase
  const byPhase = PHASE_ORDER.reduce<Record<string, typeof matches>>((acc, phase) => {
    const group = matches?.filter((m) => m.phase === phase) ?? []
    if (group.length) acc[phase] = group
    return acc
  }, {})

  return (
    <div className="space-y-8">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total de jogos"      value={total}    color="gray"  />
        <StatCard label="Com resultado"       value={finished} color="verde" />
        <StatCard label="Aguardando placar"   value={pending}  color="amarelo" />
      </div>

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center">
          <p className="text-sm text-gray-500">Nenhuma partida cadastrada.</p>
          <p className="mt-1 text-xs text-gray-400">
            Execute o script de seed SQL para importar as partidas da Copa 2026.
          </p>
        </div>
      ) : (
        Object.entries(byPhase).map(([phase, phaseMatches]) => (
          <section key={phase}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
              <span className="h-px flex-1 bg-gray-200" />
              {PHASE_LABELS[phase as MatchPhase]}
              <span className="h-px flex-1 bg-gray-200" />
            </h2>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left">
                <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 w-12">#</th>
                    <th className="px-4 py-3">Data / Cidade</th>
                    <th className="px-4 py-3">Placar</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Prazo apostas</th>
                  </tr>
                </thead>
                <tbody>
                  {phaseMatches!.map((match) => {
                    const betsCount = betsByMatch[match.id] ?? 0
                    return (
                      <tr key={match.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        {/* Número */}
                        <td className="px-4 py-4 text-sm font-bold text-gray-400">
                          {match.match_number}
                          {match.group_name && (
                            <span className="ml-1 text-xs text-gray-300">
                              ({match.group_name})
                            </span>
                          )}
                        </td>

                        {/* Data */}
                        <td className="px-4 py-4">
                          <p className="text-xs font-medium text-gray-700">
                            {formatBrasilia(match.match_datetime, "dd/MM 'às' HH:mm")}
                          </p>
                          <p className="text-xs text-gray-400">{match.city}</p>
                        </td>

                        {/* Formulário de placar */}
                        <td className="px-4 py-4">
                          <MatchScoreForm
                            matchId={match.id}
                            teamHome={match.team_home}
                            teamAway={match.team_away}
                            scoreHome={match.score_home}
                            scoreAway={match.score_away}
                            betsCount={betsCount}
                          />
                        </td>

                        {/* Prazo */}
                        <td className="hidden px-4 py-4 text-xs text-gray-400 sm:table-cell">
                          {formatBrasilia(match.betting_deadline, "dd/MM HH:mm")}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {/* Legenda de pontuação */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
          Tabela de pontuação aplicada automaticamente
        </p>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <span><strong className="text-verde-700">10 pts</strong> — Placar exato (cravou)</span>
          <span><strong className="text-verde-700">7 pts</strong> — Resultado certo + 1 placar parcial</span>
          <span><strong className="text-verde-700">5 pts</strong> — Resultado certo (V/E/D)</span>
          <span><strong className="text-gray-400">0 pts</strong> — Resultado errado</span>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'gray' | 'verde' | 'amarelo'
}) {
  const styles = {
    gray:    'bg-gray-50    border-gray-200    text-gray-700',
    verde:   'bg-verde-50   border-verde-200   text-verde-700',
    amarelo: 'bg-amarelo-50 border-amarelo-200 text-amarelo-700',
  }
  return (
    <div className={`rounded-xl border p-4 text-center ${styles[color]}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
    </div>
  )
}
