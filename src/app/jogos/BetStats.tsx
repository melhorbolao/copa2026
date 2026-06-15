'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { toBlob } from 'html-to-image'
import { getMatchResult, scoreMatchBet } from '@/lib/scoring/engine'
import { Flag } from '@/components/ui/Flag'
import type { MatchFull, BetRaw, Participant } from './JogosDashboard'

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }

const H_W = 'w-10 sm:w-20'
const D_W = 'w-11 sm:w-24'
const A_W = 'w-10 sm:w-20'

// Fixed-width variants for the export ghost (no responsive breakpoints)
const EXP_H_W = 'w-10'
const EXP_D_W = 'w-11'
const EXP_A_W = 'w-10'

interface Props {
  match: MatchFull
  matchBets: BetRaw[]
  participants: Participant[]
  isZebra: boolean
  rules: Record<string, number>
  rankAfter: Record<string, number>
  hasAnyScore: boolean
  activeParticipantId?: string | null
  teamAbbrs?: Record<string, string>
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

// ── Ghost component: renderiza distribuição sem "Meu palpite" ──────────────────

const CYAN = '#04EFD0'
const SCORE_BG = '#2a2a2a'

function ExportableBetStats({
  match,
  groups,
  colTotals,
  avgPts,
  matchBetsCount,
  zebraThreshold,
  teamAbbrs,
  hasResult,
}: {
  match: MatchFull
  groups: BetGroup[]
  colTotals: { H: { pct: number; count: number }; D: { pct: number; count: number }; A: { pct: number; count: number } }
  avgPts: number | null
  matchBetsCount: number
  zebraThreshold: number
  teamAbbrs: Record<string, string>
  hasResult: boolean
}) {
  const abbr = (t: string) => teamAbbrs[t] ?? t.slice(0, 3).toUpperCase()

  return (
    <div style={{ background: 'white', borderRadius: 16, overflow: 'hidden', border: '1px solid #e5e7eb' }}>

      {/* Barra de placar — replica o header escuro do site com bandeiras e cores */}
      <div style={{ background: SCORE_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 16px' }}>
        {/* Casa */}
        <div style={{ background: '#000', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 40 }}>
          <Flag code={match.flag_home} size="sm" />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, letterSpacing: '0.05em' }}>{abbr(match.team_home)}</span>
        </div>
        {/* Placar casa */}
        <div style={{ background: CYAN, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, padding: '0 10px', height: 40, minWidth: 36, fontFamily: 'monospace' }}>
          {match.score_home !== null ? match.score_home : <span style={{ opacity: 0.4 }}>–</span>}
        </div>
        {/* Logo no centro vermelho */}
        <div style={{ background: '#FD1111', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 40, position: 'relative', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logoCopa.png" alt="" style={{ height: 34, width: 'auto', position: 'absolute' }} />
        </div>
        {/* Placar visitante */}
        <div style={{ background: CYAN, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 18, padding: '0 10px', height: 40, minWidth: 36, fontFamily: 'monospace' }}>
          {match.score_away !== null ? match.score_away : <span style={{ opacity: 0.4 }}>–</span>}
        </div>
        {/* Visitante */}
        <div style={{ background: '#000', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 40, flexDirection: 'row-reverse' }}>
          <Flag code={match.flag_away} size="sm" />
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, letterSpacing: '0.05em' }}>{abbr(match.team_away)}</span>
        </div>
      </div>

      {/* Subtítulo */}
      <div style={{ padding: '8px 16px 4px', textAlign: 'center', borderBottom: '1px solid #f3f4f6' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
          Distribuição de Palpites · {matchBetsCount} palpites
        </p>
      </div>

      {/* Cabeçalho de % por resultado (H/D/A) */}
      <div className="flex items-center px-3 pb-2 pt-2 border-b border-gray-100">
        <div className="flex-1" />
        {(['H', 'D', 'A'] as const).map(r => {
          const { pct, count } = colTotals[r]
          const w = r === 'H' ? EXP_H_W : r === 'D' ? EXP_D_W : EXP_A_W
          const isZebraCol = matchBetsCount > 0 && pct <= zebraThreshold
          return (
            <span key={r} className={`${w} text-center text-[10px] font-bold tabular-nums flex flex-col items-center justify-center leading-none rounded py-1 ${isZebraCol ? 'bg-black text-white' : 'text-gray-400'}`}>
              {fmtPct(pct)}
              <span className={`text-[9px] font-normal mt-0.5 ${isZebraCol ? 'text-gray-300' : 'text-gray-400'}`}>{count}</span>
            </span>
          )
        })}
        <div className="flex-1" />
      </div>

      {/* Linhas de palpite — sem "Meu palpite" (classe meu-palpite-row omitida intencionalmente) */}
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
            <div key={`${g.score_home}-${g.score_away}`} className={`flex items-center px-3 py-1${g.isExact ? ' bg-blue-50/60' : ''}`}>
              <div className="flex-1" />
              <span className={`${EXP_H_W} flex justify-center`}>{g.result === 'H' ? scoreEl : null}</span>
              <span className={`${EXP_D_W} flex justify-center`}>{g.result === 'D' ? scoreEl : null}</span>
              <span className={`${EXP_A_W} flex justify-center`}>{g.result === 'A' ? scoreEl : null}</span>
              <div className="flex-1 flex justify-end items-center gap-1.5">
                <span className={metaClass}>{g.count} ({g.pct.toFixed(0)}%)</span>
                <span className={ptsClass}>{g.pts !== null ? (g.pts > 0 ? `+${g.pts}` : '0') : ''}</span>
              </div>
            </div>
          )
        })}
      </div>

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

// ── Componente principal ───────────────────────────────────────────────────────

export function BetStats({ match, matchBets, participants, isZebra, rules, rankAfter, hasAnyScore, activeParticipantId, teamAbbrs = {} }: Props) {
  const hasResult      = match.score_home !== null && match.score_away !== null
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  // ── Share Resumo (mobile) — visível apenas dentro da janela de edição de resultado ──
  const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000
  const matchStart = new Date(match.match_datetime).getTime()
  const inEditWindow = Date.now() >= matchStart && Date.now() <= matchStart + EDIT_WINDOW_MS

  const [showBetExport, setShowBetExport] = useState(false)
  const [isSharingBet, setIsSharingBet]   = useState(false)
  const betExportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showBetExport || !betExportRef.current) return
    const el = betExportRef.current
    let cancelled = false

