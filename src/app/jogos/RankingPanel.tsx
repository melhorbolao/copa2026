'use client'

import { useState } from 'react'
import type { MatchFull, BetRaw, Participant } from './JogosDashboard'

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

function canUseSecador(match: MatchFull, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const now   = Date.now()
  const start = new Date(match.match_datetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

interface Props {
  match: MatchFull
  matchBets: BetRaw[]
  participants: Participant[]
  matchPoints: Record<string, number>
  ptsWithoutMatch: Record<string, number>
  rankBefore: Record<string, number>
  rankAfter: Record<string, number>
  quase: { home: string[]; away: string[] }
  abbr: (t: string) => string
  teamAbbrs: Record<string, string>
  isAdmin: boolean
}

type SortKey = 'pos' | 'total' | 'match' | 'delta' | 'name'
type SortDir = 'asc' | 'desc'

export function RankingPanel({
  match, matchBets, participants, matchPoints, ptsWithoutMatch,
  rankBefore, rankAfter, quase, abbr, isAdmin,
}: Props) {
  const [secador, setSecador] = useState(false)
  const secadorAllowed = canUseSecador(match, isAdmin)
  const [sortKey, setSortKey] = useState<SortKey>('pos')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const hasResult = match.score_home !== null && match.score_away !== null

  const cravando = matchBets.filter(b =>
    hasResult && b.score_home === match.score_home && b.score_away === match.score_away
  )
  const cravandoPids = new Set(cravando.map(b => b.participant_id))

  const topGainer = participants
    .filter(p => (matchPoints[p.id] ?? 0) > 0)
    .sort((a, b) => (matchPoints[b.id] ?? 0) - (matchPoints[a.id] ?? 0))[0]

  const participantMap = new Map(participants.map(p => [p.id, p]))
  const betMap = new Map(matchBets.map(b => [b.participant_id, b]))

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(key === 'pos' || key === 'name' ? 'asc' : 'desc')
    }
  }

  const SortArrow = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <span className="text-gray-600 ml-0.5">↕</span>
    return <span className="text-gray-300 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const rankRows = participants
    .map(p => ({
      ...p,
      ptsGained: matchPoints[p.id] ?? 0,
      total: (ptsWithoutMatch[p.id] ?? 0) + (matchPoints[p.id] ?? 0),
      before: rankBefore[p.id] ?? participants.length,
      after: rankAfter[p.id] ?? participants.length,
      delta: (rankBefore[p.id] ?? participants.length) - (rankAfter[p.id] ?? participants.length),
    }))
    .sort((a, b) => {
      let diff = 0
      if (sortKey === 'pos') diff = a.after - b.after
      else if (sortKey === 'total') diff = b.total - a.total
      else if (sortKey === 'match') diff = b.ptsGained - a.ptsGained
      else if (sortKey === 'delta') diff = b.delta - a.delta
      else if (sortKey === 'name') return sortDir === 'asc'
        ? a.apelido.localeCompare(b.apelido, 'pt-BR')
        : b.apelido.localeCompare(a.apelido, 'pt-BR')
      return sortDir === 'asc' ? diff : -diff
    })

  if (!hasResult) {
    return (
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 text-center text-sm text-gray-400">
        Ranking disponível após o início do jogo.
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">

      {/* Cravando agora */}
      {cravando.length > 0 && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">✓ Cravando agora</span>
            {!secador && secadorAllowed && (
              <button
                onClick={() => setSecador(true)}
                className="px-3 py-1 rounded-full text-[10px] font-bold text-gray-400 border border-gray-200 hover:border-gray-400 hover:text-gray-600 transition"
                title="Ativar secador"
              >
                Secador
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Secador to the left of chips, pointing right at the participants */}
            {secador && secadorAllowed && (
              <button
                onClick={() => setSecador(false)}
                className="shrink-0 active:scale-95 transition"
                title="Desativar secador"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/secador.png" alt="secador" width={52} height={52}
                  className="object-contain animate-pulse"
                  style={{ transform: 'scaleX(-1)' }}
                />
              </button>
            )}

            <div className="flex flex-wrap gap-1.5">
              {cravando.map(b => {
                const p = participantMap.get(b.participant_id)
                if (!p) return null
                const before = rankBefore[p.id] ?? 0
                const after  = rankAfter[p.id]  ?? 0
                const delta  = before - after
                const isSecado = secador && topGainer && p.id !== topGainer.id
                return (
                  <div key={p.id} className={`flex items-center gap-1 rounded-full px-2.5 py-1 shadow-sm border text-xs transition ${isSecado ? 'bg-orange-50 border-orange-300' : 'bg-white border-emerald-200'}`}>
                    <span className={`font-semibold ${isSecado ? 'text-orange-500 line-through' : 'text-gray-800'}`}>{p.apelido}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400 tabular-nums">{before}→{after}</span>
                    {delta > 0 && <span className="text-emerald-500 font-bold">↑{delta}</span>}
                    {delta < 0 && <span className="text-rose-400 font-bold">↓{Math.abs(delta)}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Crava se… */}
      {(quase.home.length > 0 || quase.away.length > 0) && (
        <div className="border-b border-gray-100 px-4 py-2.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Crava se…</p>
          <div className="grid grid-cols-2 gap-2">
            {quase.home.length > 0 && (
              <div>
                <p className="text-[10px] text-blue-500 font-semibold mb-0.5">⚽ {abbr(match.team_home)} marcar</p>
                <div className="flex flex-wrap gap-1">
                  {quase.home.map(pid => {
                    const p = participantMap.get(pid)
                    return p ? <span key={pid} className="text-[10px] bg-blue-50 text-blue-700 rounded-full px-1.5 py-0.5 font-medium">{p.apelido}</span> : null
                  })}
                </div>
              </div>
            )}
            {quase.away.length > 0 && (
              <div>
                <p className="text-[10px] text-orange-500 font-semibold mb-0.5">⚽ {abbr(match.team_away)} marcar</p>
                <div className="flex flex-wrap gap-1">
                  {quase.away.map(pid => {
                    const p = participantMap.get(pid)
                    return p ? <span key={pid} className="text-[10px] bg-orange-50 text-orange-700 rounded-full px-1.5 py-0.5 font-medium">{p.apelido}</span> : null
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full ranking table */}
      <div>
        <div className="grid grid-cols-[2rem_1fr_3rem_4.5rem_4rem_2.5rem] text-[10px] font-bold text-gray-400 uppercase tracking-wide px-3 py-1.5 border-b border-gray-100">
          <button className="flex items-center justify-center gap-0.5 hover:text-gray-600 transition" onClick={() => handleSort('pos')}>
            #<SortArrow k="pos" />
          </button>
          <button className="flex items-center gap-0.5 hover:text-gray-600 transition" onClick={() => handleSort('name')}>
            Nome<SortArrow k="name" />
          </button>
          <span className="text-center">Palp</span>
          <button className="flex items-center justify-end gap-0.5 hover:text-gray-600 transition" onClick={() => handleSort('total')}>
            PTS Total<SortArrow k="total" />
          </button>
          <button className="flex items-center justify-end gap-0.5 hover:text-gray-600 transition" onClick={() => handleSort('match')}>
            PTS Jogo<SortArrow k="match" />
          </button>
          <button className="flex items-center justify-end gap-0.5 hover:text-gray-600 transition" onClick={() => handleSort('delta')}>
            ↑↓<SortArrow k="delta" />
          </button>
        </div>

        <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
          {rankRows.map(row => (
            <div key={row.id}
              className={`grid grid-cols-[2rem_1fr_3rem_4.5rem_4rem_2.5rem] items-center px-3 py-1.5 text-xs ${cravandoPids.has(row.id) ? 'bg-emerald-50' : ''}`}>
              <span className="text-center font-bold text-gray-500">{row.after}</span>
              <span className={`font-medium truncate ${cravandoPids.has(row.id) ? 'text-emerald-700' : 'text-gray-800'}`}>
                {row.apelido}
              </span>
              {(() => { const b = betMap.get(row.id); return (
                <span className="text-center tabular-nums font-mono text-[10px] text-gray-400">
                  {b ? `${b.score_home}x${b.score_away}` : '–'}
                </span>
              )})()}
              <span className="text-right tabular-nums font-bold text-gray-700">
                {row.total}
              </span>
              <span className={`text-right tabular-nums font-bold ${row.ptsGained > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                {row.ptsGained > 0 ? `+${row.ptsGained}` : '0'}
              </span>
              <span className={`text-right tabular-nums font-bold ${row.delta > 0 ? 'text-emerald-500' : row.delta < 0 ? 'text-rose-400' : 'text-gray-300'}`}>
                {row.delta > 0 ? `↑${row.delta}` : row.delta < 0 ? `↓${Math.abs(row.delta)}` : '='}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
