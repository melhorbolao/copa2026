'use client'

import { useState, useMemo, useCallback, memo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Flag } from '@/components/ui/Flag'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import type { RuleMap } from '@/lib/scoring/engine'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MatchWith90 {
  id: string
  match_number: number
  phase: string
  group_name: string | null
  round: number | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  match_datetime: string
  city: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
  is_brazil: boolean
  betting_deadline: string
  score_home_90min: number | null
  score_away_90min: number | null
}

export interface BetRaw {
  participant_id: string
  match_id: string
  score_home: number
  score_away: number
}

export interface Participant {
  id: string
  apelido: string
}

interface Props {
  isAdmin: boolean
  userId: string
  matches: MatchWith90[]
  bets: BetRaw[]
  participants: Participant[]
  rules: RuleMap
  premioSpots: number
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PHASE_FILTERS = [
  { value: 'all',    label: 'Todos',   phases: ['group','round_of_32','round_of_16','quarterfinal','semifinal','third_place','final'] },
  { value: 'group',  label: 'Grupos',  phases: ['group'] },
  { value: 'r32',    label: '16avos',  phases: ['round_of_32'] },
  { value: 'r16',    label: 'Oitavas', phases: ['round_of_16'] },
  { value: 'qf',     label: 'Quartas', phases: ['quarterfinal'] },
  { value: 'sf',     label: 'Semis',   phases: ['semifinal'] },
  { value: 'final',  label: 'Final',   phases: ['third_place','final'] },
] as const

const PHASE_LABELS: Record<string, string> = {
  group:        'Grupos',
  round_of_32:  '16avos',
  round_of_16:  'Oitavas',
  quarterfinal: 'Quartas',
  semifinal:    'Semis',
  third_place:  '3º Lugar',
  final:        'Final',
}

// ── Zone helpers (same thresholds as CompactRanking official) ──────────────────

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

function calcCuts(n: number): { cut1: number; cut2: number } {
  const cut1 = Math.min(Math.ceil((n * 0.5) / 10) * 10, n)
  const cut2 = Math.min(Math.ceil(cut1 * 0.5), cut1)
  return { cut1, cut2 }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function abbr(name: string, max = 9) {
  return name.length <= max ? name : name.slice(0, max - 1) + '…'
}

function fmtMatchDate(dt: string) {
  const d = new Date(dt)
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return { date, time }
}

type Score = { h: number; a: number }

// ── Main component ─────────────────────────────────────────────────────────────

export function NinetyMinClient({ isAdmin, userId, matches, bets, participants, rules, premioSpots }: Props) {
  const [results90, setResults90] = useState<Map<string, Score>>(() => {
    const m = new Map<string, Score>()
    for (const match of matches) {
      if (match.score_home_90min !== null && match.score_away_90min !== null) {
        m.set(match.id, { h: match.score_home_90min, a: match.score_away_90min })
      }
    }
    return m
  })

  const [simScores, setSimScores] = useState<Map<string, Score>>(new Map())

  const [adminInputs, setAdminInputs] = useState<Map<string, { h: string; a: string }>>(() => {
    const m = new Map<string, { h: string; a: string }>()
    for (const match of matches) {
      if (match.score_home !== null) {
        m.set(match.id, {
          h: match.score_home_90min !== null ? String(match.score_home_90min) : '',
          a: match.score_away_90min !== null ? String(match.score_away_90min) : '',
        })
      }
    }
    return m
  })

  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [savedIds,  setSavedIds]  = useState<Set<string>>(new Set())
  const [errorIds,  setErrorIds]  = useState<Set<string>>(new Set())
  const [activeTab,   setActiveTab]   = useState<'jogos' | 'ranking'>('jogos')
  const [phaseFilter, setPhaseFilter] = useState<string>('all')

  const matchMap = useMemo(() => new Map(matches.map(m => [m.id, m])), [matches])

  const betsByMatch = useMemo(() => {
    const m = new Map<string, Array<{ score_home: number; score_away: number }>>()
    for (const bet of bets) {
      const arr = m.get(bet.match_id) ?? []
      arr.push({ score_home: bet.score_home, score_away: bet.score_away })
      m.set(bet.match_id, arr)
    }
    return m
  }, [bets])

  const zebraThreshold = rules['percentual_zebra'] ?? 15

  const filteredMatches = useMemo(() => {
    const pf = PHASE_FILTERS.find(f => f.value === phaseFilter)
    const phases = [...(pf?.phases ?? PHASE_FILTERS[0].phases)] as string[]
    return matches.filter(m => phases.includes(m.phase))
  }, [matches, phaseFilter])

  const ranking = useMemo(() => {
    const betsByP = new Map<string, BetRaw[]>()
    for (const bet of bets) {
      if (!betsByP.has(bet.participant_id)) betsByP.set(bet.participant_id, [])
      betsByP.get(bet.participant_id)!.push(bet)
    }

    const withPts = participants.map(p => {
      let total = 0
      for (const bet of (betsByP.get(p.id) ?? [])) {
        const match = matchMap.get(bet.match_id)
        if (!match) continue

        let sh: number | null = null
        let sa: number | null = null

        if (match.score_home !== null) {
          const r90 = results90.get(match.id)
          if (!r90) continue
          sh = r90.h; sa = r90.a
        } else {
          const sim = simScores.get(match.id)
          if (!sim) continue
          sh = sim.h; sa = sim.a
        }

        const matchBets = betsByMatch.get(match.id) ?? []
        const isZebra   = detectMatchZebra(matchBets, getMatchResult(sh, sa), zebraThreshold)
        total += scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, match.is_brazil, rules)
      }
      return { ...p, pts: total }
    }).sort((a, b) => b.pts - a.pts)

    // Rank com empate
    const out: Array<typeof withPts[0] & { rank: number }> = []
    for (let i = 0; i < withPts.length; i++) {
      const rank = i === 0 ? 1
        : withPts[i].pts === withPts[i - 1].pts ? out[i - 1].rank
        : i + 1
      out.push({ ...withPts[i], rank })
    }
    return out
  }, [participants, bets, results90, simScores, matchMap, betsByMatch, rules, zebraThreshold])

  const handleSimChange = useCallback((matchId: string, side: 'h' | 'a', val: string) => {
    setSimScores(prev => {
      const next = new Map(prev)
      const n    = parseInt(val, 10)
      if (val === '' || isNaN(n) || n < 0) {
        next.delete(matchId)
        return next
      }
      const cur = next.get(matchId) ?? { h: 0, a: 0 }
      next.set(matchId, { ...cur, [side]: n })
      return next
    })
  }, [])

  const handleAdminInput = useCallback((matchId: string, side: 'h' | 'a', val: string) => {
    setAdminInputs(prev => {
      const next = new Map(prev)
      const cur  = next.get(matchId) ?? { h: '', a: '' }
      next.set(matchId, { ...cur, [side]: val })
      return next
    })
  }, [])

  const handleSave90 = useCallback(async (matchId: string) => {
    const input = adminInputs.get(matchId)
    if (!input || input.h === '' || input.a === '') return
    const h = parseInt(input.h, 10)
    const a = parseInt(input.a, 10)
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return

    setSavingIds(prev => new Set([...prev, matchId]))
    setErrorIds(prev => { const n = new Set(prev); n.delete(matchId); return n })

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any
      const { error } = await supabase
        .from('match_90min_results')
        .upsert(
          { match_id: matchId, score_home_90min: h, score_away_90min: a,
            updated_at: new Date().toISOString(), updated_by: userId },
          { onConflict: 'match_id' }
        )
      if (error) {
        setErrorIds(prev => new Set([...prev, matchId]))
      } else {
        setResults90(prev => new Map(prev).set(matchId, { h, a }))
        setSavedIds(prev => new Set([...prev, matchId]))
        setTimeout(() => setSavedIds(prev => {
          const n = new Set(prev); n.delete(matchId); return n
        }), 2000)
      }
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(matchId); return n })
    }
  }, [adminInputs, userId])

  return (
    <main className="min-h-screen bg-gray-50 pb-16">
      <DisclaimerBanner />

      <div className="mx-auto max-w-5xl px-4 pt-5">
        <h1 className="mb-5 text-lg font-black text-gray-900">
          Evolução e Simulação: Universo 90&apos;
        </h1>

        {/* ── Tabs ── */}
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

        {/* ── Tab: Jogos ── */}
        {activeTab === 'jogos' && (
          <>
            <div className="mb-4 flex flex-wrap gap-1">
              {PHASE_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setPhaseFilter(f.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    phaseFilter === f.value
                      ? 'bg-azul-escuro text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredMatches.length === 0 ? (
              <p className="py-16 text-center text-sm text-gray-400">
                Nenhum jogo nesta fase ainda.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
          </>
        )}

        {/* ── Tab: Classificação ── */}
        {activeTab === 'ranking' && (
          <CompactRanking90 ranking={ranking} premioSpots={premioSpots} />
        )}
      </div>
    </main>
  )
}

// ── DisclaimerBanner ───────────────────────────────────────────────────────────

function DisclaimerBanner() {
  return (
    <div className="sticky top-14 z-40 border-b border-amber-200 bg-amber-50 px-4 py-2.5 sm:top-0">
      <p className="mx-auto max-w-5xl text-center text-xs font-medium leading-relaxed text-amber-800 sm:text-sm">
        ⏱️{' '}
        <strong className="font-bold text-amber-900">
          Arena 90 Minutos: A Copa sem Acréscimos.
        </strong>{' '}
        Esta é uma página de simulação exclusiva. Todos os jogos finalizados utilizam o placar oficial
        registrado rigidamente aos 90:00 do tempo regulamentar.
      </p>
    </div>
  )
}

// ── MatchCard90 ────────────────────────────────────────────────────────────────

interface CardProps {
  match: MatchWith90
  isAdmin: boolean
  result90: Score | null
  sim: Score | null
  adminInput: { h: string; a: string } | null
  isSaving: boolean
  isSaved: boolean
  isError: boolean
  onSimChange: (matchId: string, side: 'h' | 'a', val: string) => void
  onAdminInput: (matchId: string, side: 'h' | 'a', val: string) => void
  onSave90: (matchId: string) => void
}

const MatchCard90 = memo(function MatchCard90({
  match, isAdmin, result90, sim, adminInput,
  isSaving, isSaved, isError,
  onSimChange, onAdminInput, onSave90,
}: CardProps) {
  const isCompleted = match.score_home !== null

  const isDivergent = isCompleted && result90 !== null && (
    result90.h !== match.score_home || result90.a !== match.score_away
  )

  const { date, time } = fmtMatchDate(match.match_datetime)

  let scoreDisplay: React.ReactNode
  if (result90 !== null) {
    scoreDisplay = (
      <>{result90.h}<span className="mx-0.5 text-gray-400">×</span>{result90.a}</>
    )
  } else if (isCompleted) {
    scoreDisplay = <span className="text-[10px] font-normal text-gray-400">Aguardando</span>
  } else if (sim !== null) {
    scoreDisplay = (
      <>{sim.h}<span className="mx-0.5 text-gray-400">×</span>{sim.a}</>
    )
  } else {
    scoreDisplay = <span className="text-gray-300">— × —</span>
  }

  const canSave = adminInput && adminInput.h !== '' && adminInput.a !== '' && !isSaving

  return (
    <div
      className={`relative rounded-xl border p-3 pt-4 transition-colors ${
        isDivergent
          ? 'border-amber-500/50 bg-amber-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      {isDivergent && (
        <span className="absolute -top-2.5 right-3 flex items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold leading-none text-white shadow">
          ⏱️ Alterado nos acréscimos
        </span>
      )}

      <div className="mb-2 flex items-center justify-between text-[10px] text-gray-400">
        <span>{date} {time}</span>
        <span>{PHASE_LABELS[match.phase] ?? match.phase}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span className="truncate text-xs font-semibold text-gray-900">
            {abbr(match.team_home)}
          </span>
          <Flag code={match.flag_home} size="sm" />
        </div>

        <div className="flex min-w-[64px] shrink-0 items-center justify-center rounded-md bg-gray-100 px-2 py-1 text-sm font-bold text-gray-800">
          {scoreDisplay}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Flag code={match.flag_away} size="sm" />
          <span className="truncate text-xs font-semibold text-gray-900">
            {abbr(match.team_away)}
          </span>
        </div>
      </div>

      {isDivergent && (
        <p className="mt-1.5 text-center text-[10px] leading-tight text-amber-600">
          Placar final oficial: {match.score_home} × {match.score_away}
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
          <span className="text-[10px] font-semibold text-amber-600">90&apos;</span>
          <AdminScoreInput value={adminInput?.h ?? ''} onChange={v => onAdminInput(match.id, 'h', v)} />
          <span className="text-xs text-gray-400">×</span>
          <AdminScoreInput value={adminInput?.a ?? ''} onChange={v => onAdminInput(match.id, 'a', v)} />
          <button
            onClick={() => onSave90(match.id)}
            disabled={!canSave}
            title={isError ? 'Erro ao salvar — tente novamente' : undefined}
            className={`rounded px-2.5 py-1 text-[10px] font-bold transition ${
              isSaved   ? 'bg-emerald-500 text-white' :
              isError   ? 'bg-rose-500 text-white' :
              'bg-ouro text-azul-dark hover:bg-ouro/80 disabled:cursor-not-allowed disabled:opacity-40'
            }`}
          >
            {isSaved ? '✓' : isError ? '!' : isSaving ? '…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
})

function ScoreInput({ value, placeholder, onChange }: { value?: number; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={99}
      value={value !== undefined ? value : ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-10 rounded border border-gray-300 bg-white text-center text-sm text-gray-800 outline-none focus:border-gray-500 focus:ring-0"
    />
  )
}

function AdminScoreInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={99}
      value={value}
      placeholder="—"
      onChange={e => onChange(e.target.value)}
      className="w-10 rounded border border-amber-400 bg-white text-center text-sm text-gray-800 outline-none focus:border-amber-600 focus:ring-0"
    />
  )
}

// ── CompactRanking90 — mesmo formato da Classificação Resumida oficial ─────────

function CompactRanking90({
  ranking,
  premioSpots,
}: {
  ranking: Array<{ id: string; apelido: string; pts: number; rank: number }>
  premioSpots: number
}) {
  const n = ranking.length
  if (n === 0) {
    return (
      <p className="py-16 text-center text-sm text-gray-400">
        Nenhum participante encontrado.
      </p>
    )
  }

  const { cut1, cut2 } = calcCuts(n)
  const premioLine = ranking[Math.min(premioSpots, n) - 1]?.pts ?? Infinity
  const cut2Line   = cut2 > premioSpots ? (ranking[cut2 - 1]?.pts ?? null) : null
  const cut1Line   = cut1 > cut2        ? (ranking[cut1 - 1]?.pts ?? null) : null
  const lastRank   = ranking[n - 1].rank
  const isUniqueLast = ranking.filter(r => r.rank === lastRank).length === 1

  function zoneOf(r: { rank: number; pts: number }): Zone {
    if (isUniqueLast && r.rank === lastRank) return 'last'
    if (r.pts >= premioLine)                 return 'premio'
    if (cut2Line !== null && r.pts >= cut2Line) return 'corte2'
    if (cut1Line !== null && r.pts >= cut1Line) return 'corte1'
    return 'out'
  }

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
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-2.5">
        <p className="text-base font-black text-gray-800">Classificação Universo 90&apos;</p>
        <p className="mt-0.5 text-xs text-gray-400">
          Pontos calculados com placares aos 90 minutos. Jogos futuros incluídos se simulados.
        </p>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid divide-x divide-gray-100"
          style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))`, minWidth: '1200px' }}
        >
          {blocks.map((block, bi) => (
            <div key={bi}>
              {/* Cabeçalho do bloco */}
              <div className="grid grid-cols-[1.5rem_1fr_2rem] border-b border-gray-100 bg-gray-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                <span className="pr-0.5 text-right">#</span>
                <span className="pl-1">Participante</span>
                <span className="text-right">PTS</span>
              </div>
              {/* Linhas */}
              {block.map((r, ri) => {
                const z        = zoneOf(r)
                const boundary = ri > 0 && zoneOf(block[ri - 1]) !== z
                return (
                  <div
                    key={r.id}
                    className={`grid grid-cols-[1.5rem_1fr_2rem] px-2 py-[3px] text-[12px] ${ZONE_ROW[z]} ${boundary ? 'border-t border-gray-200' : ''}`}
                  >
                    <span className={`pr-0.5 text-right tabular-nums ${ZONE_TEXT[z]}`}>{r.rank}</span>
                    <span className={`truncate pl-1 ${ZONE_TEXT[z]}`} title={r.apelido}>
                      {r.apelido}{z === 'last' && ' 🔦'}
                    </span>
                    <span className={`text-right tabular-nums font-bold ${ZONE_TEXT[z]}`}>{r.pts}</span>
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