    async function capture() {
      await document.fonts.ready
      if (cancelled) return
      try {
        const opts = { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' }
        await toBlob(el, opts).catch(() => null)
        if (cancelled) return
        const blob = await toBlob(el, opts)
        if (cancelled || !blob) return
        const file = new File([blob], 'resumo-palpites.png', { type: 'image/png' })
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          // Apenas imagem — sem title/text para compartilhamento limpo
          await navigator.share({ files: [file] })
        } else {
          const url = URL.createObjectURL(blob)
          const a   = document.createElement('a')
          a.href     = url
          a.download = 'resumo-palpites.png'
          a.click()
          URL.revokeObjectURL(url)
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          console.error('Erro ao compartilhar resumo de palpites:', err)
        }
      } finally {
        if (!cancelled) { setShowBetExport(false); setIsSharingBet(false) }
      }
    }

    void capture()
    return () => { cancelled = true }
  }, [showBetExport])

  // ── Dados computados ───────────────────────────────────────────────────────

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
        const medals = hasAnyScore ? [1, 2, 3].filter(rank => {
          for (const [pid, r] of medalTier) if (r === rank && pidSet.has(pid)) return true
          return false
        }) : []
        const hasLantern = hasAnyScore && [...pidSet].some(pid => lanternPids.has(pid))
        return { score_home: sh, score_away: sa, result, count, pct: (count / total) * 100, pts, isExact, isImpossible, medals, hasLantern }
      })
      .sort((a, b) => b.count - a.count)
  }, [matchBets, match.score_home, match.score_away, hasResult, isZebra, rules, match.is_brazil, medalTier, lanternPids])

  const colTotals = useMemo(() => {
    const t = { H: 0, D: 0, A: 0 }
    for (const b of matchBets) t[getMatchResult(b.score_home, b.score_away)]++
    const total = matchBets.length || 1
    return {
      H: { pct: (t.H / total) * 100, count: t.H },
      D: { pct: (t.D / total) * 100, count: t.D },
      A: { pct: (t.A / total) * 100, count: t.A },
    }
  }, [matchBets])

  const avgPts = useMemo(() => {
    if (!hasResult || groups.length === 0) return null
    const sum = groups.reduce((acc, g) => acc + (g.pts ?? 0) * g.count, 0)
    return sum / matchBets.length
  }, [groups, hasResult, matchBets.length])

  const ownBet = useMemo(() => {
    if (!activeParticipantId) return null
    return matchBets.find(b => b.participant_id === activeParticipantId) ?? null
  }, [matchBets, activeParticipantId])

  const ownResult = useMemo(() => {
    if (!ownBet) return null
    return getMatchResult(ownBet.score_home, ownBet.score_away)
  }, [ownBet])

  const ownPts = useMemo(() => {
    if (!ownBet || !hasResult) return null
    return scoreMatchBet(
      ownBet.score_home, ownBet.score_away,
      match.score_home!, match.score_away!,
      isZebra, match.is_brazil, rules,
    )
  }, [ownBet, hasResult, match.score_home, match.score_away, isZebra, match.is_brazil, rules])

  const ownIsExact = hasResult && ownBet !== null &&
    match.score_home === ownBet.score_home &&
    match.score_away === ownBet.score_away

  if (matchBets.length === 0) {
    return (
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-4 text-center text-sm text-gray-400">
        Sem palpites registrados para este jogo.
      </div>
    )
  }

  return (
    <>
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
      <div className="px-4 pt-3 pb-1 text-center relative">
        <h2 className="text-[11px] sm:text-base font-bold text-gray-500 uppercase tracking-wide">Distribuição de Palpites</h2>
        {/* Botão compartilhar resumo — somente mobile e dentro da janela de edição */}
        {inEditWindow && (
          <button
            onClick={() => { setIsSharingBet(true); setShowBetExport(true) }}
            disabled={isSharingBet}
            className="block md:hidden absolute right-3 top-2 rounded-full p-1.5 text-gray-400 hover:text-azul-escuro hover:bg-gray-100 transition disabled:opacity-50"
            aria-label="Compartilhar resumo de palpites"
            title="Compartilhar resumo"
          >
            {isSharingBet ? (
              <span className="text-[10px]">…</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* % column headers — destaca possíveis zebras (% ≤ threshold) */}
      <div className="flex items-center px-3 pb-2 border-b border-gray-100">
        <div className="flex-1" />
        {(['H', 'D', 'A'] as const).map(r => {
          const { pct, count } = colTotals[r]
          const w    = r === 'H' ? H_W : r === 'D' ? D_W : A_W
          const isZebraCol = matchBets.length > 0 && pct <= zebraThreshold
          return (
            <span key={r} className={`${w} text-center text-[10px] sm:text-base font-bold tabular-nums flex flex-col items-center justify-center leading-none rounded py-1 ${isZebraCol ? 'bg-black text-white' : 'text-gray-400'}`}>
              {fmtPct(pct)}
              <span className={`text-[9px] sm:text-xs font-normal mt-0.5 ${isZebraCol ? 'text-gray-300' : 'text-gray-400'}`}>{count}</span>
            </span>
          )
        })}
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
          const scoreClass = `font-mono font-bold text-sm sm:text-xl tabular-nums ${baseColor}${g.isImpossible ? ' line-through' : ''}`
          const metaClass = `text-xs sm:text-base tabular-nums whitespace-nowrap ${
            g.isExact ? 'text-blue-500 font-semibold' : (g.pts === 0 && hasResult) ? 'text-gray-300' : 'text-gray-500'
          }`
          const ptsClass = `text-sm sm:text-xl font-bold tabular-nums ${
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
              <div className="flex-1" />
              <span className={`${H_W} flex justify-center`}>{g.result === 'H' ? scoreEl : null}</span>
              <span className={`${D_W} flex justify-center`}>{g.result === 'D' ? scoreEl : null}</span>
              <span className={`${A_W} flex justify-center`}>{g.result === 'A' ? scoreEl : null}</span>
              <div className="flex-1 flex justify-end items-center gap-1.5 sm:justify-start sm:gap-0">
                <span className={`${metaClass} sm:w-28 sm:text-right`}>{g.count}{'   '}({g.pct.toFixed(0)}%)</span>
                <span className={`${ptsClass} sm:flex-1 sm:text-right`}>
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

      {/* Meu palpite — classe meu-palpite-row marca esta linha para referência; o ghost não a inclui */}
      {ownBet && ownResult && (() => {
        const scoreColor = ownIsExact
          ? 'text-blue-600'
          : ownPts === 0 && hasResult
            ? 'text-gray-300'
            : 'text-gray-800'
        const scoreEl = (
          <span className={`font-mono font-bold text-sm sm:text-xl tabular-nums ${scoreColor}`}>
            {ownBet.score_home}x{ownBet.score_away}
          </span>
        )
        return (
          <div className={`meu-palpite-row flex items-center px-3 py-1.5 border-t border-gray-100${ownIsExact ? ' bg-blue-50/60' : ' bg-gray-50/60'}`}>
            <div className="flex-1">
              <span className="text-[10px] sm:text-sm font-bold text-gray-400 uppercase tracking-wide">Meu palpite</span>
              {activeParticipantId && rankAfter[activeParticipantId] != null && (
                <span className="block text-xs font-mono text-gray-400">
                  #{rankAfter[activeParticipantId]}/{participants.length}
                </span>
              )}
            </div>
            <span className={`${H_W} flex justify-center`}>{ownResult === 'H' ? scoreEl : null}</span>
            <span className={`${D_W} flex justify-center`}>{ownResult === 'D' ? scoreEl : null}</span>
            <span className={`${A_W} flex justify-center`}>{ownResult === 'A' ? scoreEl : null}</span>
            <div className="flex-1 flex justify-end items-center sm:justify-start sm:gap-0">
              {ownPts !== null && (
                <span className={`text-sm sm:text-xl sm:w-28 sm:text-right font-bold tabular-nums ${ownPts > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                  {ownPts > 0 ? `+${ownPts}` : '0'}
                </span>
              )}
            </div>
          </div>
        )
      })()}
    </div>

    {/* Ghost para exportação — montado apenas ao compartilhar, desmontado após captura */}
    {showBetExport && (
      <div style={{ position: 'absolute', top: 0, left: 0, overflow: 'hidden', height: 0, width: 0 }} aria-hidden="true">
        <div ref={betExportRef} style={{ width: '390px' }}>
          <ExportableBetStats
            match={match}
            groups={groups}
            colTotals={colTotals}
            avgPts={avgPts}
            matchBetsCount={matchBets.length}
            zebraThreshold={zebraThreshold}
            teamAbbrs={teamAbbrs}
            hasResult={hasResult}
          />
        </div>
      </div>
    )}
    </>
  )
}
