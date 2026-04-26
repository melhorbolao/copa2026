'use client'

import { useMemo } from 'react'

interface ParticipantRow {
  id: string
  apelido: string
  pts: number
  ptsMatches: number
  ptsClassif: number
  ptsG4: number
  cravados: number
  pontuados: number
  zebraApostada: number
  zebraPontuada: number
  tournamentBet: {
    champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string
  } | null
  lastMatchBet: { score_home: number; score_away: number } | null
  nextMatchBet: { score_home: number; score_away: number } | null
}

interface MatchInfo { id: string; abbr_home: string; abbr_away: string }

interface Props {
  rows: ParticipantRow[]
  lastMatch: MatchInfo | null
  nextMatch: MatchInfo | null
  eliminatedTeams: string[]
  eliminatedStdScorers: string[]
  scorerMapping: Record<string, string>
  teamAbbrs: Record<string, string>
  prizeSpots: number
  activeParticipantId: string
}

type RankedRow = ParticipantRow & { rank: number; diffLider: number; diffCorte: number | null }

function Num({ v, green }: { v: number; green?: boolean }) {
  return (
    <span className={`tabular-nums ${green && v > 0 ? 'text-verde-600 font-semibold' : 'text-gray-600'}`}>
      {v}
    </span>
  )
}

