'use client'

import { useState, useEffect, useRef } from 'react'
import { toBlob } from 'html-to-image'
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

// ── Ghost component: painel do Secador para exportação ────────────────────────

function ExportableSecador({
  match,
  cravando,
  participantMap,
  rankBefore,
  rankAfter,
  abbr,
  afterDeadline,
}: {
  match: MatchFull
  cravando: BetRaw[]
  participantMap: Map<string, Participant>
  rankBefore: Record<string, number>
  rankAfter: Record<string, number>
  abbr: (t: string) => string
  afterDeadline: boolean
}) {
  const sorted = [...cravando].sort((a, b) => {
    const pa = participantMap.get(a.participant_id)?.apelido ?? ''
    const pb = participantMap.get(b.participant_id)?.apelido ?? ''
    return pa.localeCompare(pb, 'pt-BR')
  })

  const scoreStr = match.score_home !== null && match.score_away !== null
    ? `${match.score_home}×${match.score_away}`
    : null

  const matchLabel = scoreStr
    ? `${abbr(match.team_home)} ${scoreStr} ${abbr(match.team_away)}`
    : `${abbr(match.team_home)} × ${abbr(match.team_away)}`

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', height: 'auto', maxHeight: 'none' }}>
      {/* Cabeçalho */}
      <div style={{ background: '#ecfdf5', borderBottom: '1px solid #d1fae5', padding: '10px 16px' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#065f46', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {afterDeadline ? 'Cravaram' : 'Cravando'} o placar {abbr(match.team_home)}{scoreStr ? ` ${match.score_home}X${match.score_away}` : ''} {abbr(match.team_away)} ({sorted.length})
        </p>
      </div>

      {/* Secador + chips — layout idêntico ao da tela */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 16px', height: 'auto', maxHeight: 'none' }}>
        {/* Secador apontando para os participantes (scaleX(-1) = vira para a direita) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/secador.png"
          alt="secador"
          style={{ width: 80, height: 80, objectFit: 'contain', flexShrink: 0, transform: 'scaleX(-1)', alignSelf: 'center' }}
        />

        {/* Chips: apenas nome + variação de posição (sem placar repetido, sem pontos) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', height: 'auto' }}>
          {sorted.map(b => {
            const p = participantMap.get(b.participant_id)
            if (!p) return null
            const before = rankBefore[p.id] ?? 0
            const after  = rankAfter[p.id]  ?? 0
            const delta  = before - after
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'white', border: '1px solid #a7f3d0', borderRadius: 9999, padding: '4px 10px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                <span style={{ fontWeight: 600, fontSize: 12, color: '#1f2937' }}>{p.apelido}</span>
                <span style={{ color: '#d1d5db', fontSize: 10 }}>·</span>
                <span style={{ color: '#9ca3af', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                  {before}→{after}
                </span>
                {delta > 0 && <span style={{ color: '#10b981', fontWeight: 700, fontSize: 11 }}>↑{delta}</span>}
                {delta < 0 && <span style={{ color: '#fb7185', fontWeight: 700, fontSize: 11 }}>↓{Math.abs(delta)}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export function RankingPanel({
  match, matchBets, participants, matchPoints, ptsWithoutMatch,
  rankBefore, rankAfter, quase, abbr, isAdmin,
}: Props) {
  const [secador, setSecador] = useState(false)
  const secadorAllowed = canUseSecador(match, isAdmin)
  const [sortKey, setSortKey] = useState<SortKey>('pos')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  // ── Share Secador (mobile) ─────────────────────────────────────────────────
  const [showSecadorExport, setShowSecadorExport] = useState(false)
  const [isSharingSecador, setIsSharingSecador]   = useState(false)
  const secadorExportRef = useRef<HTMLDivElement>(null)

  const hasResult = match.score_home !== null && match.score_away !== null
  const afterDeadline = Date.now() > new Date(match.match_datetime).getTime() + EDIT_WINDOW_MS

  const cravando = matchBets.filter(b =>
    hasResult && b.score_home === match.score_home && b.score_away === match.score_away
  )
  const cravandoPids = new Set(cravando.map(b => b.participant_id))

  // Largura do ghost: mobile para grupos pequenos, mais largo para muitos cravando
  const secadorGhostWidth = cravando.length <= 20 ? 390 : 700

  useEffect(() => {
    if (!showSecadorExport || !secadorExportRef.current) return
    const el = secadorExportRef.current
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
        const file = new File([blob], 'secador.png', { type: 'image/png' })
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] })
        } else {
          const url = URL.createObjectURL(blob)
          const a   = document.createElement('a')
          a.href     = url
          a.download = 'secador.png'
          a.click()
          URL.revokeObjectURL(url)
        }
      } catch (err: unknown) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          console.error('Erro ao compartilhar secador:', err)
        }
      } finally {
        if (!cancelled) { setShowSecadorExport(false); setIsSharingSecador(false) }
      }
    }

    void capture()
    return () => { cancelled = true }
  }, [showSecadorExport])

  const topGainer = participants
    .filter(p => cravandoPids.has(p.id) && (matchPoints[p.id] ?? 0) > 0)
    .sort((a, b) => (matchPoints[b.id] ?? 0) - (matchPoints[a.id] ?? 0))[0]

  const participantMap = new Map(participants.map(p => [p.id, p]))
  const betMap = new Map(matchBets.map(b => [b.participant_id, b]))

  const sortByName = (a: string, b: string) => {
    const pa = participantMap.get(a)?.apelido ?? ''
    const pb = participantMap.get(b)?.apelido ?? ''
    return pa.localeCompare(pb, 'pt-BR')
  }

  const cravandoSorted = [...cravando].sort((a, b) => sortByName(a.participant_id, b.participant_id))

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
    <>
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">

      {/* Cravando agora */}
      {cravando.length > 0 && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">✓ {afterDeadline ? 'Cravaram' : 'Cravando agora'} ({cravando.length})</span>
            <div className="flex items-center gap-2">
              {!afterDeadline && !secador && secadorAllowed && (
                <button
                  onClick={() => setSecador(true)}
                  className="px-3 py-1 rounded-full text-[10px] font-bold text-gray-400 border border-gray-200 hover:border-gray-400 hover:text-gray-600 transition"
                  title="Ativar secador"
                >
                  Secador
                </button>
              )}
              {/* Botão compartilhar secador — somente mobile e dentro da janela de edição */}
              {!afterDeadline && (
                <button
                  onClick={() => { setIsSharingSecador(true); setShowSecadorExport(true) }}
                  disabled={isSharingSecador}
                  className="block md:hidden rounded-full p-1.5 text-emerald-600 hover:bg-emerald-100 transition disabled:opacity-50"
                  aria-label="Compartilhar quem está cravando"
                  title="Compartilhar secador"
                >
                  {isSharingSecador ? (
                    <span className="text-[10px] px-1">…</span>
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
          </div>

          <div className="flex items-start gap-2">
            {/* Secador to the left of chips, pointing right at the first participant */}
            {!afterDeadline && secador && secadorAllowed && (
              <button
                onClick={() => setSecador(false)}
                className="shrink-0 active:scale-95 transition"
                title="Desativar secador"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/secador.png" alt="secador" width={100} height={100}
                  className="object-contain animate-pulse"
                  style={{ transform: 'scaleX(-1)' }}
                />
              </button>
            )}

            <div className="flex flex-wrap gap-1.5">
              {cravandoSorted.map(b => {
                const p = participantMap.get(b.participant_id)
                if (!p) return null
                const before = rankBefore[p.id] ?? 0
                const after  = rankAfter[p.id]  ?? 0
                const delta  = before - after
                const topGainerPts = topGainer ? (matchPoints[topGainer.id] ?? 0) : 0
                const isSecado = secador && topGainer && (matchPoints[p.id] ?? 0) < topGainerPts
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
      {!afterDeadline && (quase.home.length > 0 || quase.away.length > 0) && (
        <div className="border-b border-gray-100 px-4 py-2.5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">Crava se…</p>
          <div className="grid grid-cols-2 gap-2">
            {quase.home.length > 0 && (
              <div>
                <p className="text-[10px] text-blue-500 font-semibold mb-0.5">⚽ {abbr(match.team_home)} marcar</p>
                <div className="flex flex-wrap gap-1">
                  {[...quase.home].sort(sortByName).map(pid => {
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
                  {[...quase.away].sort(sortByName).map(pid => {
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

    {/* Ghost para exportação do Secador — montado apenas ao compartilhar, desmontado após captura */}
    {showSecadorExport && (
      <div style={{ position: 'absolute', top: 0, left: 0, overflow: 'hidden', height: 0, width: 0 }} aria-hidden="true">
        <div ref={secadorExportRef} style={{ width: `${secadorGhostWidth}px`, height: 'auto', maxHeight: 'none' }}>
          <ExportableSecador
            match={match}
            cravando={cravando}
            participantMap={participantMap}
            rankBefore={rankBefore}
            rankAfter={rankAfter}
            abbr={abbr}
            afterDeadline={afterDeadline}
          />
        </div>
      </div>
    )}
    </>
  )
}
