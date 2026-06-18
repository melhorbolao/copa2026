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

export function NinetyMinClient({ isAdmin, userId, matches, bets, participants, rules }: Props) {
  // 90min results confirmed in DB (updated on successful save)
  const [results90, setResults90] = useState<Map<string, Score>>(() => {
    const m = new Map<string, Score>()
    for (const match of matches) {
      if (match.score_home_90min !== null && match.score_away_90min !== null) {
        m.set(match.id, { h: match.score_home_90min, a: match.score_away_90min })
      }
    }
    return m
  })

  // Local simulation state for future matches (not persisted)
  const [simScores, setSimScores] = useState<Map<string, Score>>(new Map())

  // Admin input draft values (for completed matches, before save)
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

  // ── Derived maps ────────────────────────────────────────────────────────────

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

  // ── Filtered matches ────────────────────────────────────────────────────────

  const filteredMatches = useMemo(() => {
    const pf = PHASE_FILTERS.find(f => f.value === phaseFilter)
    const phases = [...(pf?.phases ?? PHASE_FILTERS[0].phases)] as string[]
    return matches.filter(m => phases.includes(m.phase))
  }, [matches, phaseFilter])

  // ── Ranking (recomputed on every results90 or simScores change) ─────────────

  const ranking = useMemo(() => {
    const betsByP = new Map<string, BetRaw[]>()
    for (const bet of bets) {
      if (!betsByP.has(bet.participant_id)) betsByP.set(bet.participant_id, [])
      betsByP.get(bet.participant_id)!.push(bet)
    }

    return participants
      .map(p => {
        let total = 0
        for (const bet of (betsByP.get(p.id) ?? [])) {
          const match = matchMap.get(bet.match_id)
          if (!match) continue

          let sh: number | null = null
          let sa: number | null = null

          if (match.score_home !== null) {
            // Jogo encerrado: usa placar dos 90 minutos (se cadastrado)
            const r90 = results90.get(match.id)
            if (!r90) continue
            sh = r90.h
            sa = r90.a
          } else {
            // Jogo futuro: usa simulação local
            const sim = simScores.get(match.id)
            if (!sim) continue
            sh = sim.h
            sa = sim.a
          }

          const matchBets  = betsByMatch.get(match.id) ?? []
          const isZebra    = detectMatchZebra(matchBets, getMatchResult(sh, sa), zebraThreshold)
          total += scoreMatchBet(bet.score_home, bet.score_away, sh, sa, isZebra, match.is_brazil, rules)
        }
        return { ...p, pts: total }
      })
      .sort((a, b) => b.pts - a.pts)
      .map((p, i) => ({ ...p, rank: i + 1 }))
  }, [participants, bets, results90, simScores, matchMap, betsByMatch, rules, zebraThreshold])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSimChange = useCallback((matchId: string, side: 'h' | 'a', val: string) => {
    setSimScores(prev => {
      const next = new Map(prev)
      const n    = parseInt(val, 10)
      if (val === '' || isNaN(n) || n < 0) {
        // Clear this side — if both sides empty, remove entry
        const cur = next.get(matchId)
        if (!cur) return next
        const updated = { ...cur, [side]: 0 }
        if (val === '') { next.delete(matchId) } else { next.set(matchId, updated) }
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-azul-dark pb-16">
      <DisclaimerBanner />

      <div className="mx-auto max-w-5xl px-4 pt-5">
        <h1 className="mb-5 text-lg font-bold text-ouro">
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
                  ? 'bg-ouro text-azul-dark'
                  : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
              }`}
            >
              {tab === 'jogos' ? 'Jogos' : 'Classificação'}
            </button>
          ))}
        </div>

        {/* ── Tab: Jogos ── */}
        {activeTab === 'jogos' && (
          <>
            {/* Phase filter */}
            <div className="mb-4 flex flex-wrap gap-1">
              {PHASE_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setPhaseFilter(f.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    phaseFilter === f.value
                      ? 'bg-ouro text-azul-dark'
                      : 'bg-white/10 text-white/50 hover:bg-white/20 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredMatches.length === 0 ? (
              <p className="py-16 text-center text-sm text-white/30">
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
          <RankingTable ranking={ranking} />
        )}
      </div>
    </main>
  )
}

// ── DisclaimerBanner ───────────────────────────────────────────────────────────

function DisclaimerBanner() {
  return (
    <div className="sticky top-14 z-40 border-b border-amber-500/30 bg-amber-900/80 px-4 py-2.5 backdrop-blur-sm sm:top-0">
      <p className="mx-auto max-w-5xl text-center text-xs font-medium leading-relaxed text-amber-200 sm:text-sm">
        ⏱️{' '}
        <strong className="font-bold text-amber-100">
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

  // Divergente: jogo encerrado, 90min cadastrado, e placar 90min ≠ placar oficial
  const isDivergent = isCompleted && result90 !== null && (
    result90.h !== match.score_home || result90.a !== match.score_away
  )

  const { date, time } = fmtMatchDate(match.match_datetime)

  // Conteúdo do score box
  let scoreDisplay: React.ReactNode
  if (result90 !== null) {
    scoreDisplay = (
      <>{result90.h}<span className="mx-0.5 text-white/40">×</span>{result90.a}</>
    )
  } else if (isCompleted) {
    scoreDisplay = <span className="text-[10px] font-normal text-white/30">Aguardando</span>
  } else if (sim !== null) {
    scoreDisplay = (
      <>{sim.h}<span className="mx-0.5 text-white/40">×</span>{sim.a}</>
    )
  } else {
    scoreDisplay = <span className="text-white/25">— × —</span>
  }

  const canSave = adminInput && adminInput.h !== '' && adminInput.a !== '' && !isSaving

  return (
    <div
      className={`relative rounded-xl border p-3 pt-4 transition-colors ${
        isDivergent
          ? 'border-amber-500/50 bg-amber-900/10'
          : 'border-white/10 bg-white/5'
      }`}
    >
      {/* Badge flutuante — absoluto, não altera layout de fluxo */}
      {isDivergent && (
        <span className="absolute -top-2.5 right-3 flex items-center gap-0.5 rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold leading-none text-white shadow">
          ⏱️ Alterado nos acréscimos
        </span>
      )}

      {/* Cabeçalho: data + fase */}
      <div className="mb-2 flex items-center justify-between text-[10px] text-white/40">
        <span>{date} {time}</span>
        <span>{PHASE_LABELS[match.phase] ?? match.phase}</span>
      </div>

      {/* Times + placar 90' */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span className="truncate text-xs font-semibold text-white/90">
            {abbr(match.team_home)}
          </span>
          <Flag code={match.flag_home} size="sm" />
        </div>

        <div className="flex min-w-[64px] shrink-0 items-center justify-center rounded-md bg-white/10 px-2 py-1 text-sm font-bold text-white">
          {scoreDisplay}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Flag code={match.flag_away} size="sm" />
          <span className="truncate text-xs font-semibold text-white/90">
            {abbr(match.team_away)}
          </span>
        </div>
      </div>

      {/* Subtítulo de divergência — flui normalmente abaixo do score box */}
      {isDivergent && (
        <p className="mt-1.5 text-center text-[10px] leading-tight text-amber-400/80">
          Placar final oficial: {match.score_home} × {match.score_away}
        </p>
      )}

      {/* Simulação local para jogos futuros — todos os usuários */}
      {!isCompleted && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <ScoreInput
            value={sim?.h}
            placeholder="0"
            onChange={v => onSimChange(match.id, 'h', v)}
          />
          <span className="text-xs text-white/40">×</span>
          <ScoreInput
            value={sim?.a}
            placeholder="0"
            onChange={v => onSimChange(match.id, 'a', v)}
          />
        </div>
      )}

      {/* Inputs admin para placar dos 90 minutos — apenas em jogos encerrados */}
      {isAdmin && isCompleted && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <span className="text-[10px] font-semibold text-amber-300/70">90&apos;</span>
          <AdminScoreInput
            value={adminInput?.h ?? ''}
            onChange={v => onAdminInput(match.id, 'h', v)}
          />
          <span className="text-xs text-white/40">×</span>
          <AdminScoreInput
            value={adminInput?.a ?? ''}
            onChange={v => onAdminInput(match.id, 'a', v)}
          />
          <button
            onClick={() => onSave90(match.id)}
            disabled={!canSave}
            title={isError ? 'Erro ao salvar — tente novamente' : undefined}
            className={`rounded px-2.5 py-1 text-[10px] font-bold transition ${
              isSaved
                ? 'bg-emerald-500 text-white'
                : isError
                  ? 'bg-rose-500 text-white'
                  : 'bg-ouro text-azul-dark hover:bg-ouro/80 disabled:cursor-not-allowed disabled:opacity-40'
            }`}
          >
            {isSaved ? '✓' : isError ? '!' : isSaving ? '…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
})

function ScoreInput({
  value, placeholder, onChange,
}: { value?: number; placeholder: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      min={0}
      max={99}
      value={value !== undefined ? value : ''}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-10 rounded bg-white/10 text-center text-sm text-white outline-none focus:ring-1 focus:ring-ouro/50"
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
      className="w-10 rounded border border-amber-500/30 bg-white/10 text-center text-sm text-white outline-none focus:border-amber-400/70 focus:ring-0"
    />
  )
}

// ── RankingTable ───────────────────────────────────────────────────────────────

function RankingTable({
  ranking,
}: {
  ranking: Array<{ id: string; apelido: string; pts: number; rank: number }>
}) {
  if (ranking.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-white/30">
        Nenhum participante encontrado.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/5 px-4 py-2">
        <p className="text-xs text-white/40">
          Pontos calculados com base nos placares aos 90 minutos.
          Jogos sem resultado cadastrado ou sem simulação são ignorados.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            <th className="w-10 px-3 py-2.5 text-left text-xs font-semibold text-white/40">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold text-white/40">Participante</th>
            <th className="px-3 py-2.5 text-right text-xs font-semibold text-white/40">Pts 90&apos;</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((r, i) => (
            <tr
              key={r.id}
              className={`border-b border-white/5 ${
                i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'
              }`}
            >
              <td className="px-3 py-2 font-mono text-xs text-white/40">{r.rank}</td>
              <td className="px-3 py-2 font-medium text-white/90">{r.apelido}</td>
              <td className="px-3 py-2 text-right font-bold text-ouro">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
