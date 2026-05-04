'use client'

import { memo, useMemo } from 'react'

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
  premioSpots: number
  activeParticipantId: string
  colVisibility: Record<string, boolean>
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
}

type RankedRow = ParticipantRow & { rank: number; diffLider: number; diffPremio: number | null; diffCorte: number | null }

const Num = memo(function Num({ v, green }: { v: number; green?: boolean }) {
  return (
    <span className={`tabular-nums ${green && v > 0 ? 'text-verde-600 font-semibold' : 'text-gray-600'}`}>
      {v}
    </span>
  )
})

const Diff = memo(function Diff({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-300">—</span>
  if (v === 0)  return <span className="text-amber-500 tabular-nums font-mono">0</span>
  if (v > 0)   return <span className="text-verde-600 tabular-nums font-mono">+{v}</span>
  return <span className="text-red-500 tabular-nums font-mono">{v}</span>
})

const TeamCell = memo(function TeamCell({ team, abbrs, elTeams }: {
  team: string | undefined; abbrs: Record<string, string>; elTeams: Set<string>
}) {
  if (!team) return <span className="text-gray-300">—</span>
  const display = abbrs[team] ?? team.slice(0, 3).toUpperCase()
  return (
    <span className={elTeams.has(team) ? 'line-through text-gray-400' : ''} title={team}>
      {display}
    </span>
  )
})

const ScorerCell = memo(function ScorerCell({ raw, mapping, elStd }: {
  raw: string | undefined; mapping: Record<string, string>; elStd: Set<string>
}) {
  if (!raw) return <span className="text-gray-300">—</span>
  const std = mapping[raw] ?? raw
  return (
    <span className={elStd.has(std.trim().toLowerCase()) ? 'line-through text-gray-400' : ''} title={raw}>
      {std}
    </span>
  )
})

const BetCell = memo(function BetCell({ bet }: { bet: { score_home: number; score_away: number } | null }) {
  if (!bet) return <span className="text-gray-300">—</span>
  return <span className="font-mono tabular-nums">{bet.score_home}-{bet.score_away}</span>
})

function formatRenderedAt(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })
  } catch { return '' }
}

// ── Compact ranking ────────────────────────────────────────────────────────────

function calcCuts(n: number): { cut1: number; cut2: number } {
  // Primeiro corte: 50% rounded up to next multiple of 10 (regulamento §28)
  const cut1 = Math.min(Math.ceil((n * 0.5) / 10) * 10, n)
  // Segundo corte: 50% of cut1 survivors, same rounding (regulamento §29)
  const cut2 = Math.min(Math.ceil((cut1 * 0.5) / 10) * 10, cut1)
  return { cut1, cut2 }
}

type Zone = 'premio' | 'corte2' | 'corte1' | 'out' | 'last'

const ZONE_ROW: Record<Zone, string> = {
  premio: 'bg-green-50',
  corte2: 'bg-sky-50',
  corte1: 'bg-amber-50',
  out:    'bg-white',
  last:   'bg-red-500',
}
const ZONE_TEXT: Record<Zone, string> = {
  premio: 'text-green-800 font-semibold',
  corte2: 'text-sky-700 font-medium',
  corte1: 'text-amber-700',
  out:    'text-gray-400',
  last:   'text-white font-bold',
}
const ZONE_DOT: Record<Zone, string> = {
  premio: 'bg-green-300',
  corte2: 'bg-sky-300',
  corte1: 'bg-amber-300',
  out:    'bg-gray-200',
  last:   'bg-red-400',
}

