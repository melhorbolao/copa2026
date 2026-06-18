'use client'

import { useState, useMemo, useCallback, memo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Flag } from '@/components/ui/Flag'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import type { RuleMap } from '@/lib/scoring/engine'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MatchWith90 {
  id: string; match_number: number; phase: string; group_name: string | null
  round: number | null; team_home: string; team_away: string
  flag_home: string; flag_away: string; match_datetime: string; city: string
  score_home: number | null; score_away: number | null; penalty_winner: string | null
  is_brazil: boolean; betting_deadline: string
  score_home_90min: number | null; score_away_90min: number | null
}

export interface BetRaw { participant_id: string; match_id: string; score_home: number; score_away: number }
export interface Participant { id: string; apelido: string }
export interface OfficialScore { participant_id: string; pts_total: number }

interface Props {
  isAdmin: boolean; userId: string; activeParticipantId: string
  matches: MatchWith90[]; bets: BetRaw[]; participants: Participant[]
  rules: RuleMap; premioSpots: number
  officialScores: OfficialScore[]; panelaMemberIds: string[]
}

type Score        = { h: number; a: number }
type HighlightMode = 'me' | 'panela' | 'none'
type Zone         = 'premio' | 'corte2' | 'corte1' | 'out' | 'last'

interface RankedRow extends Participant {
  pts: number; cravados: number; pontuados: number; rank: number
  diffLider: number; diffPremio: number | null; diffCorte1: number | null; diffCorte2: number | null
  rankDelta: number | null
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PHASE_FILTERS = [
  { value: 'all',       label: 'Todos',            phases: ['group','round_of_32','round_of_16','quarterfinal','semifinal','third_place','final'] },
  { value: 'alterados', label: '⏱️ Alterados',     phases: [] },
  { value: 'group',     label: 'Grupos',            phases: ['group'] },
  { value: 'r32',       label: '16avos',            phases: ['round_of_32'] },
  { value: 'r16',       label: 'Oitavas',           phases: ['round_of_16'] },
  { value: 'qf',        label: 'Quartas',           phases: ['quarterfinal'] },
  { value: 'sf',        label: 'Semis',             phases: ['semifinal'] },
  { value: 'final',     label: 'Final',             phases: ['third_place','final'] },
] as const

const PHASE_LABELS: Record<string, string> = {
  group: 'Grupos', round_of_32: '16avos', round_of_16: 'Oitavas',
  quarterfinal: 'Quartas', semifinal: 'Semis', third_place: '3º Lugar', final: 'Final',
}

const ZONE_ROW: Record<Zone, string> = {
  premio: 'bg-green-50', corte2: 'bg-sky-50', corte1: 'bg-amber-50', out: 'bg-white', last: 'bg-red-500',
}
const ZONE_TEXT: Record<Zone, string> = {
  premio: 'text-green-800 font-semibold', corte2: 'text-sky-700 font-medium',
  corte1: 'text-amber-700', out: 'text-gray-400', last: 'text-white font-bold',
}
const ZONE_DOT: Record<Zone, string> = {
  premio: 'bg-green-300', corte2: 'bg-sky-300', corte1: 'bg-amber-300', out: 'bg-gray-200', last: 'bg-red-400',
}
const BANNER_BG: Record<Zone, string> = {
  premio: 'bg-green-50 border-green-300', corte2: 'bg-sky-50 border-sky-300',
  corte1: 'bg-amber-50 border-amber-300', out: 'bg-gray-50 border-gray-200', last: 'bg-red-50 border-red-400',
}
const BANNER_RANK: Record<Zone, string> = {
  premio: 'text-green-700', corte2: 'text-sky-700', corte1: 'text-amber-700',
  out: 'text-gray-600', last: 'text-red-600',
}
const ZONE_STATUS: Record<Zone, string> = {
  premio: '🏆 Zona de premiação', corte2: '2º corte', corte1: '1º corte',
  out: 'Fora dos cortes', last: '🔦 Lanterna',
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function calcCuts(n: number): { cut1: number; cut2: number } {
  const cut1 = Math.min(Math.ceil((n * 0.5) / 10) * 10, n)
  const cut2 = Math.min(Math.ceil(cut1 * 0.5), cut1)
  return { cut1, cut2 }
}

function abbr(name: string, max = 9) { return name.length <= max ? name : name.slice(0, max - 1) + '…' }

function fmtMatchDate(dt: string) {
  const d = new Date(dt)
  return {
    date: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }),
    time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NinetyMinClient({
  isAdmin, userId, activeParticipantId, matches, bets, participants, rules, premioSpots,
  officialScores, panelaMemberIds,
}: Props) {

  const [results90, setResults90] = useState<Map<string, Score>>(() => {
    const m = new Map<string, Score>()
    for (const match of matches)
      if (match.score_home_90min !== null && match.score_away_90min !== null)
        m.set(match.id, { h: match.score_home_90min, a: match.score_away_90min })
    return m
  })
  const [simScores,   setSimScores]   = useState<Map<string, Score>>(new Map())
  const [adminInputs, setAdminInputs] = useState<Map<string, { h: string; a: string }>>(() => {
    const m = new Map<string, { h: string; a: string }>()
    for (const match of matches)
      if (match.score_home !== null)
        m.set(match.id, {
          h: match.score_home_90min !== null ? String(match.score_home_90min) : '',
          a: match.score_away_90min !== null ? String(match.score_away_90min) : '',
        })
    return m
  })
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [savedIds,  setSavedIds]  = useState<Set<string>>(new Set())
  const [errorIds,  setErrorIds]  = useState<Set<string>>(new Set())
  const [activeTab,      setActiveTab]      = useState<'jogos' | 'ranking'>('jogos')
  const [phaseFilter,    setPhaseFilter]    = useState<string>('all')
  const [highlightMode,  setHighlightMode]  = useState<HighlightMode>('me')
  const [sortKey,  setSortKey]  = useState<string | null>(null)
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc')

  const panelaSet = useMemo(() => new Set(panelaMemberIds), [panelaMemberIds])

  const matchMap    = useMemo(() => new Map(matches.map(m => [m.id, m])), [matches])
  const betsByMatch = useMemo(() => {
    const m = new Map<string, Array<{ score_home: number; score_away: number }>>()
    for (const bet of bets) {
      const arr = m.get(bet.match_id) ?? []; arr.push({ score_home: bet.score_home, score_away: bet.score_away })
      m.set(bet.match_id, arr)
    }
    return m
  }, [bets])
  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const filteredMatches = useMemo(() => {
    if (phaseFilter === 'alterados') {
      return matches.filter(m => {
        if (m.score_home === null) return false
        const r90 = results90.get(m.id)
        return r90 !== undefined && (r90.h !== m.score_home || r90.a !== m.score_away)
      })
    }
    const pf     = PHASE_FILTERS.find(f => f.value === phaseFilter)
    const phases = [...(pf?.phases ?? PHASE_FILTERS[0].phases)] as string[]
    return matches.filter(m => phases.includes(m.phase))
  }, [matches, phaseFilter, results90])

  // ── Rank oficial (pts_total da tabela participant_scores) ────────────────────

  const officialRankMap = useMemo(() => {
    const sorted = [...officialScores].sort((a, b) => b.pts_total - a.pts_total)
    const m = new Map<string, number>()
    for (let i = 0; i < sorted.length; i++) {
      const rank = i === 0 ? 1
        : sorted[i].pts_total === sorted[i - 1].pts_total ? m.get(sorted[i - 1].participant_id)!
        : i + 1
      m.set(sorted[i].participant_id, rank)
    }
    return m
  }, [officialScores])

  // ── Ranking completo ────────────────────────────────────────────────────────

  const ranking = useMemo((): RankedRow[] => {
    const betsByP = new Map<string, BetRaw[]>()
    for (const bet of bets) {
      if (!betsByP.has(bet.participant_id)) betsByP.set(bet.participant_id, [])
      betsByP.get(bet.participant_id)!.push(bet)
    }

    const withPts = participants.map(p => {
      let pts = 0; let cravados = 0; let pontuados = 0
      for (const bet of (betsByP.get(p.id) ?? [])) {
        const match = matchMap.get(bet.match_id); if (!match) continue
        let sh: number | null = null; let sa: number | null = null
        if (match.score_home !== null) {
          const r90 = results90.get(match.id); if (!r90) continue
          sh = r90.h; sa = r90.a
        } else {
          const sim = simScores.get(match.id); if (!sim) continue
          sh = sim.h; sa = sim.a
        }
        const matchBets = betsByMatch.get(match.id) ?? []
        const isZebra   = detectMatchZebra(matchBets, getMatchResult(sh, sa), zebraThreshold)
        const p90       = scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, match.is_brazil, rules)
        if (bet.score_home === sh && bet.score_away === sa) cravados++
        if (p90 > 0) pontuados++
        pts += p90
      }
      return { ...p, pts, cravados, pontuados }
    }).sort((a, b) => b.pts - a.pts)

    const n          = withPts.length
    const leaderPts  = n > 0 ? withPts[0].pts : 0
    const { cut1, cut2 } = calcCuts(n)
    const premioPts  = n > 0 ? (withPts[Math.min(premioSpots, n) - 1]?.pts ?? null) : null
    const cut1Pts    = n > 0 && cut1 > 0 ? (withPts[Math.min(cut1, n) - 1]?.pts ?? null) : null
    const cut2Pts    = n > 0 && cut2 > 0 ? (withPts[Math.min(cut2, n) - 1]?.pts ?? null) : null

    const out: RankedRow[] = []
    for (let i = 0; i < withPts.length; i++) {
      const rank = i === 0 ? 1 : withPts[i].pts === withPts[i - 1].pts ? out[i - 1].rank : i + 1
      const officialRank = officialRankMap.get(withPts[i].id) ?? null
      out.push({ ...withPts[i], rank,
        diffLider:  withPts[i].pts - leaderPts,
        diffPremio: premioPts  !== null ? withPts[i].pts - premioPts  : null,
        diffCorte1: cut1Pts    !== null ? withPts[i].pts - cut1Pts    : null,
        diffCorte2: cut2Pts    !== null ? withPts[i].pts - cut2Pts    : null,
        rankDelta:  officialRank !== null ? officialRank - rank : null,
      })
    }
    return out
  }, [participants, bets, results90, simScores, matchMap, betsByMatch, rules, zebraThreshold, premioSpots, officialRankMap])

  // Zone helpers
  const { premioLine, cut2Line, cut1Line, lastRank, isUniqueLast } = useMemo(() => {
    const n = ranking.length
    const { cut1, cut2 } = calcCuts(n)
    return {
      premioLine:   n > 0 ? (ranking[Math.min(premioSpots, n) - 1]?.pts ?? Infinity) : Infinity,
      cut2Line:     cut2 > premioSpots ? (ranking[cut2 - 1]?.pts ?? null) : null,
      cut1Line:     cut1 > cut2        ? (ranking[cut1 - 1]?.pts ?? null) : null,
      lastRank:     n > 0 ? ranking[n - 1].rank : 0,
      isUniqueLast: n > 0 && ranking.filter(r => r.rank === ranking[n - 1].rank).length === 1,
    }
  }, [ranking, premioSpots])

  function zoneOf(r: { rank: number; pts: number }): Zone {
    if (isUniqueLast && r.rank === lastRank) return 'last'
    if (r.pts >= premioLine)                 return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line) return 'corte2'
    if (cut1Line !== null && r.pts >= cut1Line) return 'corte1'
    return 'out'
  }

