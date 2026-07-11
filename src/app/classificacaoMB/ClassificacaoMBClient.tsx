'use client'

import { memo, useMemo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  useSobeDesce,
  SobeDesceSelector,
  EvoCell,
  DeltaPtsCell,
  type DeltaEntry,
  type SobeDesceHighlights,
  type HighlightMode,
} from './SobeDesce'
import { toBlob } from 'html-to-image'
import { ExportableRankingBoard } from './ExportableRankingBoard'
import { brl, prizeForTiedRank } from '@/lib/prizes'

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
  storedPts: number
  lastMatchBet: { score_home: number; score_away: number } | null
  nextMatchBet: { score_home: number; score_away: number } | null
}

interface MatchInfo { id: string; abbr_home: string; abbr_away: string; score_home: number; score_away: number; penalty_winner: string | null }

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
  /** Valor em R$ de cada posição premiada — índice 0 = 1º lugar (fonte: página Premiação) */
  prizeAmounts: number[]
  activeParticipantId: string
  panelaMemberIds: string[]
  colVisibility: Record<string, boolean>
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
  /** ISO date (YYYY-MM-DD) do jogo mais recente com resultado */
  lastResultDate: string | null
  /** ISO date (YYYY-MM-DD) do primeiro jogo da fase atual */
  currentPhaseStartDate: string | null
  /** Controle admin: se false, usuários comuns não veem o Sobe e Desce */
  sobeDesceVisible: boolean
  isAdmin: boolean
  /** Última data com dados em participant_points_by_day — limita seletor de período */
  lastDataDate: string | null
  /** Se a página Minha Panela está habilitada para o usuário atual */
  minhaPanelaEnabled: boolean
  /** Lista de tribos disponíveis para destaque (admin/master only) */
  tribes: { id: string; name: string }[]
  /** Se os cortes já foram executados (listas congeladas) — define qual tabela usar em "Compartilhar Tabela" */
  cutsExecuted: { corte1: boolean; corte2: boolean }
}

type RankedRow = ParticipantRow & { rank: number; diffLider: number; diffPremio: number | null; diffCorte1: number | null; diffCorte2: number | null }

function TribeInlineButton({ tribes, activeTribeId, highlightMode, onSelect, onClear }: {
  tribes: { id: string; name: string }[]
  activeTribeId: string | null
  highlightMode: HighlightMode
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const activeName = tribes.find(t => t.id === activeTribeId)?.name
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
          highlightMode === 'tribo'
            ? 'bg-azul-escuro text-white'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
        }`}
      >
        {highlightMode === 'tribo' && activeName ? activeName : 'Destacar Tribo'} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {tribes.map(t => (
            <button
              key={t.id}
              onClick={() => { onSelect(t.id); setOpen(false) }}
              className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-50 transition ${
                activeTribeId === t.id ? 'font-semibold text-azul-escuro' : 'text-gray-700'
              }`}
            >
              {t.name}
            </button>
          ))}
          <div className="my-1 border-t border-gray-100" />
          <button
            onClick={() => { onClear(); setOpen(false) }}
            className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 transition"
          >
            Limpar destaque
          </button>
        </div>
      )}
    </div>
  )
}

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
  const std = mapping[raw.toLowerCase().trim()] ?? raw
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

// Tamanho oficial do 1º corte (G112, já executado — ver tournament_settings.corte1_participantes).
// O 2º corte (G56) é sempre metade do 1º corte, arredondado para cima — mesma base usada
// por G112CompactRanking. Antes desta constante, calcCuts recalculava o 1º corte a partir do
// total de participantes do bolão (sempre múltiplo de 10), o que nunca podia dar 112 e,
// consequentemente, nunca dava um 2º corte de 56 — o 56º colocado ficava fora da faixa "2º corte".
const G112_CORTE1_SIZE = 112