function CompactRanking({ ranked, premioSpots, isUniqueLast, renderedAt, matchesRegistered, groupsDefined }: {
  ranked: RankedRow[]
  premioSpots: number
  isUniqueLast: boolean
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
}) {
  const n = ranked.length
  if (n === 0) return null

  const { cut1, cut2 } = calcCuts(n)

  // pts-based thresholds handle ties at zone boundaries
  const premioLine = ranked[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line   = cut2 > premioSpots ? (ranked[cut2 - 1]?.pts ?? null) : null
  const cut1Line   = cut1 > cut2        ? (ranked[cut1 - 1]?.pts ?? null) : null
  const lastRank   = ranked[n - 1].rank

  function zoneOf(r: RankedRow): Zone {
    if (isUniqueLast && r.rank === lastRank)    return 'last'
    const { pts } = r
    if (pts >= premioLine)                      return 'premio'
    if (cut2Line !== null && pts >= cut2Line)   return 'corte2'
    if (cut1Line !== null && pts >= cut1Line)   return 'corte1'
    return 'out'
  }

  const blockSize = Math.ceil(n / 4)
  const blocks = [0, 1, 2, 3]
    .map(i => ranked.slice(i * blockSize, (i + 1) * blockSize))
    .filter(b => b.length > 0)

  const dateStr = formatRenderedAt(renderedAt)

  const legendItems: { zone: Zone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(cut2 > premioSpots ? [{ zone: 'corte2' as Zone, label: `2º corte (top ${cut2})` }] : []),
    ...(cut1 > cut2        ? [{ zone: 'corte1' as Zone, label: `1º corte (top ${cut1})` }] : []),
    ...(isUniqueLast ? [{ zone: 'last' as Zone, label: 'Lanterna' }] : []),
  ]

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">

      {/* Header — sem logo, texto simples */}
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-sm font-black text-gray-800">Classificação Melhor Bolão</p>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {dateStr}
          {matchesRegistered > 0 && (
            <> · {matchesRegistered} jogos registrados e {groupsDefined}/12 grupos definidos</>
          )}
        </p>
      </div>

      {/* 4 blocos lado a lado */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-4 divide-x divide-gray-100" style={{ minWidth: '480px' }}>
          {blocks.map((block, bi) => (
            <div key={bi}>
              {/* cabeçalho do bloco */}
              <div className="grid grid-cols-[1.5rem_1fr_2rem] border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                <span className="text-right pr-0.5">#</span>
                <span className="pl-1">Participante</span>
                <span className="text-right">PTS</span>
              </div>
              {/* linhas */}
              {block.map((r, ri) => {
                const z = zoneOf(r)
                const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z
                return (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1.5rem_1fr_2rem] px-2 py-[3px] text-[11px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''}`}
                  >
                    <span className={`text-right pr-0.5 tabular-nums ${ZONE_TEXT[z]}`}>{r.rank}</span>
                    <span className={`pl-1 truncate ${ZONE_TEXT[z]}`}>{r.apelido}{z === 'last' && ' 🔦'}</span>
                    <span className={`text-right tabular-nums font-bold ${ZONE_TEXT[z]}`}>{r.pts}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2">
        {legendItems.map(({ zone: z, label }) => (
          <span key={z} className="flex items-center gap-1 text-[9px] text-gray-500">
            <span className={`inline-block h-2 w-2 rounded-sm ${ZONE_DOT[z]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ClassificacaoMBClient({
  rows, lastMatch, nextMatch,
  eliminatedTeams, eliminatedStdScorers,
  scorerMapping, teamAbbrs, prizeSpots, premioSpots,
  activeParticipantId, colVisibility, renderedAt, matchesRegistered, groupsDefined,
}: Props) {
  const elTeams = useMemo(() => new Set(eliminatedTeams), [eliminatedTeams])
  const elStd   = useMemo(() => new Set(eliminatedStdScorers), [eliminatedStdScorers])

  const showPremio      = colVisibility['premio']       ?? false
  const showLastMatch   = colVisibility['last_match']   ?? true
  const showNextMatch   = colVisibility['next_match']   ?? true
  const showDeltaPremio = colVisibility['delta_premio'] ?? true
  const showDeltaCorte  = colVisibility['delta_corte']  ?? true
  const showPtsJg       = colVisibility['pts_jg']       ?? true
  const showPtsCl       = colVisibility['pts_cl']       ?? true
  const showPtsG4       = colVisibility['pts_g4']       ?? true

  const { ranked, cutPts, premioCutPts, lastRank, isUniqueLast, premioLine, cut2Line, cut1Line } = useMemo((): {
    ranked: RankedRow[]; cutPts: number | null; premioCutPts: number | null
    lastRank: number; isUniqueLast: boolean
    premioLine: number; cut2Line: number | null; cut1Line: number | null
  } => {
    const sorted = [...rows].sort((a, b) => b.pts - a.pts)
    const n = sorted.length
    const leaderPts = n > 0 ? sorted[0].pts : 0
    const effectiveZone = Math.min(prizeSpots, n)
    const cut = n > 0 ? sorted[effectiveZone - 1].pts : null

    const effectivePremio = Math.min(premioSpots, n)
    const premioCut = n > 0 ? sorted[effectivePremio - 1].pts : null

    const withRank: (ParticipantRow & { rank: number })[] = []
    for (let i = 0; i < sorted.length; i++) {
      const rank = i > 0 && sorted[i].pts === sorted[i - 1].pts ? withRank[i - 1].rank : i + 1
      withRank.push({ ...sorted[i], rank })
    }

    const out: RankedRow[] = withRank.map(r => ({
      ...r,
      diffLider: r.pts - leaderPts,
      diffPremio: premioCut !== null ? r.pts - premioCut : null,
      diffCorte: cut !== null ? r.pts - cut : null,
    }))

    const lastRankVal    = n > 0 ? withRank[n - 1].rank : 0
    const isUniqueLastVal = n > 0 && out.filter(r => r.rank === lastRankVal).length === 1
    const { cut1, cut2 } = calcCuts(n)
    const premioLineVal = n > 0 ? (sorted[Math.min(premioSpots, n) - 1]?.pts ?? Infinity) : Infinity
    const cut2LineVal   = cut2 > premioSpots ? (sorted[cut2 - 1]?.pts ?? null) : null
    const cut1LineVal   = cut1 > cut2        ? (sorted[cut1 - 1]?.pts ?? null) : null

    return { ranked: out, cutPts: cut, premioCutPts: premioCut, lastRank: lastRankVal, isUniqueLast: isUniqueLastVal, premioLine: premioLineVal, cut2Line: cut2LineVal, cut1Line: cut1LineVal }
  }, [rows, prizeSpots, premioSpots])

  function zoneOf(r: RankedRow): Zone {
    if (isUniqueLast && r.rank === lastRank)       return 'last'
    if (r.pts >= premioLine)                      return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line)   return 'corte2'
    if (cut1Line !== null && r.pts >= cut1Line)   return 'corte1'
    return 'out'
  }

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

      <CompactRanking
        ranked={ranked}
        premioSpots={premioSpots}
        isUniqueLast={isUniqueLast}
        renderedAt={renderedAt}
        matchesRegistered={matchesRegistered}
        groupsDefined={groupsDefined}
      />

      <div className="mb-3 flex items-baseline gap-3">
        <h1 className="text-2xl font-black text-gray-900">Classificação Detalhada</h1>
        <span className="text-[10px] text-gray-400">{formatRenderedAt(renderedAt)}</span>
        <span className="text-[10px] text-gray-400">· {matchesRegistered} jogos registrados e {groupsDefined}/12 grupos definidos</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                {/* Prêmio (opcional, antes de #) */}
                {showPremio && (
                  <th className="px-1.5 py-2 text-center w-14" title="Faixa de premiação">Prêmio</th>
                )}

                {/* Identidade */}
                <th className="px-1.5 py-2 text-left w-8">#</th>
                <th className="px-1.5 py-2 text-left min-w-[90px]">Participante</th>
                <th className="px-1.5 py-2 text-right w-10" title="Pontuação total">Pts</th>

                {/* Último / Próximo jogo */}
                {showLastMatch && (
                  <th
                    className="hidden lg:table-cell px-1.5 py-2 text-center w-14"
                    title="Palpite no último jogo disputado"
                  >
                    {lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Último'}
                  </th>
                )}
                {showNextMatch && (
                  <th
                    className="hidden lg:table-cell px-1.5 py-2 text-center w-14"
                    title="Palpite no próximo jogo"
                  >
                    {nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próx.'}
                  </th>
                )}

                {/* Estatísticas de jogos */}
                {th('Cravou', 'Jogos Cravados (placar exato)', 'hidden sm:table-cell w-12')}
                {th('Pontuou', 'Jogos Pontuados', 'hidden sm:table-cell w-14')}
                {th('🦓 Apost.', '🦓 Apostada — número de apostas em resultados minoritários (possíveis zebras)', 'hidden sm:table-cell w-16')}
                {th('🦓 Pont.', '🦓 Pontuada — zebras reais em que acertou o resultado', 'hidden sm:table-cell w-14')}

                {/* Diferenças */}
                {th('∆ Líder', 'Diferença pro Líder', 'hidden md:table-cell w-14')}
                {showDeltaPremio && th('∆ Prêmio', `Diferença pro ${premioSpots}º colocado (1º premiado)`, 'hidden md:table-cell w-16')}
                {showDeltaCorte  && th('∆ Corte',  'Diferença pro Corte', 'w-14')}

                {/* Breakdown de pontos */}
                {showPtsJg && th('Pts Jg', 'Pontos com Jogos', 'hidden md:table-cell w-12')}
                {showPtsCl && th('Pts Cl', 'Pontos com Classificação de Grupos + 3os Lugares', 'hidden md:table-cell w-12')}
                {showPtsG4 && th('Pts G4 + Art', 'Pontos com G4 + Artilheiro', 'hidden md:table-cell w-16')}

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
                  <td colSpan={22} className="py-12 text-center text-sm text-gray-400">
                    Nenhum participante cadastrado ainda.
                  </td>
                </tr>
              )}
              {ranked.map(row => {
                const isActive = row.id === activeParticipantId
                const z        = zoneOf(row)
                const boundary = tiedAtBoundary && row.pts === cutPts

                const rowBg   = z === 'last' ? ZONE_ROW.last : (isActive ? 'bg-verde-50' : ZONE_ROW[z])
                const fontCls = z === 'last' ? 'font-bold' : (isActive ? 'font-semibold' : '')

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-100 last:border-0 ${rowBg} ${fontCls} ${z === 'last' ? '[&_*]:!text-white' : ''}`}
                  >
                    {showPremio && (
                      <td className="px-1.5 py-1 text-center text-gray-400 tabular-nums">
                        {premioCutPts !== null && row.pts >= premioCutPts ? (
                          <span className="text-amber-600 font-semibold">🏆</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}

                    <td className={`px-1.5 py-1 tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-500'}`}>
                      {row.rank}
                      {boundary && <span className={`ml-0.5 ${z === 'last' ? 'text-white' : 'text-amber-500'}`} title="Empate no corte">⚠</span>}
                    </td>
                    <td className={`px-1.5 py-1 max-w-[120px] truncate ${z === 'last' ? 'text-white' : 'text-gray-900'}`}>
                      {row.apelido}
                      {z === 'last' && <span className="ml-1 text-[11px]">🔦</span>}
                      {isActive && <span className={`ml-1 text-[10px] ${z === 'last' ? 'text-white' : 'text-verde-600'}`}>◀</span>}
                    </td>
                    <td className={`px-1.5 py-1 text-right font-mono font-bold tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-900'}`}>
                      {row.pts}
                    </td>

                    {/* Último / Próximo */}
                    {showLastMatch && (
                      <td className={`hidden lg:table-cell px-1.5 py-1 text-center ${z === 'last' ? 'text-white' : 'text-gray-700'}`}>
                        <BetCell bet={row.lastMatchBet} />
                      </td>
                    )}
                    {showNextMatch && (
                      <td className={`hidden lg:table-cell px-1.5 py-1 text-center ${z === 'last' ? 'text-white' : 'text-gray-700'}`}>
                        <BetCell bet={row.nextMatchBet} />
                      </td>
                    )}

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
                    {showDeltaPremio && (
                      <td className="hidden md:table-cell px-1.5 py-1 text-right">
                        <Diff v={row.diffPremio} />
                      </td>
                    )}
                    {showDeltaCorte && (
                      <td className="px-1.5 py-1 text-right">
                        <Diff v={row.diffCorte} />
                      </td>
                    )}

                    {/* Breakdown de pontos */}
                    {showPtsJg && (
                      <td className={`hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-600'}`}>
                        {row.ptsMatches}
                      </td>
                    )}
                    {showPtsCl && (
                      <td className={`hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-600'}`}>
                        {row.ptsClassif}
                      </td>
                    )}
                    {showPtsG4 && (
                      <td className={`hidden md:table-cell px-1.5 py-1 text-right font-mono tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-600'}`}>
                        {row.ptsG4}
                      </td>
                    )}

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