  const myRow  = ranking.find(r => r.id === activeParticipantId) ?? null
  const myZone = myRow ? zoneOf(myRow) : null

  const sortedRanked = useMemo(() => {
    if (!sortKey) return ranking
    return [...ranking].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey]
      const bv = (b as unknown as Record<string, unknown>)[sortKey]
      if (av === null && bv === null) return 0
      if (av === null) return 1; if (bv === null) return -1
      if (typeof av === 'string')
        return sortDir === 'asc' ? (av as string).localeCompare(bv as string, 'pt-BR') : (bv as string).localeCompare(av as string, 'pt-BR')
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [ranking, sortKey, sortDir])

  function handleSort(key: string, defaultDir: 'asc' | 'desc' = 'desc') {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(defaultDir) }
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSimChange = useCallback((matchId: string, side: 'h' | 'a', val: string) => {
    setSimScores(prev => {
      const next = new Map(prev); const n = parseInt(val, 10)
      if (val === '' || isNaN(n) || n < 0) { next.delete(matchId); return next }
      next.set(matchId, { ...(next.get(matchId) ?? { h: 0, a: 0 }), [side]: n }); return next
    })
  }, [])

  const handleAdminInput = useCallback((matchId: string, side: 'h' | 'a', val: string) => {
    setAdminInputs(prev => {
      const next = new Map(prev)
      next.set(matchId, { ...(next.get(matchId) ?? { h: '', a: '' }), [side]: val }); return next
    })
  }, [])

