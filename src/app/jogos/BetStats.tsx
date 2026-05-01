'use client'

import { useMemo } from 'react'
import { getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import type { MatchFull, BetRaw, Participant } from './JogosDashboard'

interface Props {
  match: MatchFull
  matchBets: BetRaw[]
  participants: Participant[]
  minorityMap: { H: boolean; D: boolean; A: boolean } | null
  isZebra: boolean
  rules: Record<string, number>
  abbr: (t: string) => string
}

type BetGroup = {
  score_home: number
  score_away: number
  result: 'H' | 'D' | 'A'
  count: number
  pct: number
  pts: number | null
  isExact: boolean
  isMinority: boolean
}

function fmtPct(n: number) {
  return n.toFixed(1).replace('.', ',') + '%'
}

export function BetStats({ match, matchBets, participants, minorityMap, isZebra, rules }: Props) {
  const hasResult = match.score_home !== null && match.score_away !== null

  const groups = useMemo<BetGroup[]>(() => {
    if (matchBets.length === 0) return []
    const map = new Map<string, { sh: number; sa: number; count: number }>()
    for (const b of matchBets) {
      const k = `${b.score_home}-${b.score_away}`
      const prev = map.get(k) ?? { sh: b.score_home, sa: b.score_away, count: 0 }
      map.set(k, { ...prev, count: prev.count + 1 })
    }
    const total = matchBets.length
    return [...map.values()]
      .map(({ sh, sa, count }) => {
        const result = getMatchResult(sh, sa)
        const isExact = hasResult && match.score_home === sh && match.score_away === sa
        const isMinority = minorityMap ? minorityMap[result] : false
        const pts = hasResult
          ? scoreMatchBet(sh, sa, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
          : null
        return { score_home: sh, score_away: sa, result, count, pct: (count / total) * 100, pts, isExact, isMinority }
      })
      .sort((a, b) => b.count - a.count)
  }, [matchBets, match.score_home, match.score_away, hasResult, minorityMap, isZebra, rules, match.is_brazil])

  const colTotals = useMemo(() => {
    const t = { H: 0, D: 0, A: 0 }
    for (const b of matchBets) t[getMatchResult(b.score_home, b.score_away)]++
    const total = matchBets.length || 1
    return { H: (t.H / total) * 100, D: (t.D / total) * 100, A: (t.A / total) * 100 }
  }, [matchBets])

  const avgPts = useMemo(() => {
    if (!hasResult || groups.length === 0) return null
    const sum = groups.reduce((acc, g) => acc + (g.pts ?? 0) * g.count, 0)
    return sum / matchBets.length
  }, [groups, hasResult, matchBets.length])

  if (matchBets.length === 0) {
    return (
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 text-center text-sm text-gray-400">
        Sem palpites registrados para este jogo.
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex">

        {/* Large zebra on left when actual result is minority */}
        {isZebra && (
          <div className="flex items-center justify-center px-3 py-2 shrink-0 self-stretch">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zebra.png" alt="zebra" width={110} height={110} className="object-contain" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title + percentage summary */}
          <div className="px-4 pt-3 pb-1 text-center">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Distribuição de Palpites</h2>
            <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
              {fmtPct(colTotals.H)}&nbsp;&nbsp;{fmtPct(colTotals.D)}&nbsp;&nbsp;{fmtPct(colTotals.A)}
            </p>
          </div>

          {/* Bet rows — Score | Count(%) | Points */}
          <div className="divide-y divide-gray-50">
            {groups.map(g => {
              const isMissed = hasResult && (g.pts ?? 0) === 0
              return (
                <div
                  key={`${g.score_home}-${g.score_away}`}
                  className={`grid grid-cols-[5rem_1fr_3.5rem] items-center px-4 py-1 gap-1 ${g.isExact ? 'bg-blue-50/60' : ''}`}
                >
                  {/* Score */}
                  <span className={`font-mono font-bold tabular-nums text-sm ${
                    g.isExact ? 'text-blue-600'
                    : isMissed ? 'text-gray-300 line-through'
                    : 'text-gray-700'
                  }`}>
                    {g.score_home}x{g.score_away}
                  </span>

                  {/* Count (%) */}
                  <span className={`text-xs tabular-nums ${
                    g.isExact ? 'text-blue-500 font-semibold'
                    : isMissed ? 'text-gray-300'
                    : 'text-gray-500'
                  }`}>
                    {g.count} ({g.pct.toFixed(0)}%)
                  </span>

                  {/* Points */}
                  <span className={`text-sm font-bold tabular-nums text-right ${
                    g.isExact ? 'text-blue-600'
                    : isMissed ? 'text-gray-300'
                    : 'text-gray-400'
                  }`}>
                    {g.pts !== null ? (g.pts > 0 ? `+${g.pts}` : '0') : ''}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Average */}
          {avgPts !== null && (
            <div className="px-4 py-2 text-right border-t border-gray-50">
              <div className="text-sm font-bold text-gray-600 tabular-nums">
                {avgPts.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </div>
              <div className="text-[10px] text-gray-400">(média)</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
