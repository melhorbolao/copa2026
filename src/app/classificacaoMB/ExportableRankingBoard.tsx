'use client'

import type { HighlightMode } from './SobeDesce'

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

// Mesma base de G112CompactRanking (ClassificacaoMBClient.tsx): o 1º corte oficial já
// executado é 112 (tournament_settings.corte1_participantes); o 2º corte (G56) é sempre
// metade disso, arredondado para cima.
const G112_CORTE1_SIZE = 112

function calcCuts(n: number) {
  const cut1 = Math.min(G112_CORTE1_SIZE, n)
  const cut2 = Math.ceil(cut1 / 2)
  return { cut1, cut2 }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })
  } catch { return '' }
}

interface ExportRow {
  id: string; apelido: string; pts: number; rank: number
  lastMatchBet: { score_home: number; score_away: number } | null
  nextMatchBet: { score_home: number; score_away: number } | null
}
interface LastMatch { abbr_home: string; abbr_away: string; score_home: number; score_away: number; penalty_winner: string | null }

interface Props {
  ranked: ExportRow[]
  premioSpots: number
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
  lastMatch: LastMatch | null
  nextMatch?: LastMatch | null
  showLastMatch?: boolean
  showNextMatch?: boolean
  highlightMode?: HighlightMode
  activeParticipantId?: string
  panelaSet?: Set<string>
  tribeMemberSet?: Set<string>
  /** 'g112': 4 colunas, sem corte1, sem lanterna, sem grupos definidos */
  mode?: 'full' | 'g112'
}

export function ExportableRankingBoard({
  ranked, premioSpots, renderedAt, matchesRegistered, groupsDefined, lastMatch, nextMatch,
  showLastMatch = false, showNextMatch = false,
  highlightMode, activeParticipantId, panelaSet, tribeMemberSet,
  mode = 'full',
}: Props) {
  const n = ranked.length
  if (n === 0) return null

  const isG112 = mode === 'g112'
  const blockCount = isG112 ? 4 : 7

  const { cut1, cut2: cut2Calc } = calcCuts(n)
  // G112 → G56: top 56 avançam para a próxima fase
  const cut2 = isG112 ? Math.ceil(n / 2) : cut2Calc
  const premioLine   = ranked[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line     = cut2 > premioSpots ? (ranked[cut2 - 1]?.pts ?? null) : null
  const cut1Line     = !isG112 && cut1 > cut2 ? (ranked[cut1 - 1]?.pts ?? null) : null
  const lastRank     = ranked[n - 1].rank
  const isUniqueLast = !isG112 && ranked.filter(r => r.rank === lastRank).length === 1

  function zoneOf(r: ExportRow): Zone {
    if (!isG112 && isUniqueLast && r.rank === lastRank)    return 'last'
    if (r.pts >= premioLine)                               return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line)            return 'corte2'
    if (!isG112 && cut1Line !== null && r.pts >= cut1Line) return 'corte1'
    return 'out'
  }

  const showLast = isG112 && showLastMatch
  const showNext = isG112 && showNextMatch
  const colsGrid = showLast && showNext
    ? 'grid grid-cols-[1.5rem_1fr_2rem_3.5rem_3.5rem]'
    : showLast || showNext
      ? 'grid grid-cols-[1.5rem_1fr_2rem_3.5rem]'
      : 'grid grid-cols-[1.5rem_1fr_2rem]'

  const blockSize = Math.ceil(n / blockCount)
  const blocks = Array.from({ length: blockCount }, (_, i) => ranked.slice(i * blockSize, (i + 1) * blockSize)).filter(b => b.length > 0)

  const legendItems: { zone: Zone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(cut2 > premioSpots ? [{ zone: 'corte2' as Zone, label: `2º corte (top ${cut2})` }] : []),
    ...(!isG112 && cut1 > cut2 ? [{ zone: 'corte1' as Zone, label: `1º corte (top ${cut1})` }] : []),
    ...(!isG112 && isUniqueLast ? [{ zone: 'last' as Zone, label: 'Lanterna' }] : []),
  ]

  const title = isG112 ? 'Classificação G112' : 'Classificação Melhor Bolão'

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-base font-black text-gray-800">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {formatDate(renderedAt)}
          {matchesRegistered > 0 && (
            <>
              {' · '}{matchesRegistered} jogos registrados
              {lastMatch && (
                <> · último {lastMatch.abbr_home} {lastMatch.score_home}×{lastMatch.score_away}{lastMatch.penalty_winner ? 'P' : ''} {lastMatch.abbr_away}</>
              )}
              {!isG112 && <>{' · '}{groupsDefined}/12 grupos definidos</>}
            </>
          )}
        </p>
      </div>

      <div className="grid divide-x divide-gray-100" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>
        {blocks.map((block, bi) => (
          <div key={bi}>
            <div className={`${colsGrid} border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400`}>
              <span className="text-right pr-0.5">#</span>
              <span className="pl-1">Participante</span>
              <span className="text-right">PTS</span>
              {showLast && <span className="text-center truncate">{lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Últ'}</span>}
              {showNext && <span className="text-center truncate">{nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próx'}</span>}
            </div>
            {block.map((r, ri) => {
              const z = zoneOf(r)
              const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z

              const isActive = activeParticipantId ? r.id === activeParticipantId : false
              const isPanela = panelaSet?.has(r.id) ?? false
              const shouldHighlight = !!highlightMode && highlightMode !== 'none' && z !== 'last' && (
                (highlightMode === 'me'     && isActive) ||
                (highlightMode === 'panela' && (isActive || isPanela)) ||
                (highlightMode === 'tribo'  && (tribeMemberSet?.has(r.id) ?? false))
              )
              const highlightRing = shouldHighlight ? 'ring-1 ring-inset ring-red-500' : ''
              const textCls = shouldHighlight ? 'text-red-600 font-semibold' : ZONE_TEXT[z]

              return (
                <div
                  key={r.id}
                  className={`${colsGrid} px-2 py-[3px] text-[12px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''} ${highlightRing}`}
                >
                  <span className={`text-right pr-0.5 tabular-nums ${textCls}`}>{r.rank}</span>
                  <span className={`pl-1 truncate ${textCls}`}>{r.apelido}{!isG112 && z === 'last' && ' 🔦'}</span>
                  <span className={`text-right tabular-nums font-bold ${textCls}`}>{r.pts}</span>
                  {showLast && (
                    <span className="text-center font-mono tabular-nums text-gray-600">
                      {r.lastMatchBet ? `${r.lastMatchBet.score_home}-${r.lastMatchBet.score_away}` : '—'}
                    </span>
                  )}
                  {showNext && (
                    <span className="text-center font-mono tabular-nums text-gray-600">
                      {r.nextMatchBet ? `${r.nextMatchBet.score_home}-${r.nextMatchBet.score_away}` : '—'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2">
        {legendItems.map(({ zone: z, label }) => (
          <span key={z} className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ZONE_DOT[z]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
