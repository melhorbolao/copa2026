'use client'

import { useMemo } from 'react'

interface ParticipantRow {
  id: string
  apelido: string
  pts: number
  tournamentBet: {
    champion: string
    runner_up: string
    semi1: string
    semi2: string
    top_scorer: string
  } | null
  lastMatchBet: { score_home: number; score_away: number } | null
  nextMatchBet: { score_home: number; score_away: number } | null
}

interface MatchInfo {
  id: string
  abbr_home: string
  abbr_away: string
}

interface Props {
  rows: ParticipantRow[]
  lastMatch: MatchInfo | null
  nextMatch: MatchInfo | null
  eliminatedTeams: string[]
  eliminatedStdScorers: string[]   // standardized names (lowercase)
  scorerMapping: Record<string, string>
  teamAbbrs: Record<string, string>
  prizeSpots: number
  activeParticipantId: string
}

type RankedRow = ParticipantRow & { rank: number }

function TeamCell({ team, abbrs, elTeams }: {
  team: string | undefined
  abbrs: Record<string, string>
  elTeams: Set<string>
}) {
  if (!team) return <span className="text-gray-300">—</span>
  const display = abbrs[team] ?? team.slice(0, 3).toUpperCase()
  const out = elTeams.has(team)
  return (
    <span className={out ? 'line-through text-gray-400' : 'text-gray-800'} title={team}>
      {display}
    </span>
  )
}

function ScorerCell({ raw, mapping, elStd }: {
  raw: string | undefined
  mapping: Record<string, string>
  elStd: Set<string>
}) {
  if (!raw) return <span className="text-gray-300">—</span>
  const std = mapping[raw] ?? raw
  const out = elStd.has(std.trim().toLowerCase())
  return (
    <span className={out ? 'line-through text-gray-400' : 'text-gray-800'} title={raw}>
      {std}
    </span>
  )
}

function BetCell({ bet }: { bet: { score_home: number; score_away: number } | null }) {
  if (!bet) return <span className="text-gray-300">—</span>
  return <span className="font-mono">{bet.score_home}-{bet.score_away}</span>
}

function DiffCell({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-gray-300">—</span>
  if (diff > 0) return <span className="text-verde-600 font-mono">+{diff}</span>
  if (diff < 0) return <span className="text-red-500 font-mono">{diff}</span>
  return <span className="text-amber-600 font-mono">±0</span>
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
    const out: RankedRow[] = []
    for (let i = 0; i < sorted.length; i++) {
      const rank = i > 0 && sorted[i].pts === sorted[i - 1].pts
        ? out[i - 1].rank
        : i + 1
      out.push({ ...sorted[i], rank })
    }
    const effectiveZone = Math.min(prizeSpots, sorted.length)
    const cut = sorted.length > 0 ? sorted[effectiveZone - 1].pts : null
    return { ranked: out, cutPts: cut }
  }, [rows, prizeSpots])

  const inZone = (pts: number) => cutPts !== null && pts >= cutPts

  // true when there are participants tied at exactly cutPts both inside and outside the zone
  const tiedAtBoundary = useMemo(() => {
    if (cutPts === null) return false
    const atCut = ranked.filter(r => r.pts === cutPts)
    return atCut.length > 1 && atCut.some(r => r.rank <= prizeSpots) && atCut.some(r => r.rank > prizeSpots)
  }, [ranked, cutPts, prizeSpots])

  const onBoundary = (row: RankedRow) =>
    tiedAtBoundary && row.pts === cutPts

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 pb-32">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Classificação MB</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Ranking geral · {rows.length} participante{rows.length !== 1 ? 's' : ''} · top {prizeSpots} na zona
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-amber-100 border border-amber-300" />
            Zona (empate em disputa)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-amber-50 border border-amber-200" />
            Zona garantida
          </span>
          <span className="flex items-center gap-1.5">
            <span className="line-through text-gray-400">ABC</span>
            Eliminado
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-2 py-2 text-left w-8">#</th>
                <th className="px-2 py-2 text-left min-w-[100px]">Participante</th>
                <th className="px-2 py-2 text-right w-12">Pts</th>
                <th className="hidden sm:table-cell px-2 py-2 text-right w-12">∆</th>
                <th className="hidden md:table-cell px-2 py-2 text-center w-14" title="Último jogo com resultado">
                  {lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Último'}
                </th>
                <th className="hidden md:table-cell px-2 py-2 text-center w-14" title="Próximo jogo">
                  {nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próximo'}
                </th>
                <th className="px-2 py-2 text-center w-12" title="Aposta: Campeão">🥇</th>
                <th className="px-2 py-2 text-center w-12" title="Aposta: Vice-campeão">🥈</th>
                <th className="hidden sm:table-cell px-2 py-2 text-center w-12" title="Aposta: 3º Lugar">3°</th>
                <th className="hidden sm:table-cell px-2 py-2 text-center w-12" title="Aposta: 4º Lugar">4°</th>
                <th className="hidden sm:table-cell px-2 py-2 text-left max-w-[100px]" title="Aposta: Artilheiro">⚽</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                    Nenhum participante cadastrado ainda.
                  </td>
                </tr>
              )}
              {ranked.map(row => {
                const isActive = row.id === activeParticipantId
                const zone   = inZone(row.pts)
                const border = onBoundary(row)
                const diff   = cutPts !== null ? row.pts - cutPts : null

                let bgClass = ''
                if (isActive) {
                  bgClass = 'bg-verde-50'
                } else if (zone) {
                  bgClass = border ? 'bg-amber-100' : 'bg-amber-50'
                }

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-100 last:border-0 ${bgClass} ${isActive ? 'font-semibold' : ''}`}
                  >
                    <td className="px-2 py-1 text-gray-500 tabular-nums">
                      {row.rank}
                      {border && (
                        <span className="ml-0.5 text-amber-500" title="Empate no corte">⚠</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-gray-900 max-w-[130px] truncate">
                      {row.apelido}
                      {isActive && <span className="ml-1 text-verde-600">◀</span>}
                    </td>
                    <td className="px-2 py-1 text-right font-mono font-bold text-gray-900 tabular-nums">
                      {row.pts}
                    </td>
                    <td className="hidden sm:table-cell px-2 py-1 text-right">
                      <DiffCell diff={diff} />
                    </td>
                    <td className="hidden md:table-cell px-2 py-1 text-center text-gray-700">
                      <BetCell bet={row.lastMatchBet} />
                    </td>
                    <td className="hidden md:table-cell px-2 py-1 text-center text-gray-700">
                      <BetCell bet={row.nextMatchBet} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.champion}   abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.runner_up}  abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-2 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi1}      abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-2 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi2}      abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="hidden sm:table-cell px-2 py-1 max-w-[100px] truncate">
                      <ScorerCell raw={row.tournamentBet?.top_scorer} mapping={scorerMapping} elStd={elStd} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {ranked.length > 0 && (
          <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
            ∆ = diferença para a última vaga da zona ({prizeSpots}ª posição)
            {lastMatch && (
              <span className="ml-4">
                {lastMatch.abbr_home}×{lastMatch.abbr_away} = palpite do último jogo disputado
              </span>
            )}
            {nextMatch && (
              <span className="ml-4">
                {nextMatch.abbr_home}×{nextMatch.abbr_away} = palpite do próximo jogo
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
