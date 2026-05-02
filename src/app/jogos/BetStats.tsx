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
  isImpossible: boolean
}

function fmtPct(n: number) {
  return n.toFixed(1).replace('.', ',') + '%'
}

export function BetStats({ match, matchBets, participants, minorityMap, isZebra, rules, abbr }: Props) {
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
        const isImpossible = hasResult && ((match.score_home! > sh) || (match.score_away! > sa))
        const pts = hasResult
          ? scoreMatchBet(sh, sa, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
          : null
        return { score_home: sh, score_away: sa, result, count, pct: (count / total) * 100, pts, isExact, isImpossible }
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
          {/* Title */}
          <div className="px-4 pt-3 pb-1 text-center">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Distribuição de Palpites</h2>
          </div>

          {/* Percentage header — same grid as bet rows so columns align */}
          <div className="grid grid-cols-[5rem_1fr_3.5rem] text-xs font-bold text-gray-400 tabular-nums px-4 pb-2 border-b border-gray-50 gap-1">
            <span className="text-center">{fmtPct(colTotals.H)}</span>
            <span className="text-center">{fmtPct(colTotals.D)}</span>
            <span className="text-right">{fmtPct(colTotals.A)}</span>
          </div>

          {/* Bet rows — Score | Count(%) | Points */}
          <div className="divide-y divide-gray-50">
            {groups.map(g => {
              // isImpossible: a team already exceeded this bet → strikethrough
              // pts=0 without impossible: just light gray
              const textScore = g.isExact
                ? 'text-blue-600'
                : g.isImpossible
                  ? 'text-gray-300 line-through'
                  : (g.pts === 0 && hasResult)
                    ? 'text-gray-300'
                    : 'text-gray-700'
              const textMeta = g.isExact
                ? 'text-blue-500 font-semibold'
                : (g.pts === 0 && hasResult) ? 'text-gray-300' : 'text-gray-500'
              const textPts = g.isExact
                ? 'text-blue-600'
                : (g.pts === 0 && hasResult) ? 'text-gray-300' : 'text-gray-400'

              return (
                <div
                  key={`${g.score_home}-${g.score_away}`}
                  className={`grid grid-cols-[5rem_1fr_3.5rem] items-center px-4 py-1 gap-1 ${g.isExact ? 'bg-blue-50/60' : ''}`}
                >
                  <span className={`font-mono font-bold tabular-nums text-sm ${textScore}`}>
                    {g.score_home}x{g.score_away}
                  </span>
                  <span className={`text-xs tabular-nums ${textMeta}`}>
                    {g.count} ({g.pct.toFixed(0)}%)
                  </span>
                  <span className={`text-sm font-bold tabular-nums text-right ${textPts}`}>
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