function calcCuts(n: number): { cut1: number; cut2: number } {
  const cut1 = Math.min(G112_CORTE1_SIZE, n)
  const cut2 = Math.ceil(cut1 / 2)
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
const BANNER_BG: Record<Zone, string> = {
  premio: 'bg-green-50 border-green-300',
  corte2: 'bg-sky-50 border-sky-300',
  corte1: 'bg-amber-50 border-amber-300',
  out:    'bg-gray-50 border-gray-200',
  last:   'bg-red-50 border-red-400',
}
const BANNER_RANK: Record<Zone, string> = {
  premio: 'text-green-700',
  corte2: 'text-sky-700',
  corte1: 'text-amber-700',
  out:    'text-gray-600',
  last:   'text-red-600',
}
const ZONE_STATUS: Record<Zone, string> = {
  premio: '🏆 Zona de premiação',
  corte2: '2º corte',
  corte1: '1º corte',
  out:    'Fora dos cortes',
  last:   '🔦 Lanterna',
}

function CompactRanking({
  ranked, premioSpots, isUniqueLast, renderedAt, matchesRegistered, groupsDefined, lastMatch,
  deltaMap, highlights, sdActive,
  highlightMode, activeParticipantId, panelaSet, tribeMemberSet,
}: {
  ranked: RankedRow[]
  premioSpots: number
  isUniqueLast: boolean
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
  lastMatch: MatchInfo | null
  deltaMap: Map<string, DeltaEntry> | null
  highlights: SobeDesceHighlights
  sdActive: boolean
  highlightMode: HighlightMode
  activeParticipantId: string
  panelaSet: Set<string>
  tribeMemberSet: Set<string>
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

  // Destaque via borda esquerda colorida (subida e queda apenas)
  function sdBorder(rowId: string): string {
    if (!sdActive) return ''
    if (highlights.maxUpIds.has(rowId))   return 'border-l-2 border-verde-500'
    if (highlights.maxDownIds.has(rowId)) return 'border-l-2 border-red-500'
    return 'border-l-2 border-transparent'
  }

  const colsGrid  = sdActive
    ? 'grid grid-cols-[1.4rem_1.6rem_1fr_2.2rem_2.5rem]'
    : 'grid grid-cols-[1.5rem_1fr_2rem]'
  const minW = sdActive ? 1450 : 1200

  const blockSize = Math.ceil(n / 7)
  const blocks = [0, 1, 2, 3, 4, 5, 6]
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
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm">

      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-base font-black text-gray-800">Classificação Melhor Bolão</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {dateStr}
          {matchesRegistered > 0 && (
            <>
              {' · '}{matchesRegistered} jogos registrados
              {lastMatch && (
                <> · último {lastMatch.abbr_home} {lastMatch.score_home}×{lastMatch.score_away}{lastMatch.penalty_winner ? 'P' : ''} {lastMatch.abbr_away}</>
              )}
              {' · '}{groupsDefined}/12 grupos definidos
            </>
          )}
        </p>
      </div>

      {/* 5 blocos lado a lado */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 divide-x divide-gray-100" style={{ minWidth: `${minW}px` }}>
          {blocks.map((block, bi) => (
            <div key={bi}>
              {/* cabeçalho do bloco */}
              <div className={`${colsGrid} border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400`}>
                <span className="text-right pr-0.5">#</span>
                {sdActive && <span className="text-center" title="Evolução de posição">↑↓</span>}
                <span className="pl-1">Participante</span>
                <span className="text-right">PTS</span>
                {sdActive && <span className="text-right" title="Pontos no período">↗</span>}
              </div>
              {/* linhas */}
              {block.map((r, ri) => {
                const z = zoneOf(r)
                const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z
                const isActive = r.id === activeParticipantId
                const isPanela = panelaSet.has(r.id)
                const shouldHighlight = z !== 'last' && (
                  (highlightMode === 'me'     && isActive) ||
                  (highlightMode === 'panela' && (isActive || isPanela)) ||
                  (highlightMode === 'tribo'  && tribeMemberSet.has(r.id))
                )
                const highlightRing = shouldHighlight ? 'ring-1 ring-inset ring-red-500' : ''
                const textCls = shouldHighlight ? 'text-red-600 font-semibold' : ZONE_TEXT[z]
                return (
                  <div
                    key={r.id}
                    className={`${colsGrid} px-2 py-[3px] text-[12px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''} ${sdBorder(r.id)} ${highlightRing}`}
                  >
                    <span className={`text-right pr-0.5 tabular-nums ${textCls}`}>{r.rank}</span>

                    {sdActive && (
                      <span className="flex items-center justify-center">
                        <EvoCell
                          delta={deltaMap?.get(r.id)}
                          isMaxUp={highlights.maxUpIds.has(r.id)}
                          isMaxDown={highlights.maxDownIds.has(r.id)}
                        />
                      </span>
                    )}

                    <span className={`pl-1 truncate ${textCls}`} title={r.apelido}>
                      {r.apelido}{z === 'last' && ' 🔦'}
                    </span>

                    <span className={`text-right tabular-nums font-bold ${textCls}`}>{r.pts}</span>

                    {sdActive && (
                      <span className="flex items-center justify-end">
                        <DeltaPtsCell
                          delta={deltaMap?.get(r.id)}
                          isMaxPts={highlights.maxPtsIds.has(r.id)}
                          isMinPts={highlights.minPtsIds.has(r.id)}
                        />
                      </span>
                    )}
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
          <span key={z} className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ZONE_DOT[z]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Classificação G112 / G56 (compacta, 4 blocos) ─────────────────────────────

function GCompactRanking({
  title, sliceSize, numBlocks, hasCut2, highlightLeader,
  ranked, premioSpots, renderedAt, matchesRegistered, lastMatch, nextMatch,
  showLastMatch, showNextMatch, showPremio, prizeMap,
  deltaMap, highlights, sdActive,
  highlightMode, activeParticipantId, panelaSet, tribeMemberSet,
}: {
  title: string
  sliceSize: number
  numBlocks: number
  /** Se há um 2º corte de eliminação dentro deste recorte (ex.: G112 → G56). O G56 não tem próximo corte — todos avançam até o final. */
  hasCut2: boolean
  /** Destaca a linha inteira do 1º colocado com uma cor diferenciada */
  highlightLeader: boolean
  ranked: RankedRow[]
  premioSpots: number
  renderedAt: string
  matchesRegistered: number
  lastMatch: MatchInfo | null
  nextMatch: MatchInfo | null
  showLastMatch: boolean
  showNextMatch: boolean
  /** Coluna Prêmio — exibida apenas no primeiro bloco */
  showPremio: boolean
  prizeMap: Map<string, number>
  deltaMap: Map<string, DeltaEntry> | null
  highlights: SobeDesceHighlights
  sdActive: boolean
  highlightMode: HighlightMode
  activeParticipantId: string
  panelaSet: Set<string>
  tribeMemberSet: Set<string>
}) {
  const n = ranked.length
  if (n === 0) return null

  const rankedSlice = ranked.slice(0, sliceSize)

  // Top metade do bloco avança para a próxima fase de corte (não se aplica ao G56)
  const cut2 = hasCut2 ? Math.ceil(rankedSlice.length / 2) : 0
  const premioLine = ranked[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line   = hasCut2 && cut2 > premioSpots ? (ranked[cut2 - 1]?.pts ?? null) : null

  type G112Zone = 'premio' | 'corte2' | 'out'

  const G112_ZONE_ROW: Record<G112Zone, string> = {
    premio: 'bg-green-50',
    corte2: 'bg-sky-50',
    out:    'bg-white',
  }
  const G112_ZONE_TEXT: Record<G112Zone, string> = {
    premio: 'text-green-800 font-semibold',
    corte2: 'text-sky-700 font-medium',
    out:    'text-gray-400',
  }

  function g112ZoneOf(r: RankedRow): G112Zone {
    if (r.pts >= premioLine)                    return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line) return 'corte2'
    return 'out'
  }

  // Destaque via borda esquerda colorida (subida e queda apenas)
  function sdBorder(rowId: string): string {
    if (!sdActive) return ''
    if (highlights.maxUpIds.has(rowId))   return 'border-l-2 border-verde-500'
    if (highlights.maxDownIds.has(rowId)) return 'border-l-2 border-red-500'
    return 'border-l-2 border-transparent'
  }

  // Colunas montadas dinamicamente (largura via style, não classe Tailwind literal,
  // pois o nº de colunas opcionais — Prêmio/Últ./Próx. — varia por combinação).
  // Prêmio só aparece no 1º bloco, então há duas larguras de coluna possíveis.
  const baseColWidths: string[] = ['1.5rem']
  if (sdActive) baseColWidths.push('1.6rem')
  baseColWidths.push('1fr', '2rem')
  if (sdActive) baseColWidths.push('2.5rem')
  if (showLastMatch) baseColWidths.push('3.5rem')
  if (showNextMatch) baseColWidths.push('3.5rem')
  const rowStyle: CSSProperties = { gridTemplateColumns: baseColWidths.join(' ') }
  const rowStyleWithPremio: CSSProperties = { gridTemplateColumns: ['4.75rem', ...baseColWidths].join(' ') }
  // +30% na largura base (coluna Participante, que é '1fr', absorve o ganho).
  // A coluna Prêmio some no 1º bloco: como a largura total é dividida igualmente
  // entre os `numBlocks` blocos (grid-cols-4), multiplicamos seu custo por numBlocks
  // para que o 1º bloco não perca espaço da coluna Participante para os demais.
  const minW = Math.round((sdActive ? 1408 : 1152) * 1.3) + (showPremio ? 76 * numBlocks : 0)
  const BLOCK_SIZE = Math.ceil(sliceSize / numBlocks)
  const blocks = Array.from({ length: numBlocks }, (_, i) =>
    rankedSlice.slice(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE),
  ).filter(b => b.length > 0)

  const dateStr = formatRenderedAt(renderedAt)

  const legendItems: { zone: G112Zone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(hasCut2 && cut2 > premioSpots ? [{ zone: 'corte2' as G112Zone, label: `2º corte (top ${cut2})` }] : []),
  ]

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm">

      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-base font-black text-gray-800">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {dateStr}
          {matchesRegistered > 0 && (
            <>
              {' · '}{matchesRegistered} jogos registrados
              {lastMatch && (
                <> · último {lastMatch.abbr_home} {lastMatch.score_home}×{lastMatch.score_away}{lastMatch.penalty_winner ? 'P' : ''} {lastMatch.abbr_away}</>
              )}
            </>
          )}
        </p>
      </div>

      {/* blocos lado a lado — scroll horizontal no mobile */}
      <div className="overflow-x-auto">
        <div className="grid grid-cols-4 divide-x divide-gray-100" style={{ minWidth: `${minW}px` }}>
          {blocks.map((block, bi) => {
            const showPremioInBlock = showPremio && bi === 0
            const blockStyle = showPremioInBlock ? rowStyleWithPremio : rowStyle
            return (
              <div key={bi}>
                {/* cabeçalho do bloco */}
                <div className="grid border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400" style={blockStyle}>
                  {showPremioInBlock && <span className="text-right pr-0.5" title="Valor do prêmio">Prêmio</span>}
                  <span className="text-right pr-0.5">#</span>
                  {sdActive && <span className="text-center" title="Evolução de posição">↑↓</span>}
                  <span className="pl-1">Participante</span>
                  <span className="text-right">PTS</span>
                  {sdActive && <span className="text-right" title="Pontos no período">↗</span>}
                  {showLastMatch && <span className="text-center truncate md:text-[10px]" title="Palpite no último jogo">{lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Últ'}</span>}
                  {showNextMatch && <span className="text-center truncate md:text-[10px]" title="Palpite no próximo jogo">{nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próx'}</span>}
                </div>
                {/* linhas */}
                {block.map((r, ri) => {
                  const z = g112ZoneOf(r)
                  const boundary = ri > 0 && g112ZoneOf(block[ri - 1]) !== z
                  const isActive = r.id === activeParticipantId
                  const isPanela = panelaSet.has(r.id)
                  const shouldHighlight = (
                    (highlightMode === 'me'     && isActive) ||
                    (highlightMode === 'panela' && (isActive || isPanela)) ||
                    (highlightMode === 'tribo'  && tribeMemberSet.has(r.id))
                  )
                  const isLeader = highlightLeader && r.rank === 1
                  const highlightRing = shouldHighlight ? 'ring-1 ring-inset ring-red-500' : ''
                  const textCls = shouldHighlight ? 'text-red-600 font-semibold' : isLeader ? 'text-amber-900 font-extrabold' : G112_ZONE_TEXT[z]
                  const rowBg = isLeader ? 'bg-amber-200' : G112_ZONE_ROW[z]
                  const prizeAmount = prizeMap.get(r.id)
                  return (
                    <div
                      key={r.id}
                      className={`grid px-2 py-[3px] text-[12px] ${rowBg} ${boundary ? 'border-t border-gray-200' : ''} ${sdBorder(r.id)} ${highlightRing}`}
                      style={blockStyle}
                    >
                      {showPremioInBlock && (
                        <span className={`text-right pr-0.5 tabular-nums truncate ${prizeAmount ? 'text-amber-600 font-semibold' : 'text-gray-300'}`}>
                          {prizeAmount ? brl(prizeAmount, { cents: false }) : '—'}
                        </span>
                      )}
                      <span className={`text-right pr-0.5 tabular-nums ${textCls}`}>{r.rank}</span>

                      {sdActive && (
                        <span className="flex items-center justify-center">
                          <EvoCell
                            delta={deltaMap?.get(r.id)}
                            isMaxUp={highlights.maxUpIds.has(r.id)}
                            isMaxDown={highlights.maxDownIds.has(r.id)}
                          />
                        </span>
                      )}

                      <span className={`pl-1 truncate ${textCls}`} title={r.apelido}>{r.apelido}{isLeader && ' 👑'}</span>
                      <span className={`text-right tabular-nums font-bold ${textCls}`}>{r.pts}</span>

                      {sdActive && (
                        <span className="flex items-center justify-end">
                          <DeltaPtsCell
                            delta={deltaMap?.get(r.id)}
                            isMaxPts={highlights.maxPtsIds.has(r.id)}
                            isMinPts={highlights.minPtsIds.has(r.id)}
                          />
                        </span>
                      )}

                      {showLastMatch && <span className="text-center font-mono tabular-nums text-gray-600 md:text-[13px]"><BetCell bet={r.lastMatchBet} /></span>}
                      {showNextMatch && <span className="text-center font-mono tabular-nums text-gray-600 md:text-[13px]"><BetCell bet={r.nextMatchBet} /></span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legenda */}
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

export function ClassificacaoMBClient({
  rows, lastMatch, nextMatch,
  eliminatedTeams, eliminatedStdScorers,
  scorerMapping, teamAbbrs, prizeSpots, premioSpots, prizeAmounts,
  activeParticipantId, panelaMemberIds, colVisibility, renderedAt, matchesRegistered, groupsDefined,
  lastResultDate, currentPhaseStartDate,
  sobeDesceVisible, isAdmin, lastDataDate, minhaPanelaEnabled,
  tribes, cutsExecuted,
}: Props) {
  const router = useRouter()
  const elTeams    = useMemo(() => new Set(eliminatedTeams),   [eliminatedTeams])
  const elStd      = useMemo(() => new Set(eliminatedStdScorers), [eliminatedStdScorers])
  const panelaSet  = useMemo(() => new Set(panelaMemberIds),   [panelaMemberIds])
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('me')
  const showPanelaOption = minhaPanelaEnabled && panelaMemberIds.length > 0
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // ── Compartilhar Tabela (mobile) ───────────────────────────────────────────
  const [showExport, setShowExport] = useState(false)
  const [isSharing, setIsSharing]   = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showExport || !exportRef.current) return
    const el = exportRef.current
    let cancelled = false

    async function capture() {
      await document.fonts.ready
      if (cancelled) return

      try {
        const opts = { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' }
        // Primeira chamada: aquece o cache interno de fontes/recursos da lib
        await toBlob(el, opts).catch(() => null)
        if (cancelled) return
        // Segunda chamada: captura com todos os recursos já cacheados
        const blob = await toBlob(el, opts)
        if (cancelled || !blob) return
        const file = new File([blob], 'classificacao.png', { type: 'image/png' })
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          const stamp = (() => { try { return new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) } catch { return '' } })()
          const matchLine = lastMatch ? `\nApós ${lastMatch.abbr_home} ${lastMatch.score_home}×${lastMatch.score_away} ${lastMatch.abbr_away}` : ''
          await navigator.share({ files: [file], title: 'Classificação Melhor Bolão', text: `Classificação Melhor Bolão ${stamp}${matchLine}` })
        } else {
          const url = URL.createObjectURL(blob)
          const a   = document.createElement('a')
          a.href     = url
          a.download = 'classificacao.png'
          a.click()
          URL.revokeObjectURL(url)
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          console.error('Erro ao compartilhar classificação:', err)
        }
      } finally {
        if (!cancelled) { setShowExport(false); setIsSharing(false) }
      }
    }

    void capture()
    return () => { cancelled = true }
  }, [showExport])

  // ── Destaque de Tribo (admin/master only) ──────────────────────────────────
  const [activeTribeId, setActiveTribeId]   = useState<string | null>(null)
  const [tribeMemberSet, setTribeMemberSet] = useState<Set<string>>(new Set())

  async function selectTribe(id: string | null) {
    if (!id) {
      setActiveTribeId(null)
      setTribeMemberSet(new Set())
      return
    }
    setActiveTribeId(id)
    try {
      const supabase = createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('participant_tribes')
        .select('participant_id')
        .eq('tribe_id', id)
      setTribeMemberSet(new Set(((data ?? []) as { participant_id: string }[]).map(r => r.participant_id)))
    } catch { setTribeMemberSet(new Set()) }
  }

  function handleHighlightChange(mode: HighlightMode) {
    setHighlightMode(mode)
    if (mode !== 'tribo') {
      setActiveTribeId(null)
      setTribeMemberSet(new Set())
    }
  }

  const handleSort = (key: string, defaultDir: 'asc' | 'desc' = 'desc') => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(defaultDir)
    }
  }

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('artillary-ranking-refresh')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tournament_settings' },
        (payload) => {
          const row = payload.new as { key: string; value: string }
          if (row.key === 'artillary_points_active') router.refresh()
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [router])

  const showPremio      = colVisibility['premio']        ?? false
  const showLastMatch   = colVisibility['last_match']    ?? true
  const showNextMatch   = colVisibility['next_match']    ?? true
  const showDeltaPremio = colVisibility['delta_premio']  ?? true
  const showDeltaCorte1 = colVisibility['delta_corte1']  ?? true
  const showDeltaCorte2 = colVisibility['delta_corte2']  ?? true
  const showPtsJg       = colVisibility['pts_jg']        ?? true
  const showPtsCl       = colVisibility['pts_cl']        ?? true
  const showPtsG4       = colVisibility['pts_g4']        ?? true

  const { ranked, cutPts, lastRank, isUniqueLast, premioLine, cut2Line, cut1Line } = useMemo((): {
    ranked: RankedRow[]; cutPts: number | null
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
      const rank = i === 0 ? 1
        : sorted[i].pts === sorted[i - 1].pts ? withRank[i - 1].rank
        : i + 1
      withRank.push({ ...sorted[i], rank })
    }

    const { cut1, cut2 } = calcCuts(n)
    const cut1Pts = n > 0 && cut1 > 0 ? (sorted[Math.min(cut1, n) - 1]?.pts ?? null) : null
    const cut2Pts = n > 0 && cut2 > 0 ? (sorted[Math.min(cut2, n) - 1]?.pts ?? null) : null

    const out: RankedRow[] = withRank.map(r => ({
      ...r,
      diffLider: r.pts - leaderPts,
      diffPremio: premioCut !== null ? r.pts - premioCut : null,
      diffCorte1: cut1Pts !== null ? r.pts - cut1Pts : null,
      diffCorte2: cut2Pts !== null ? r.pts - cut2Pts : null,
    }))

    const lastRankVal    = n > 0 ? withRank[n - 1].rank : 0
    const isUniqueLastVal = n > 0 && out.filter(r => r.rank === lastRankVal).length === 1
    const premioLineVal = n > 0 ? (sorted[Math.min(premioSpots, n) - 1]?.pts ?? Infinity) : Infinity
    const cut2LineVal   = cut2 > premioSpots ? (sorted[cut2 - 1]?.pts ?? null) : null
    const cut1LineVal   = cut1 > cut2        ? (sorted[cut1 - 1]?.pts ?? null) : null

    return { ranked: out, cutPts: cut, lastRank: lastRankVal, isUniqueLast: isUniqueLastVal, premioLine: premioLineVal, cut2Line: cut2LineVal, cut1Line: cut1LineVal }
  }, [rows, prizeSpots, premioSpots])

  // Compartilhar Tabela: usa sempre a classificação com menos participantes já
  // disponível — G56 se o 2º corte foi executado, senão G112 se o 1º corte foi
  // executado, senão a lista completa (nenhum corte ainda disponível).
  const exportConfig = useMemo((): { size: number; mode: 'full' | 'g112' | 'g56' } => {
    if (cutsExecuted.corte2) return { size: 56, mode: 'g56' }
    if (cutsExecuted.corte1) return { size: 112, mode: 'g112' }
    return { size: ranked.length, mode: 'full' }
  }, [cutsExecuted, ranked.length])

  // Valor de prêmio por participante — rateado entre empatados dentro da zona
  // premiada (Regulamento item 33: soma-se as faixas empatadas e divide-se igualmente).
  const prizeMap = useMemo(() => {
    const map = new Map<string, number>()
    const byRank = new Map<number, RankedRow[]>()
    for (const r of ranked) {
      if (r.rank > prizeAmounts.length) continue
      const group = byRank.get(r.rank) ?? []
      group.push(r)
      byRank.set(r.rank, group)
    }
    for (const [rank, group] of byRank) {
      const amount = prizeForTiedRank(prizeAmounts, rank, group.length)
      for (const r of group) map.set(r.id, amount)
    }
    return map
  }, [ranked, prizeAmounts])

  const sortedRanked = useMemo(() => {
    if (!sortKey) return ranked
    return [...ranked].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey]
      const bv = (b as unknown as Record<string, unknown>)[sortKey]
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'string') {
        return sortDir === 'asc'
          ? (av as string).localeCompare(bv as string, 'pt-BR')
          : (bv as string).localeCompare(av as string, 'pt-BR')
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [ranked, sortKey, sortDir])

  // ── Sobe e Desce ───────────────────────────────────────────────────────────
  const rankedRowsForSD = useMemo(
    () => ranked.map(r => ({ id: r.id, pts: r.pts, storedPts: r.storedPts, rank: r.rank })),
    [ranked],
  )
  const {
    mode: sdMode, setMode: setSdMode,
    customFrom: sdCustomFrom, setCustomFrom: setSdCustomFrom,
    customTo: sdCustomTo, setCustomTo: setSdCustomTo,
    deltaMap, loading: sdLoading,
    highlights, refDateLabel, refToDateLabel, hasData: sdHasData,
  } = useSobeDesce({ lastResultDate, currentPhaseStartDate, rankedRows: rankedRowsForSD, lastDataDate })
  // Usuários comuns só veem se o admin habilitou; admins sempre veem
  const sdAllowed = sobeDesceVisible || isAdmin
  const sdActive = sdAllowed && sdMode !== 'hidden'

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

  const myRow = useMemo(
    () => ranked.find(r => r.id === activeParticipantId) ?? null,
    [ranked, activeParticipantId],
  )
  const myZone: Zone | null = myRow ? zoneOf(myRow) : null

  const th = (label: string, title?: string, cls = '') => (
    <th className={`px-1.5 py-2 text-center whitespace-nowrap ${cls}`} title={title ?? label}>
      {label}
    </th>
  )

  const sth = (label: string, sortK: string, title?: string, cls = '', defaultDir: 'asc' | 'desc' = 'desc', align = 'text-center') => {
    const active = sortKey === sortK
    return (
      <th
        className={`px-1.5 py-2 ${align} whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors ${cls}`}
        title={title ?? label}
        onClick={() => handleSort(sortK, defaultDir)}
      >
        {label}
        <span className="ml-0.5 text-[8px] text-gray-300">{active ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}</span>
      </th>
    )
  }

  return (
    <>
    <div className="mx-auto max-w-full px-2 py-4 pb-32 sm:px-4 sm:py-6">

      {/* Banner: Minha Posição */}
      {myRow && myZone && (
        <div className={`mb-4 rounded-xl border-2 ${BANNER_BG[myZone]} px-4 py-3`}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-4xl font-black tabular-nums leading-none ${BANNER_RANK[myZone]}`}>
                #{myRow.rank}
              </span>
              <span className="text-sm text-gray-400 leading-none">/ {ranked.length}</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-base font-bold text-gray-900 leading-tight truncate">{myRow.apelido}</span>
              <span className="text-xs text-gray-400">{ZONE_STATUS[myZone]}</span>
            </div>
            <div className={`text-2xl font-black tabular-nums leading-none ${BANNER_RANK[myZone]}`}>
              {myRow.pts}<span className="text-sm font-semibold text-gray-400 ml-1">pts</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              {myRow.diffLider < 0 && (
                <span><span className="font-semibold text-red-500">{myRow.diffLider}</span> p/ líder</span>
              )}
              {myRow.diffPremio !== null && myRow.diffPremio < 0 && (
                <span><span className="font-semibold text-red-500">{myRow.diffPremio}</span> p/ prêmio</span>
              )}
              {myRow.diffPremio !== null && myRow.diffPremio > 0 && (
                <span><span className="font-semibold text-green-600">+{myRow.diffPremio}</span> s/ prêmio</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barra de controles: Sobe e Desce + Destaques (acima da tabela compacta) */}
      {sdAllowed ? (
        <SobeDesceSelector
          mode={sdMode}
          setMode={setSdMode}
          customFrom={sdCustomFrom}
          setCustomFrom={setSdCustomFrom}
          customTo={sdCustomTo}
          setCustomTo={setSdCustomTo}
          loading={sdLoading}
          refDateLabel={refDateLabel}
          refToDateLabel={refToDateLabel}
          hasData={sdHasData}
          lastResultDate={lastResultDate}
          currentPhaseStartDate={currentPhaseStartDate}
          lastDataDate={lastDataDate}
          highlightMode={highlightMode}
          onHighlightChange={handleHighlightChange}
          showPanelaOption={showPanelaOption}
          tribes={isAdmin && tribes.length > 0 ? tribes : []}
          activeTribeId={activeTribeId}
          onTribeSelect={selectTribe}
        />
      ) : (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
            {([
              { value: 'me'   as HighlightMode, label: 'Destacar meu nome' },
              ...(showPanelaOption ? [{ value: 'panela' as HighlightMode, label: 'Destacar minha panela' }] : []),
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => handleHighlightChange(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  highlightMode === opt.value
                    ? 'bg-azul-escuro text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
            {isAdmin && tribes.length > 0 && (
              <TribeInlineButton
                tribes={tribes}
                activeTribeId={activeTribeId}
                highlightMode={highlightMode}
                onSelect={id => { selectTribe(id); setHighlightMode('tribo') }}
                onClear={() => handleHighlightChange('none')}
              />
            )}
            <button
              onClick={() => handleHighlightChange('none')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                highlightMode === 'none'
                  ? 'bg-azul-escuro text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sem destaques
            </button>
          </div>
        </div>
      )}

      {/* Classificação G56 — tabela compacta top 56, com Sobe e Desce */}
      <GCompactRanking
        title="Classificação G56"
        sliceSize={56}
        numBlocks={4}
        hasCut2={false}
        highlightLeader={true}
        ranked={ranked}
        premioSpots={premioSpots}
        renderedAt={renderedAt}
        matchesRegistered={matchesRegistered}
        lastMatch={lastMatch}
        nextMatch={nextMatch}
        showLastMatch={showLastMatch}
        showNextMatch={showNextMatch}
        showPremio={showPremio}
        prizeMap={prizeMap}
        deltaMap={deltaMap}
        highlights={highlights}
        sdActive={sdActive}
        highlightMode={highlightMode}
        activeParticipantId={activeParticipantId}
        panelaSet={panelaSet}
        tribeMemberSet={tribeMemberSet}
      />

      {/* Classificação G112 — tabela compacta top 112, com Sobe e Desce */}
      <GCompactRanking
        title="Classificação G112"
        sliceSize={G112_CORTE1_SIZE}
        numBlocks={4}
        hasCut2={true}
        highlightLeader={false}
        ranked={ranked}
        premioSpots={premioSpots}
        renderedAt={renderedAt}
        matchesRegistered={matchesRegistered}
        lastMatch={lastMatch}
        nextMatch={nextMatch}
        showLastMatch={showLastMatch}
        showNextMatch={showNextMatch}
        showPremio={false}
        prizeMap={prizeMap}
        deltaMap={deltaMap}
        highlights={highlights}
        sdActive={sdActive}
        highlightMode={highlightMode}
        activeParticipantId={activeParticipantId}
        panelaSet={panelaSet}
        tribeMemberSet={tribeMemberSet}
      />

      {/* Classificação Melhor Bolão — tabela compacta com Sobe e Desce */}
      <CompactRanking
        ranked={ranked}
        premioSpots={premioSpots}
        isUniqueLast={isUniqueLast}
        renderedAt={renderedAt}
        matchesRegistered={matchesRegistered}
        groupsDefined={groupsDefined}
        lastMatch={lastMatch}
        deltaMap={deltaMap}
        highlights={highlights}
        sdActive={sdActive}
        highlightMode={highlightMode}
        activeParticipantId={activeParticipantId}
        panelaSet={panelaSet}
        tribeMemberSet={tribeMemberSet}
      />

      <div className="mb-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-black text-gray-900">Classificação Detalhada</h1>
          <span className="text-[10px] text-gray-400">{formatRenderedAt(renderedAt)}</span>
          <span className="text-[10px] text-gray-400">
            · {matchesRegistered} jogos registrados
            {lastMatch && <> · último {lastMatch.abbr_home} {lastMatch.score_home}×{lastMatch.score_away}{lastMatch.penalty_winner ? 'P' : ''} {lastMatch.abbr_away}</>}
            {' · '}{groupsDefined}/12 grupos definidos
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '900px' }}>
            <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              <tr>
                {/* Prêmio (opcional, antes de #) */}
                {showPremio && (
                  <th className="px-1.5 py-2 text-center w-32 whitespace-nowrap" title="Valor do prêmio (rateado em caso de empate)">Prêmio</th>
                )}

                {/* Identidade */}
                {sth('#', 'rank', 'Colocação', 'w-8', 'asc', 'text-left')}
                {sth('Participante', 'apelido', 'Nome do participante', 'w-[150px]', 'asc', 'text-left')}
                {sth('Pts', 'pts', 'Pontuação total', 'w-10', 'desc', 'text-right')}

                {/* Último / Próximo jogo */}
                {showLastMatch && (
                  <th
                    className="table-cell px-1.5 py-2 text-center w-14"
                    title="Palpite no último jogo disputado"
                  >
                    {lastMatch ? `${lastMatch.abbr_home}×${lastMatch.abbr_away}` : 'Último'}
                  </th>
                )}
                {showNextMatch && (
                  <th
                    className="table-cell px-1.5 py-2 text-center w-14"
                    title="Palpite no próximo jogo"
                  >
                    {nextMatch ? `${nextMatch.abbr_home}×${nextMatch.abbr_away}` : 'Próx.'}
                  </th>
                )}

                {/* Estatísticas de jogos */}
                {sth('Cravou', 'cravados', 'Jogos Cravados (placar exato)', 'table-cell w-12')}
                {sth('Pontuou', 'pontuados', 'Jogos Pontuados', 'table-cell w-14')}
                {sth('🦓 Apost.', 'zebraApostada', '🦓 Apostada — número de apostas em resultados minoritários (possíveis zebras)', 'table-cell w-16')}
                {sth('🦓 Pont.', 'zebraPontuada', '🦓 Pontuada — zebras reais em que acertou o resultado', 'table-cell w-14')}

                {/* Diferenças */}
                {sth('∆ Líder', 'diffLider', 'Diferença pro Líder', 'hidden md:table-cell w-14')}
                {showDeltaPremio && sth('∆ Prêmio', 'diffPremio', `Diferença pro ${premioSpots}º colocado (1º premiado)`, 'hidden md:table-cell w-16')}
                {showDeltaCorte1 && sth('∆ Corte 1', 'diffCorte1', 'Diferença para o 1º corte (≈ posição 112)', 'w-16')}
                {showDeltaCorte2 && sth('∆ Corte 2', 'diffCorte2', 'Diferença para o 2º corte (≈ posição 56)', 'w-16')}

                {/* Breakdown de pontos */}
                {showPtsJg && sth('Pts Jg', 'ptsMatches', 'Pontos com Jogos', 'hidden md:table-cell w-12')}
                {showPtsCl && sth('Pts Cl', 'ptsClassif', 'Pontos com Classificação de Grupos + 3os Lugares', 'hidden md:table-cell w-12')}
                {showPtsG4 && sth('Pts G4 + Art', 'ptsG4', 'Pontos com G4 + Artilheiro', 'hidden md:table-cell w-16')}

                {/* G4 picks */}
                {th('1º', 'Aposta: Campeão', 'w-11')}
                {th('2º', 'Aposta: Vice-campeão', 'w-11')}
                {th('3°', 'Aposta: 3º Lugar', 'table-cell w-11')}
                {th('4°', 'Aposta: 4º Lugar', 'table-cell w-11')}
                <th className="table-cell px-1.5 py-2 text-left min-w-[80px]" title="Aposta: Artilheiro">⚽</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={99} className="py-12 text-center text-sm text-gray-400">
                    Nenhum participante cadastrado ainda.
                  </td>
                </tr>
              )}
              {sortedRanked.map(row => {
                const isActive  = row.id === activeParticipantId
                const isPanela  = panelaSet.has(row.id)
                const z         = zoneOf(row)
                const boundary  = tiedAtBoundary && row.pts === cutPts

                const rowBg = z === 'last' ? ZONE_ROW.last : ZONE_ROW[z]
                const shouldHighlight = z !== 'last' && (
                  (highlightMode === 'me'     && isActive) ||
                  (highlightMode === 'panela' && (isActive || isPanela)) ||
                  (highlightMode === 'tribo'  && tribeMemberSet.has(row.id))
                )
                const highlighted = highlightMode !== 'none'
                const fontCls = z === 'last' ? 'font-bold' : ''
                const highlightCls = shouldHighlight ? '[&_td]:!text-red-600 [&_td]:!font-bold' : ''

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-gray-100 last:border-0 ${rowBg} ${fontCls} ${highlightCls} ${z === 'last' ? '[&_*]:!text-white' : ''}`}
                  >
                    {showPremio && (
                      <td className="px-1.5 py-1 text-center tabular-nums whitespace-nowrap">
                        {(() => {
                          const amount = prizeMap.get(row.id)
                          return amount ? (
                            <span className={z === 'last' ? '' : 'text-amber-600 font-semibold'}>{brl(amount, { cents: false })}</span>
                          ) : (
                            <span className={z === 'last' ? '' : 'text-gray-300'}>—</span>
                          )
                        })()}
                      </td>
                    )}

                    <td className={`px-1.5 py-1 tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-500'}`}>
                      {row.rank}
                      {boundary && <span className={`ml-0.5 ${z === 'last' ? 'text-white' : 'text-amber-500'}`} title="Empate no corte">⚠</span>}
                    </td>

                    <td className={`px-1.5 py-1 w-[150px] ${z === 'last' ? 'text-white' : 'text-gray-900'}`}
                        title={row.apelido}>
                      <div className="truncate">
                        {row.apelido}
                        {z === 'last' && <span className="ml-1 text-[11px]">🔦</span>}
                        {isActive && highlighted && <span className={`ml-1 text-[10px] ${z === 'last' ? 'text-white' : 'text-verde-600'}`}>◀</span>}
                      </div>
                    </td>
                    <td className={`px-1.5 py-1 text-right font-mono font-bold tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-900'}`}>
                      {row.pts}
                    </td>

                    {/* Último / Próximo */}
                    {showLastMatch && (
                      <td className={`table-cell px-1.5 py-1 text-center ${z === 'last' ? 'text-white' : 'text-gray-700'}`}>
                        <BetCell bet={row.lastMatchBet} />
                      </td>
                    )}
                    {showNextMatch && (
                      <td className={`table-cell px-1.5 py-1 text-center ${z === 'last' ? 'text-white' : 'text-gray-700'}`}>
                        <BetCell bet={row.nextMatchBet} />
                      </td>
                    )}

                    {/* Estatísticas */}
                    <td className="table-cell px-1.5 py-1 text-center">
                      <Num v={row.cravados} green />
                    </td>
                    <td className="table-cell px-1.5 py-1 text-center">
                      <Num v={row.pontuados} />
                    </td>
                    <td className="table-cell px-1.5 py-1 text-center">
                      <Num v={row.zebraApostada} green />
                    </td>
                    <td className="table-cell px-1.5 py-1 text-center">
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
                    {showDeltaCorte1 && (
                      <td className="px-1.5 py-1 text-right">
                        <Diff v={row.diffCorte1} />
                      </td>
                    )}
                    {showDeltaCorte2 && (
                      <td className="px-1.5 py-1 text-right">
                        <Diff v={row.diffCorte2} />
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
                    <td className="table-cell px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi1}     abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="table-cell px-1.5 py-1 text-center">
                      <TeamCell team={row.tournamentBet?.semi2}     abbrs={teamAbbrs} elTeams={elTeams} />
                    </td>
                    <td className="table-cell px-1.5 py-1 max-w-[100px] truncate">
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

    {/* Botão Compartilhar Tabela — apenas mobile */}
    <button
      onClick={() => { setIsSharing(true); setShowExport(true) }}
      disabled={isSharing}
      className="block md:hidden fixed bottom-6 right-4 z-50 flex items-center gap-2 rounded-full bg-azul-escuro px-4 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-70 transition"
      aria-label="Compartilhar classificação"
    >
      {isSharing ? (
        <span>Gerando imagem...</span>
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          <span>Compartilhar Tabela</span>
        </>
      )}
    </button>

    {/* Componente invisível para exportação — montado apenas ao compartilhar */}
    {showExport && (
      <div
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'hidden', height: 0, width: 0 }}
        aria-hidden="true"
      >
        <div ref={exportRef} style={{ width: '1600px' }}>
          <ExportableRankingBoard
            ranked={ranked.slice(0, exportConfig.size)}
            premioSpots={premioSpots}
            renderedAt={renderedAt}
            matchesRegistered={matchesRegistered}
            groupsDefined={groupsDefined}
            lastMatch={lastMatch}
            nextMatch={nextMatch}
            showLastMatch={showLastMatch}
            showNextMatch={showNextMatch}
            highlightMode={highlightMode}
            activeParticipantId={activeParticipantId}
            panelaSet={panelaSet}
            tribeMemberSet={tribeMemberSet}
            mode={exportConfig.mode}
          />
        </div>
      </div>
    )}
    </>
  )
}