function Diff({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-300">—</span>
  if (v === 0)  return <span className="text-amber-500 tabular-nums font-mono">0</span>
  if (v > 0)   return <span className="text-red-500 tabular-nums font-mono">+{v}</span>
  return <span className="text-verde-600 tabular-nums font-mono">{v}</span>
}

function TeamCell({ team, abbrs, elTeams }: {
  team: string | undefined; abbrs: Record<string, string>; elTeams: Set<string>
}) {
  if (!team) return <span className="text-gray-300">—</span>
  const display = abbrs[team] ?? team.slice(0, 3).toUpperCase()
  return (
    <span className={elTeams.has(team) ? 'line-through text-gray-400' : ''} title={team}>
      {display}
    </span>
  )
}

function ScorerCell({ raw, mapping, elStd }: {
  raw: string | undefined; mapping: Record<string, string>; elStd: Set<string>
}) {
  if (!raw) return <span className="text-gray-300">—</span>
  const std = mapping[raw] ?? raw
  return (
    <span className={elStd.has(std.trim().toLowerCase()) ? 'line-through text-gray-400' : ''} title={raw}>
      {std}
    </span>
  )
}

function BetCell({ bet }: { bet: { score_home: number; score_away: number } | null }) {
  if (!bet) return <span className="text-gray-300">—</span>
  return <span className="font-mono tabular-nums">{bet.score_home}-{bet.score_away}</span>
}

export function ClassificacaoMBClient({
  rows, lastMatch, nextMatch,
  eliminatedTeams, eliminatedStdScorers,
  scorerMapping, teamAbbrs, prizeSpots, activeParticipantId,
}: Props) {
  const elTeams = useMemo(() => new Set(eliminatedTeams), [eliminatedTeams])
  const elStd   = useMemo(() => new Set(eliminatedStdScorers), [eliminatedStdScorers])

  const { ranked, cutPts } = useMemo((): { ranked: RankedRow[]; cutPts: number | null } => {
    const sorted = [...rows].sort((a, b) => b.pts - a.pts)
    const leaderPts = sorted.length > 0 ? sorted[0].pts : 0
    const effectiveZone = Math.min(prizeSpots, sorted.length)
    const cut = sorted.length > 0 ? sorted[effectiveZone - 1].pts : null

    const withRank: (ParticipantRow & { rank: number })[] = []
    for (let i = 0; i < sorted.length; i++) {
      const rank = i > 0 && sorted[i].pts === sorted[i - 1].pts ? withRank[i - 1].rank : i + 1
      withRank.push({ ...sorted[i], rank })
    }

    const out: RankedRow[] = withRank.map(r => ({
      ...r,
      diffLider: leaderPts - r.pts,
      diffCorte: cut !== null ? cut - r.pts : null,
    }))
    return { ranked: out, cutPts: cut }
  }, [rows, prizeSpots])

  const inZone = (pts: number) => cutPts !== null && pts >= cutPts

  const tiedAtBoundary = useMemo(() => {
    if (cutPts === null) return false
    const atCut = ranked.filter(r => r.pts === cutPts)
    return atCut.length > 1 && atCut.some(r => r.rank <= prizeSpots) && atCut.some(r => r.rank > prizeSpots)
  }, [ranked, cutPts, prizeSpots])

  const th = (label: string, title?: string, cls = '') => (
    <th className={`px-1.5 py-2 text-center whitespace-nowrap ${cls}`} title={title ?? label}>
      {label}
    </th>
  )

  return (
    <div className="mx-auto max-w-full px-2 py-4 pb-32 sm:px-4 sm:py-6">
      <div className="mb-3">
        <h1 className="text-2xl font-black text-gray-900">Classificação Melhor Bolão</h1>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                {/* Identidade */}
                <th className="px-1.5 py-2 text-left w-8">#</th>
                <th className="px-1.5 py-2 text-left min-w-[90px]">Participante</th>
                <th className="px-1.5 py-2 text-right w-10" title="Pontuação total">Pts</th>

                {/* Último / Próximo jogo — logo após Pts */}
                <th
                  className="hidden lg:table-cell px-1.5 py-2 text-center w-14"
                  title="Palpite no último jogo disputado"
                >
                  {lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Último'}
                </th>
                <th
                  className="hidden lg:table-cell px-1.5 py-2 text-center w-14"
                  title="Palpite no próximo jogo"
                >
                  {nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próx.'}
                </th>

                {/* Estatísticas de jogos */}
                {th('Crav.', 'Jogos Cravados (placar exato)', 'hidden sm:table-cell w-10')}
                {th('Pont.', 'Jogos Pontuados', 'hidden sm:table-cell w-10')}
                {th('🦓 Apost.', '🦓 Apostada — número de apostas em resultados minoritários (possíveis zebras)', 'hidden sm:table-cell w-16')}
                {th('🦓 Pont.', '🦓 Pontuada — zebras reais em que acertou o resultado', 'hidden sm:table-cell w-14')}

                {/* Diferenças */}
                {th('∆ Líder', 'Diferença pro Líder', 'hidden md:table-cell w-14')}
                {th('∆ Corte', 'Diferença pro Corte', 'w-14')}

                {/* Breakdown de pontos */}
                {th('Pts Jg', 'Pontos com Jogos', 'hidden md:table-cell w-12')}
                {th('Pts Cl', 'Pontos com Classificação de Grupos + 3os Lugares', 'hidden md:table-cell w-12')}
                {th('Pts G4 + Art', 'Pontos com G4 + Artilheiro', 'hidden md:table-cell w-16')}

                {/* G4 picks */}
                {th('1º', 'Aposta: Campeão', 'w-11')}
                {th('2º', 'Aposta: Vice-campeão', 'w-11')}
                {th('3°', 'Aposta: 3º Lugar', 'hidden sm:table-cell w-11')}
                {th('4°', 'Aposta: 4º Lugar', 'hidden sm:table-cell w-11')}
                <th className="hidden sm:table-cell px-1.5 py-2 text-left min-w-[80px]" title="Aposta: Artilheiro">⚽</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={20} className="py-12 text-center text-sm text-gray-400">
                    Nenhum participante cadastrado ainda.
                  </td>
                </tr>
              )}
              {ranked.map(row => {
                const isActive = row.id === activeParticipantId
                const zone     = inZone(row.pts)
                const boundary = tiedAtBoundary && row.pts === cutPts

                let bg = ''
                if (isActive)  bg = 'bg-verde-50'
                else if (zone) bg = boundary ? 'bg-amber-100' : 'bg-amber-50'

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-100 last:border-0 ${bg} ${isActive ? 'font-semibold' : ''}`}
                  >
                    <td className="px-1.5 py-1 text-gray-500 tabular-nums">
                      {row.rank}
                      {boundary && <span className="ml-0.5 text-amber-500" title="Empate no corte">⚠</span>}
                    </td>
                    <td className="px-1.5 py-1 text-gray-900 max-w-[120px] truncate">
                      {row.apelido}{isActive && <span className="ml-1 text-verde-600 text-[10px]">◀</span>}
                    </td>
                    <td className="px-1.5 py-1 text-right font-mono font-bold text-gray-900 tabular-nums">
                      {row.pts}
                    </td>

                    {/* Último / Próximo */}
                    <td className="hidden lg:table-cell px-1.5 py-1 text-center text-gray-700">
                      <BetCell bet={row.lastMatchBet} />
                    </td>
                    <td className="hidden lg:table-cell px-1.5 py-1 text-center text-gray-700">
                      <BetCell bet={row.nextMatchBet} />
                    </td>

                    {/* Estatísticas */}
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <Num v={row.cravados} green />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <Num v={row.pontuados} />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <Num v={row.zebraApostada} green />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <Num v={row.zebraPontuada} green />
                    </td>

                    {/* Diferenças */}
                    <td className="hidden md:table-cell px-1.5 py-1 text-right">
                      <Diff v={row.diffLider} />
                    </td>
                    <td className="px-1.5 py-1 text-right">
                      <Diff v={row.diffCorte} />
                    </td>

                    {/* Breakdown de pontos */}
                    <td className="hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums text-gray-600">
                      {row.ptsMatches}
                    </td>
                    <td className="hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums text-gray-600">
                      {row.ptsClassif}
                    </td>
                    <td className="hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums text-gray-600">
                      {row.ptsG4}
                    </td>

                    {/* G4 picks */}
                    <td className="px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.champion}  abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.runner_up} abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi1}     abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi2}     abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-1.5 py-1 max-w-[100px] truncate">
                      <ScorerCell raw={row.tournamentBet?.top_scorer} mapping={scorerMapping} elStd={elStd} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
