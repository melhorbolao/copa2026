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
  isMinority: boolean
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
        const isMinority = minorityMap ? minorityMap[result] : false
        const pts = hasResult
          ? scoreMatchBet(sh, sa, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
          : null
        return { score_home: sh, score_away: sa, result, count, pct: (count / total) * 100, pts, isExact, isImpossible, isMinority }
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

        {/* Left zebra strip — visible only when actual result is minority */}
        {isZebra && (
          <div className="flex flex-col items-center justify-center gap-1.5 bg-gray-900 px-2 py-3 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/zebra.png" alt="zebra" width={36} height={36} className="object-contain animate-bounce" />
            <span
              className="text-[7px] font-black text-yellow-300 uppercase tracking-widest"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >ZEBRA</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="px-4 pt-3 pb-1">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Distribuição de Palpites</h2>
          </div>

          {/* Column header (Home / X / Away) with percentages */}
          <div className="grid grid-cols-3 border-b border-gray-100 text-center text-[11px] font-bold px-4 py-2 gap-1">
            {(['H', 'D', 'A'] as const).map(r => {
              const isZebraCol = !!minorityMap?.[r]
              return (
                <div key={r} className={`flex flex-col items-center gap-0.5 rounded-lg py-1 ${isZebraCol ? 'bg-gray-900' : ''}`}>
                  <div className="flex items-center gap-1">
                    <span className={isZebraCol ? 'text-white font-black' : 'text-gray-500'}>
                      {r === 'H' ? abbr(match.team_home) : r === 'A' ? abbr(match.team_away) : 'X'}
                    </span>
                    {isZebraCol && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/zebra.png" alt="zebra" width={20} height={20} className="object-contain animate-bounce" />
                    )}
                  </div>
                  <span className={`text-base font-black ${isZebraCol ? 'text-yellow-300' : 'text-gray-700'}`}>
                    {colTotals[r].toFixed(0)}%
                  </span>
                </div>
              )
            })}
          </div>

          {/* Bet rows */}
          <div className="divide-y divide-gray-50">
            {groups.map(g => (
              <div
                key={`${g.score_home}-${g.score_away}`}
                className={`flex items-center px-4 py-1.5 gap-2 ${
                  g.isExact ? 'bg-emerald-50'
                  : g.isImpossible ? 'bg-rose-50/60'
                  : g.isMinority ? 'border-l-2 border-gray-800'
                  : ''
                }`}
              >
                {/* Score pill */}
                <span className={`font-mono font-bold tabular-nums text-xs w-11 text-center rounded px-1 py-0.5 shrink-0 ${
                  g.isExact ? 'bg-emerald-100 text-emerald-700'
                  : g.isImpossible ? 'text-rose-400 line-through'
                  : g.isMinority ? 'bg-gray-900 text-white'
                  : 'text-gray-700'
                }`}>
                  {g.score_home}–{g.score_away}
                </span>

                {/* Count + % */}
                <span className="text-[11px] tabular-nums text-gray-500 shrink-0 w-14">
                  {g.count} <span className="text-gray-300">·</span> {g.pct.toFixed(0)}%
                </span>

                {/* Bar */}
                <div className="flex-1 relative h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`absolute left-0 top-0 h-full rounded-full ${
                      g.isExact ? 'bg-emerald-400'
                      : g.isImpossible ? 'bg-rose-300'
                      : g.isMinority ? 'bg-gray-800'
                      : 'bg-blue-300'
                    }`}
                    style={{ width: `${g.pct}%` }}
                  />
                </div>

                {/* Points earned */}
                <span className={`text-xs tabular-nums font-bold w-10 text-right shrink-0 ${
                  g.pts === null ? 'text-gray-200'
                  : g.pts === 0 ? 'text-gray-300'
                  : g.isExact ? 'text-emerald-600'
                  : 'text-blue-500'
                }`}>
                  {g.pts !== null ? (g.pts > 0 ? `+${g.pts}` : '0') : '—'}
                </span>

                {/* Status icon */}
                <span className="w-4 text-center shrink-0">
                  {g.isExact && <span className="text-emerald-500 font-bold text-xs">✓</span>}
                  {g.isImpossible && !g.isExact && <span className="text-rose-400 font-bold text-xs">✕</span>}
                  {g.isMinority && !g.isExact && !g.isImpossible && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/zebra.png" alt="zebra" width={14} height={14} className="object-contain inline" />
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-1.5 border-t border-gray-50 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              {matchBets.length} palpites · {participants.length} participantes
            </span>
            {avgPts !== null && (
              <span className="text-[10px] text-gray-500">
                Média: <span className="font-bold text-blue-500">{avgPts.toFixed(1)} pts</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
