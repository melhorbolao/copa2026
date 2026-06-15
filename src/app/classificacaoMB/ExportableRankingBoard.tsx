'use client'

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

function calcCuts(n: number) {
  const cut1 = Math.min(Math.ceil((n * 0.5) / 10) * 10, n)
  const cut2 = Math.min(Math.ceil((cut1 * 0.5) / 10) * 10, cut1)
  return { cut1, cut2 }
}

function formatStamp(iso: string) {
  try {
    const d = new Date(iso)
    const day   = d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
    const time  = d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    return `${day} - ${time}`
  } catch { return '' }
}

interface ExportRow { id: string; apelido: string; pts: number; rank: number }
interface LastMatch { abbr_home: string; abbr_away: string; score_home: number; score_away: number; penalty_winner: string | null }

interface Props {
  ranked: ExportRow[]
  premioSpots: number
  renderedAt: string
  matchesRegistered: number
  groupsDefined: number
  lastMatch: LastMatch | null
}

export function ExportableRankingBoard({ ranked, premioSpots, renderedAt, matchesRegistered, groupsDefined, lastMatch }: Props) {
  const n = ranked.length
  if (n === 0) return null

  const { cut1, cut2 } = calcCuts(n)
  const premioLine   = ranked[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line     = cut2 > premioSpots ? (ranked[cut2 - 1]?.pts ?? null) : null
  const cut1Line     = cut1 > cut2        ? (ranked[cut1 - 1]?.pts ?? null) : null
  const lastRank     = ranked[n - 1].rank
  const isUniqueLast = ranked.filter(r => r.rank === lastRank).length === 1

  function zoneOf(r: ExportRow): Zone {
    if (isUniqueLast && r.rank === lastRank)       return 'last'
    if (r.pts >= premioLine)                       return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line)    return 'corte2'
    if (cut1Line !== null && r.pts >= cut1Line)    return 'corte1'
    return 'out'
  }

  const blockSize = Math.ceil(n / 7)
  const blocks = Array.from({ length: 7 }, (_, i) => ranked.slice(i * blockSize, (i + 1) * blockSize)).filter(b => b.length > 0)

  const legendItems: { zone: Zone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(cut2 > premioSpots ? [{ zone: 'corte2' as Zone, label: `2º corte (top ${cut2})` }] : []),
    ...(cut1 > cut2        ? [{ zone: 'corte1' as Zone, label: `1º corte (top ${cut1})` }] : []),
    ...(isUniqueLast ? [{ zone: 'last' as Zone, label: 'Lanterna' }] : []),
  ]

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <p className="text-base font-black text-gray-800">
          Classificação Melhor Bolão {formatStamp(renderedAt)}
        </p>
        {matchesRegistered > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">
            {matchesRegistered} jogos registrados
            {lastMatch && <> · último {lastMatch.abbr_home} {lastMatch.score_home}×{lastMatch.score_away}{lastMatch.penalty_winner ? 'P' : ''} {lastMatch.abbr_away}</>}
            {' · '}{groupsDefined}/12 grupos definidos
          </p>
        )}
      </div>

      <div className="grid divide-x divide-gray-100" style={{ gridTemplateColumns: `repeat(${blocks.length}, 1fr)` }}>
        {blocks.map((block, bi) => (
          <div key={bi}>
            <div className="grid grid-cols-[1.5rem_1fr_2rem] border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
              <span className="text-right pr-0.5">#</span>
              <span className="pl-1">Participante</span>
              <span className="text-right">PTS</span>
            </div>
            {block.map((r, ri) => {
              const z = zoneOf(r)
              const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z
              return (
                <div
                  key={r.id}
                  className={`grid grid-cols-[1.5rem_1fr_2rem] px-2 py-[3px] text-[12px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''}`}
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
