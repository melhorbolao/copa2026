'use client'

import { useMemo } from 'react'
import { getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import type { MatchFull, BetRaw, Participant } from './JogosDashboard'

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

// Slightly wider than the score boxes (w-8/w-9) so percentage labels fit without overlap
const H_W = 'w-10'  // 40px
const D_W = 'w-11'  // 44px
const A_W = 'w-10'  // 40px

interface Props {
  match: MatchFull
  matchBets: BetRaw[]
  participants: Participant[]
  isZebra: boolean
  rules: Record<string, number>
  rankAfter: Record<string, number>
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
  medals: number[]
  hasLantern: boolean
}

function fmtPct(n: number) {
  return n.toFixed(1).replace('.', ',') + '%'
}

export function BetStats({ match, matchBets, participants, isZebra, rules, rankAfter }: Props) {
  const hasResult = match.score_home !== null && match.score_away !== null

  const medalTier = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of participants) {
      const r = rankAfter[p.id]
      if (r >= 1 && r <= 3) m.set(p.id, r)
    }
    return m
  }, [participants, rankAfter])

  const lanternPids = useMemo(() => {
    const lastRank = Math.max(0, ...participants.map(p => rankAfter[p.id] ?? 0))
    return new Set(participants.filter(p => (rankAfter[p.id] ?? 0) === lastRank && lastRank > 0).map(p => p.id))
  }, [participants, rankAfter])

  const groups = useMemo<BetGroup[]>(() => {
    if (matchBets.length === 0) return []
    const map = new Map<string, { sh: number; sa: number; count: number; pids: string[] }>()
    for (const b of matchBets) {
      const k = `${b.score_home}-${b.score_away}`
      const prev = map.get(k) ?? { sh: b.score_home, sa: b.score_away, count: 0, pids: [] }
      map.set(k, { ...prev, count: prev.count + 1, pids: [...prev.pids, b.participant_id] })
    }
    const total = matchBets.length
    return [...map.values()]
      .map(({ sh, sa, count, pids }) => {
        const result = getMatchResult(sh, sa)
        const isExact = hasResult && match.score_home === sh && match.score_away === sa
        const isImpossible = hasResult && (match.score_home! > sh || match.score_away! > sa)
        const pts = hasResult
          ? scoreMatchBet(sh, sa, match.score_home!, match.score_away!, isZebra, match.is_brazil, rules)
          : null
        const pidSet = new Set(pids)
        const medals = [1, 2, 3].filter(rank => {
          for (const [pid, r] of medalTier) if (r === rank && pidSet.has(pid)) return true
          return false
        })
        const hasLantern = [...pidSet].some(pid => lanternPids.has(pid))
        return { score_home: sh, score_away: sa, result, count, pct: (count / total) * 100, pts, isExact, isImpossible, medals, hasLantern }
      })
      .sort((a, b) => b.count - a.count)
  }, [matchBets, match.score_home, match.score_away, hasResult, isZebra, rules, match.is_brazil, medalTier, lanternPids])

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
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden relative">

      {/* Zebra — absolute so it never shifts the score columns */}
      {isZebra && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/zebra.png" alt="zebra"
          width={80} height={80}
          className="absolute left-1 top-1/2 -translate-y-1/2 object-contain pointer-events-none"
          style={{ zIndex: 1 }}
        />
      )}

      {/* Title */}
      <div className="px-4 pt-3 pb-1 text-center">
        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Distribuição de Palpites</h2>
      </div>

      {/*
        Layout mirrors ScoreHeader exactly:
        [px-3] [flex-1 left spacer] [H: w-8=32px] [D: w-9=36px] [A: w-8=32px] [flex-1 right spacer] [px-3]
        The score strip (100px) sits between two equal flex-1 halves, so its center = card center,
        matching the ScoreHeader pill which uses the same px-3 + flex-1 structure.
      */}

      {/* % column headers */}
      <div className="flex items-center px-3 pb-2 border-b border-gray-100">
        <div className="flex-1" />
        <span className={`${H_W} text-center text-[10px] font-bold text-gray-400 tabular-nums`}>{fmtPct(colTotals.H)}</span>
        <span className={`${D_W} text-center text-[10px] font-bold text-gray-400 tabular-nums`}>{fmtPct(colTotals.D)}</span>
        <span className={`${A_W} text-center text-[10px] font-bold text-gray-400 tabular-nums`}>{fmtPct(colTotals.A)}</span>
        <div className="flex-1" />
      </div>

      {/* Bet rows */}
      <div className="divide-y divide-gray-50">
        {groups.map(g => {
          const baseColor = g.isExact
            ? 'text-blue-600'
            : (g.pts !== null && g.pts > 0)
              ? 'text-gray-800'
              : (g.pts === 0 && hasResult)
                ? 'text-gray-300'
                : 'text-gray-700'
          const scoreClass = `font-mono font-bold text-sm tabular-nums ${baseColor}${g.isImpossible ? ' line-through' : ''}`
          const metaClass = `text-xs tabular-nums whitespace-nowrap ${
            g.isExact ? 'text-blue-500 font-semibold' : (g.pts === 0 && hasResult) ? 'text-gray-300' : 'text-gray-500'
          }`
          const ptsClass = `text-sm font-bold tabular-nums ${
            g.isExact ? 'text-blue-600' : (g.pts === 0 && hasResult) ? 'text-gray-300' : 'text-gray-400'
          }`

          const scoreEl = (
            <span className="flex items-center justify-center gap-0.5">
              {g.medals.map(r => <span key={r} className="text-xs leading-none">{MEDAL[r]}</span>)}
              {g.hasLantern && <span className="text-xs leading-none">🔦</span>}
              <span className={scoreClass}>{g.score_home}x{g.score_away}</span>
            </span>
          )

          return (
            <div
              key={`${g.score_home}-${g.score_away}`}
              className={`flex items-center px-3 py-1${g.isExact ? ' bg-blue-50/60' : ''}`}
            >
              {/* Left spacer — mirrors header left flex-1 section */}
              <div className="flex-1" />

              {/* Score columns — w-8/w-9/w-8 matches ScoreBox/logo/ScoreBox in header */}
              <span className={`${H_W} flex justify-center`}>{g.result === 'H' ? scoreEl : null}</span>
              <span className={`${D_W} flex justify-center`}>{g.result === 'D' ? scoreEl : null}</span>
              <span className={`${A_W} flex justify-center`}>{g.result === 'A' ? scoreEl : null}</span>

              {/* Right spacer — mirrors header right flex-1 section; count+pts sit inside */}
              <div className="flex-1 flex justify-end items-center gap-1.5">
                <span className={metaClass}>{g.count}({g.pct.toFixed(0)}%)</span>
                <span className={ptsClass}>
                  {g.pts !== null ? (g.pts > 0 ? `+${g.pts}` : '0') : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Average */}
      {avgPts !== null && (
        <div className="px-3 py-2 text-right border-t border-gray-50">
          <div className="text-sm font-bold text-gray-600 tabular-nums">
            {avgPts.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </div>
          <div className="text-[10px] text-gray-400">(média)</div>
        </div>
      )}
    </div>
  )
}