  const handleSave90 = useCallback(async (matchId: string, h: number, a: number) => {
    setSavingIds(prev => new Set([...prev, matchId]))
    setErrorIds(prev => { const n = new Set(prev); n.delete(matchId); return n })
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any
      const { error } = await supabase.from('match_90min_results').upsert(
        { match_id: matchId, score_home_90min: h, score_away_90min: a,
          updated_at: new Date().toISOString(), updated_by: userId },
        { onConflict: 'match_id' }
      )
      if (error) { setErrorIds(prev => new Set([...prev, matchId])) }
      else {
        setResults90(prev => new Map(prev).set(matchId, { h, a }))
        setSavedIds(prev => new Set([...prev, matchId]))
        setTimeout(() => setSavedIds(prev => { const n = new Set(prev); n.delete(matchId); return n }), 2000)
      }
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(matchId); return n })
    }
  }, [userId])

  // ── Sth (sortable header) ──────────────────────────────────────────────────

  function sth(label: string, sortK: string, title?: string, cls = '', defaultDir: 'asc' | 'desc' = 'desc', align = 'text-center') {
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-50 pb-16">
      <DisclaimerBanner />

      {/* Header + tabs */}
      <div className="mx-auto max-w-full px-4 pt-5">
        <h1 className="mb-5 text-lg font-black text-gray-900">
          Evolução e Simulação: Universo 90&apos;
        </h1>
        <div className="mb-4 flex gap-2">
          {(['jogos', 'ranking'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                activeTab === tab
                  ? 'bg-azul-escuro text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
              }`}
            >
              {tab === 'jogos' ? 'Jogos' : 'Classificação'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Jogos — full width ── */}
      {activeTab === 'jogos' && (
        <div className="mx-auto max-w-full px-4">
          <div className="mb-4 flex flex-wrap gap-1">
            {PHASE_FILTERS.map(f => {
              const isActive = phaseFilter === f.value
              const isAltered = f.value === 'alterados'
              return (
                <button
                  key={f.value}
                  onClick={() => setPhaseFilter(f.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    isActive && isAltered  ? 'bg-amber-500 text-white shadow-sm' :
                    isActive               ? 'bg-azul-escuro text-white' :
                    isAltered              ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-300 hover:bg-amber-100' :
                                            'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>

          {filteredMatches.length === 0 ? (
            <p className="py-16 text-center text-sm text-gray-400">Nenhum jogo nesta fase ainda.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredMatches.map(match => (
                <MatchCard90
                  key={match.id}
                  match={match}
                  isAdmin={isAdmin}
                  result90={results90.get(match.id) ?? null}
                  sim={simScores.get(match.id) ?? null}
                  adminInput={adminInputs.get(match.id) ?? null}
                  isSaving={savingIds.has(match.id)}
                  isSaved={savedIds.has(match.id)}
                  isError={errorIds.has(match.id)}
                  onSimChange={handleSimChange}
                  onAdminInput={handleAdminInput}
                  onSave90={handleSave90}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Classificação — full width ── */}
      {activeTab === 'ranking' && (
        <div className="mx-auto max-w-full px-2 py-4 pb-32 sm:px-4 sm:py-6">

          {/* Banner: Minha Posição */}
          {myRow && myZone && (
            <div className={`mb-4 rounded-xl border-2 ${BANNER_BG[myZone]} px-4 py-3`}>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-4xl font-black tabular-nums leading-none ${BANNER_RANK[myZone]}`}>
                    #{myRow.rank}
                  </span>
                  <span className="text-sm leading-none text-gray-400">/ {ranking.length}</span>
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-base font-bold leading-tight text-gray-900">{myRow.apelido}</span>
                  <span className="text-xs text-gray-400">{ZONE_STATUS[myZone]}</span>
                </div>
                <div className={`text-2xl font-black tabular-nums leading-none ${BANNER_RANK[myZone]}`}>
                  {myRow.pts}<span className="ml-1 text-sm font-semibold text-gray-400">pts</span>
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

          {/* Filtros de destaque */}
          <div className="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              {([
                { value: 'me'     as HighlightMode, label: 'Destacar meu nome' },
                ...(panelaMemberIds.length > 0 ? [{ value: 'panela' as HighlightMode, label: 'Destacar minha panela' }] : []),
                { value: 'none'   as HighlightMode, label: 'Sem destaques' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setHighlightMode(opt.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    highlightMode === opt.value
                      ? 'bg-azul-escuro text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* CompactRanking — idêntico ao oficial */}
          <CompactRanking90
            ranking={ranking}
            premioSpots={premioSpots}
            zoneOf={zoneOf}
            isUniqueLast={isUniqueLast}
            highlightMode={highlightMode}
            activeParticipantId={activeParticipantId}
            panelaSet={panelaSet}
          />

          {/* Tabela detalhada */}
          <div className="mb-3 mt-6">
            <h2 className="text-2xl font-black text-gray-900">Classificação Detalhada</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Pontos calculados com placares aos 90 minutos. Jogos futuros incluídos se simulados.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: '760px' }}>
                <thead className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  <tr>
                    {sth('#', 'rank', 'Colocação no Universo 90\'', 'w-8', 'asc', 'text-left')}
                    {sth('Participante', 'apelido', 'Nome do participante', 'w-[160px]', 'asc', 'text-left')}
                    {sth('Pts 90\'', 'pts', 'Pontos no Universo 90\'', 'w-14', 'desc', 'text-right')}
                    {sth('∆ Pos', 'rankDelta', 'Variação de posição: 90min vs. bolão oficial (↑ positivo = melhor no universo 90\')', 'w-14')}
                    {sth('Cravou', 'cravados', 'Placares exatos acertados nos 90min', 'w-14')}
                    {sth('Pontuou', 'pontuados', 'Jogos com pelo menos 1 ponto nos 90min', 'w-14')}
                    {sth('∆ Líder', 'diffLider', 'Diferença pro líder', 'hidden md:table-cell w-14')}
                    {sth('∆ Prêmio', 'diffPremio', `Diferença pro ${premioSpots}º colocado`, 'hidden md:table-cell w-16')}
                    {sth('∆ Corte 1', 'diffCorte1', 'Diferença para o 1º corte', 'w-16')}
                    {sth('∆ Corte 2', 'diffCorte2', 'Diferença para o 2º corte', 'w-16')}
                  </tr>
                </thead>
                <tbody>
                  {ranking.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-sm text-gray-400">
                        Nenhum participante cadastrado ainda.
                      </td>
                    </tr>
                  )}
                  {sortedRanked.map(row => {
                    const z = zoneOf(row)
                    const isActive  = row.id === activeParticipantId
                    const isPanela  = panelaSet.has(row.id)
                    const shouldHL  = z !== 'last' && (
                      (highlightMode === 'me' && isActive) ||
                      (highlightMode === 'panela' && (isActive || isPanela))
                    )
                    const fontCls      = z === 'last' ? 'font-bold' : ''
                    const highlightCls = shouldHL ? '[&_td]:!text-red-600 [&_td]:!font-bold' : ''
                    const showMark = highlightMode !== 'none' && (isActive || (highlightMode === 'panela' && isPanela))
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-gray-100 last:border-0 ${ZONE_ROW[z]} ${fontCls} ${highlightCls} ${z === 'last' ? '[&_*]:!text-white' : ''}`}
                      >
                        <td className={`px-1.5 py-1 tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-500'}`}>
                          {row.rank}
                        </td>
                        <td className={`px-1.5 py-1 w-[160px] ${z === 'last' ? 'text-white' : 'text-gray-900'}`}>
                          <div className="truncate">
                            {row.apelido}
                            {z === 'last' && <span className="ml-1 text-[11px]">🔦</span>}
                            {showMark && (
                              <span className={`ml-1 text-[10px] ${z === 'last' ? 'text-white' : isActive ? 'text-verde-600' : 'text-sky-500'}`}>◀</span>
                            )}
                          </div>
                        </td>
                        <td className={`px-1.5 py-1 text-right font-mono font-bold tabular-nums ${z === 'last' ? 'text-white' : 'text-gray-900'}`}>
                          {row.pts}
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <RankDeltaCell v={row.rankDelta} />
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <span className={`tabular-nums ${row.cravados > 0 ? 'text-verde-600 font-semibold' : 'text-gray-600'}`}>
                            {row.cravados}
                          </span>
                        </td>
                        <td className="px-1.5 py-1 text-center">
                          <span className="tabular-nums text-gray-600">{row.pontuados}</span>
                        </td>
                        <td className="hidden md:table-cell px-1.5 py-1 text-right">
                          <DiffCell v={row.diffLider} />
                        </td>
                        <td className="hidden md:table-cell px-1.5 py-1 text-right">
                          <DiffCell v={row.diffPremio} />
                        </td>
                        <td className="px-1.5 py-1 text-right">
                          <DiffCell v={row.diffCorte1} />
                        </td>
                        <td className="px-1.5 py-1 text-right">
                          <DiffCell v={row.diffCorte2} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ── DisclaimerBanner ───────────────────────────────────────────────────────────

function DisclaimerBanner() {
  return (
    <div className="sticky top-14 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:top-0">
      <p className="mx-auto max-w-5xl text-center text-xs font-medium leading-relaxed text-amber-800 sm:text-sm">
        ⏱️{' '}
        <strong className="font-bold text-amber-900">Arena 90 Minutos: A Copa sem Acréscimos.</strong>{' '}
        Esta é uma página de simulação exclusiva. Todos os jogos finalizados utilizam o placar oficial
        registrado rigidamente aos 90:00 do tempo regulamentar.
      </p>
    </div>
  )
}

// ── CompactRanking90 — idêntico ao formato oficial ─────────────────────────────

function CompactRanking90({
  ranking, premioSpots, zoneOf, isUniqueLast, highlightMode, activeParticipantId, panelaSet,
}: {
  ranking: RankedRow[]
  premioSpots: number
  zoneOf: (r: { rank: number; pts: number }) => Zone
  isUniqueLast: boolean
  highlightMode: HighlightMode
  activeParticipantId: string
  panelaSet: Set<string>
}) {
  const n = ranking.length
  if (n === 0) return null

  const { cut1, cut2 } = calcCuts(n)
  const blockSize = Math.ceil(n / 7)
  const blocks = [0,1,2,3,4,5,6]
    .map(i => ranking.slice(i * blockSize, (i + 1) * blockSize))
    .filter(b => b.length > 0)

  const legendItems: { zone: Zone; label: string }[] = [
    { zone: 'premio', label: `Premiação (top ${premioSpots})` },
    ...(cut2 > premioSpots ? [{ zone: 'corte2' as Zone, label: `2º corte (top ${cut2})` }] : []),
    ...(cut1 > cut2        ? [{ zone: 'corte1' as Zone, label: `1º corte (top ${cut1})` }] : []),
    ...(isUniqueLast ? [{ zone: 'last' as Zone, label: 'Lanterna' }] : []),
  ]

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-base font-black text-gray-800">Classificação Chororô — E se os jogos acabassem aos 90?</p>
      </div>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 divide-x divide-gray-100" style={{ minWidth: '1200px' }}>
          {blocks.map((block, bi) => (
            <div key={bi}>
              <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem] border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                <span className="pr-0.5 text-right">#</span>
                <span className="pl-1">Participante</span>
                <span className="text-right">PTS</span>
                <span className="text-right" title="Variação de posição vs. bolão oficial (↑ positivo = melhor no universo 90')">∆</span>
              </div>
              {block.map((r, ri) => {
                const z         = zoneOf(r)
                const boundary  = ri > 0 && zoneOf(block[ri - 1]) !== z
                const isActive  = r.id === activeParticipantId
                const isPanela  = panelaSet.has(r.id)
                const shouldHL  = z !== 'last' && (
                  (highlightMode === 'me' && isActive) ||
                  (highlightMode === 'panela' && (isActive || isPanela))
                )
                const textCls   = shouldHL ? 'text-red-600 font-semibold' : ZONE_TEXT[z]
                const ringCls   = shouldHL ? 'ring-1 ring-inset ring-red-500' : ''
                const delta     = r.rankDelta
                return (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1.5rem_1fr_2rem_2rem] px-2 py-[3px] text-[12px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''} ${ringCls}`}
                  >
                    <span className={`pr-0.5 text-right tabular-nums ${textCls}`}>{r.rank}</span>
                    <span className={`truncate pl-1 ${textCls}`} title={r.apelido}>
                      {r.apelido}{z === 'last' && ' 🔦'}
                    </span>
                    <span className={`text-right tabular-nums font-bold ${textCls}`}>{r.pts}</span>
                    <span className="text-right tabular-nums text-[10px]">
                      {delta === null ? <span className="text-gray-300">—</span>
                        : delta === 0 ? <span className="text-gray-400">=</span>
                        : delta > 0   ? <span className="font-semibold text-verde-600">▲{delta}</span>
                        :               <span className="font-semibold text-red-500">▼{Math.abs(delta)}</span>
                      }
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 bg-gray-50 px-4 py-2">
        {legendItems.map(({ zone: z, label }) => (
          <span key={z} className="flex items-center gap-1 text-[11px] text-gray-500">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${ZONE_DOT[z]}`} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-gray-400">∆ = posição no Universo 90&apos; vs. bolão oficial</span>
      </div>
    </div>
  )
}

// ── DiffCell ──────────────────────────────────────────────────────────────────

const DiffCell = memo(function DiffCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-300">—</span>
  if (v === 0)   return <span className="tabular-nums font-mono text-amber-500">0</span>
  if (v > 0)    return <span className="tabular-nums font-mono text-verde-600">+{v}</span>
  return <span className="tabular-nums font-mono text-red-500">{v}</span>
})

const RankDeltaCell = memo(function RankDeltaCell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-gray-300">—</span>
  if (v === 0)   return <span className="text-gray-400">=</span>
  if (v > 0)    return <span className="tabular-nums font-semibold text-verde-600">▲{v}</span>
  return <span className="tabular-nums font-semibold text-red-500">▼{Math.abs(v)}</span>
})

// ── MatchCard90 ────────────────────────────────────────────────────────────────

interface CardProps {
  match: MatchWith90; isAdmin: boolean; result90: Score | null; sim: Score | null
  adminInput: { h: string; a: string } | null; isSaving: boolean; isSaved: boolean; isError: boolean
  onSimChange: (matchId: string, side: 'h' | 'a', val: string) => void
  onAdminInput: (matchId: string, side: 'h' | 'a', val: string) => void
  onSave90: (matchId: string, h: number, a: number) => void
}

const MatchCard90 = memo(function MatchCard90({
  match, isAdmin, result90, sim, adminInput, isSaving, isSaved, isError,
  onSimChange, onAdminInput, onSave90,
}: CardProps) {
  const isCompleted = match.score_home !== null
  const isDivergent = isCompleted && result90 !== null &&
    (result90.h !== match.score_home || result90.a !== match.score_away)
  const { date, time } = fmtMatchDate(match.match_datetime)

  // Auto-save ao alterar inputs com debounce de 700ms
  useEffect(() => {
    if (!isAdmin || !isCompleted) return
    if (!adminInput || adminInput.h === '' || adminInput.a === '') return
    const h = parseInt(adminInput.h, 10); const a = parseInt(adminInput.a, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return
    const timer = setTimeout(() => onSave90(match.id, h, a), 700)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminInput?.h, adminInput?.a])

  // Admins com jogos concluídos veem o placar OFICIAL no centro —
  // o placar 90' fica exclusivamente nos inputs abaixo.
  // Demais usuários veem o placar 90' no centro.
  let scoreDisplay: React.ReactNode
  if (isAdmin && isCompleted)
    scoreDisplay = <>{match.score_home}<span className="mx-0.5 text-gray-400">×</span>{match.score_away}</>
  else if (result90 !== null)
    scoreDisplay = <>{result90.h}<span className="mx-0.5 text-gray-400">×</span>{result90.a}</>
  else if (isCompleted)
    scoreDisplay = <span className="text-[10px] font-normal text-gray-400">Aguardando</span>
  else if (sim !== null)
    scoreDisplay = <>{sim.h}<span className="mx-0.5 text-gray-400">×</span>{sim.a}</>
  else
    scoreDisplay = <span className="text-gray-300">— × —</span>

  return (
    <div className={`overflow-hidden rounded-xl border-2 transition-all ${
      isDivergent
        ? 'border-amber-500 shadow-md shadow-amber-200'
        : 'border-gray-200 bg-white shadow-sm'
    }`}>
      {/* Banner de destaque para jogos divergentes */}
      {isDivergent && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 px-3 py-2.5">
          <span className="text-lg leading-none">⏱️</span>
          <span className="text-sm font-black tracking-wide text-white">Alterado nos acréscimos</span>
        </div>
      )}

      <div className={`p-3 ${isDivergent ? 'bg-amber-50' : ''}`}>
        <div className="mb-2 flex items-center justify-between text-[10px] text-gray-400">
          <span>{date} {time}</span>
          <span>{PHASE_LABELS[match.phase] ?? match.phase}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <span className="truncate text-xs font-semibold text-gray-900">{abbr(match.team_home)}</span>
            <Flag code={match.flag_home} size="sm" />
          </div>
          <div className="flex min-w-[64px] shrink-0 items-center justify-center rounded-md bg-gray-100 px-2 py-1 text-sm font-bold text-gray-800">
            {scoreDisplay}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Flag code={match.flag_away} size="sm" />
            <span className="truncate text-xs font-semibold text-gray-900">{abbr(match.team_away)}</span>
          </div>
        </div>

        {/* Placar oficial: só para não-admins, pois admins já o veem no centro */}
        {isDivergent && !isAdmin && (
          <p className="mt-2.5 rounded-lg bg-amber-100 px-3 py-2 text-center text-sm font-semibold leading-snug text-amber-800">
            Placar final oficial:{' '}
            <span className="font-black text-amber-900">{match.score_home} × {match.score_away}</span>
          </p>
        )}

        {!isCompleted && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <ScoreInput value={sim?.h} placeholder="0" onChange={v => onSimChange(match.id, 'h', v)} />
            <span className="text-xs text-gray-400">×</span>
            <ScoreInput value={sim?.a} placeholder="0" onChange={v => onSimChange(match.id, 'a', v)} />
          </div>
        )}

        {isAdmin && isCompleted && (
          <div className="mt-3 flex items-center justify-center gap-2">
            {/* Botão = Oficial */}
            <button
              onClick={() => {
                if (match.score_home === null || match.score_away === null) return
                onAdminInput(match.id, 'h', String(match.score_home))
                onAdminInput(match.id, 'a', String(match.score_away))
              }}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition"
              title="Copiar placar oficial para o Universo 90'"
            >
              = Oficial
            </button>
            <span className="text-[10px] font-semibold text-amber-600">90&apos;</span>
            <AdminScoreInput value={adminInput?.h ?? ''} onChange={v => onAdminInput(match.id, 'h', v)} />
            <span className="text-xs text-gray-400">×</span>
            <AdminScoreInput value={adminInput?.a ?? ''} onChange={v => onAdminInput(match.id, 'a', v)} />
            {/* Indicador de status (sem botão Salvar) */}
            <span className={`w-5 text-center text-sm transition ${
              isSaved ? 'text-emerald-500' : isError ? 'text-rose-500' : isSaving ? 'text-gray-400' : 'text-transparent'
            }`}>
              {isSaved ? '✓' : isError ? '!' : '…'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
})

function ScoreInput({ value, placeholder, onChange }: { value?: number; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number" min={0} max={99} value={value !== undefined ? value : ''} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-10 rounded border border-gray-300 bg-white text-center text-sm text-gray-800 outline-none focus:border-gray-500"
    />
  )
}

function AdminScoreInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number" min={0} max={99} value={value} placeholder="—"
      onChange={e => onChange(e.target.value)}
      className="w-10 rounded border border-amber-400 bg-white text-center text-sm text-gray-800 outline-none focus:border-amber-600"
    />
  )
}
