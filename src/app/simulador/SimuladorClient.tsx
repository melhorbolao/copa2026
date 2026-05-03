'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import { scoreMatchBet, detectMatchZebra, getMatchResult } from '@/lib/scoring/engine'
import { Flag } from '@/components/ui/Flag'
import type { RuleMap } from '@/lib/scoring/engine'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Match {
  id: string
  match_number: number
  phase: string
  round: number | null
  group_name: string | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
  is_brazil: boolean
  match_datetime: string
  betting_deadline: string
  city: string
}

interface Participant { id: string; apelido: string }

interface Bet {
  participant_id: string
  match_id: string
  score_home: number
  score_away: number
}

interface SimScore { score_home: number | null; score_away: number | null }

interface Props {
  userId: string
  isAdmin: boolean
  activeParticipantId: string | null
  participants: Participant[]
  visibleMatches: Match[]
  allBets: Bet[]
  rules: RuleMap
  teamAbbrs: Record<string, string>
  storedTotals: Record<string, number>
  existingSimulations: { match_id: string; score_home: number | null; score_away: number | null }[]
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PHASE_ORDER = ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final']

const PHASE_LABELS: Record<string, string> = {
  group:        'Fase de Grupos',
  round_of_32:  'Rodada de 32',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar',
  final:        'Final',
}

type SortCol = 'apelido' | 'ptsOfficial' | 'ptsSim' | 'ptsTotal'

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

// ── Component ──────────────────────────────────────────────────────────────────

export function SimuladorClient({
  userId, isAdmin, activeParticipantId,
  participants, visibleMatches, allBets, rules,
  teamAbbrs, storedTotals, existingSimulations,
}: Props) {
  const [simMap, setSimMap] = useState<Map<string, SimScore>>(() => {
    const m = new Map<string, SimScore>()
    for (const s of existingSimulations) {
      if (s.score_home !== null && s.score_away !== null)
        m.set(s.match_id, { score_home: s.score_home, score_away: s.score_away })
    }
    return m
  })
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sortCol, setSortCol]       = useState<SortCol>('ptsTotal')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const supabase   = useRef(createClient())

  // ── Editable rule ─────────────────────────────────────────────────────────────
  // Match with official score → never editable (simulation not applicable)
  // Within 4h of match start → editable by all
  // After 4h without official → admin only
  const isEditable = useCallback((m: Match) => {
    if (m.score_home !== null && m.score_away !== null) return false
    if (isAdmin) return true
    return Date.now() - new Date(m.match_datetime).getTime() <= FOUR_HOURS_MS
  }, [isAdmin])

  // ── Sim pts per participant ───────────────────────────────────────────────────
  const simPtsMap = useMemo<Record<string, number>>(() => {
    const result: Record<string, number> = {}
    for (const match of visibleMatches) {
      if (match.score_home !== null && match.score_away !== null) continue
      const sim = simMap.get(match.id)
      if (!sim || sim.score_home === null || sim.score_away === null) continue
      const betsForMatch = allBets.filter(b => b.match_id === match.id)
      const isZebra = detectMatchZebra(
        betsForMatch,
        getMatchResult(sim.score_home, sim.score_away),
        rules['percentual_zebra'] ?? 15,
      )
      for (const bet of betsForMatch) {
        const pts = scoreMatchBet(
          bet.score_home, bet.score_away,
          sim.score_home, sim.score_away,
          isZebra, match.is_brazil, rules,
        )
        result[bet.participant_id] = (result[bet.participant_id] ?? 0) + pts
      }
    }
    return result
  }, [simMap, visibleMatches, allBets, rules])

  // ── Ranking ───────────────────────────────────────────────────────────────────
  const ranking = useMemo(() => {
    const rows = participants.map(p => ({
      id:          p.id,
      apelido:     p.apelido,
      ptsOfficial: storedTotals[p.id] ?? 0,
      ptsSim:      simPtsMap[p.id]    ?? 0,
      ptsTotal:    (storedTotals[p.id] ?? 0) + (simPtsMap[p.id] ?? 0),
    }))

    // Rank is always fixed by ptsTotal desc (simulation position in the bolão)
    const byTotal = [...rows].sort((a, b) =>
      b.ptsTotal - a.ptsTotal || a.apelido.localeCompare(b.apelido, 'pt-BR')
    )
    const rankMap = new Map(byTotal.map((r, i) => [r.id, i + 1]))

    // Display order follows sortCol/sortDir independently
    const dir = sortDir === 'desc' ? -1 : 1
    rows.sort((a, b) => {
      if (sortCol === 'apelido') return dir * a.apelido.localeCompare(b.apelido, 'pt-BR')
      const diff = b[sortCol] - a[sortCol]
      if (diff !== 0) return dir * diff
      return a.apelido.localeCompare(b.apelido, 'pt-BR')
    })

    return rows.map(r => ({ ...r, rank: rankMap.get(r.id)! }))
  }, [participants, storedTotals, simPtsMap, sortCol, sortDir])

  // ── Persist ───────────────────────────────────────────────────────────────────
  async function persistSim(matchId: string, sim: SimScore | null) {
    setSaveStatus('saving')
    try {
      if (!sim || sim.score_home === null || sim.score_away === null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_simulations')
          .delete().eq('user_id', userId).eq('match_id', matchId)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_simulations').upsert(
          { user_id: userId, match_id: matchId, score_home: sim.score_home, score_away: sim.score_away, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,match_id' },
        )
      }
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  function debouncedSave(matchId: string, sim: SimScore | null) {
    const t = saveTimers.current.get(matchId)
    if (t) clearTimeout(t)
    saveTimers.current.set(matchId, setTimeout(() => {
      saveTimers.current.delete(matchId)
      persistSim(matchId, sim)
    }, 500))
  }

  // ── Set sim score ─────────────────────────────────────────────────────────────
  function setSimScore(matchId: string, sim: SimScore) {
    setSimMap(prev => {
      const next = new Map(prev)
      if (sim.score_home === null && sim.score_away === null) {
        next.delete(matchId)
      } else {
        next.set(matchId, sim)
      }
      return next
    })
    debouncedSave(matchId, sim)
  }

  // ── Gabaritar ─────────────────────────────────────────────────────────────────
  const handleGabaritar = useCallback(async () => {
    if (!activeParticipantId) return
    const myBets = allBets.filter(b => b.participant_id === activeParticipantId)
    const nonOfficialEditable = new Set(
      visibleMatches
        .filter(m => (m.score_home === null || m.score_away === null) && isEditable(m))
        .map(m => m.id)
    )
    const toSet: [string, SimScore][] = myBets
      .filter(b => nonOfficialEditable.has(b.match_id))
      .map(b => [b.match_id, { score_home: b.score_home, score_away: b.score_away }])

    if (toSet.length === 0) {
      toast('Nenhum palpite disponível para preencher.')
      return
    }
    setSimMap(prev => {
      const next = new Map(prev)
      for (const [id, score] of toSet) next.set(id, score)
      return next
    })
    setSaveStatus('saving')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.current as any).from('user_simulations').upsert(
        toSet.map(([match_id, s]) => ({
          user_id: userId, match_id,
          score_home: s.score_home, score_away: s.score_away,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'user_id,match_id' },
      )
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
      toast.success(`${toSet.length} palpite${toSet.length !== 1 ? 's' : ''} preenchido${toSet.length !== 1 ? 's' : ''}.`)
    } catch {
      setSaveStatus('error')
      toast.error('Erro ao salvar simulações.')
    }
  }, [activeParticipantId, allBets, visibleMatches, isEditable, userId])

  // ── Limpar ────────────────────────────────────────────────────────────────────
  const handleLimpar = useCallback(async () => {
    setSimMap(new Map())
    setSaveStatus('saving')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.current as any).from('user_simulations')
        .delete().eq('user_id', userId)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
      toast.success('Simulações apagadas.')
    } catch {
      setSaveStatus('error')
      toast.error('Erro ao apagar simulações.')
    }
  }, [userId])

  // ── Sort header ───────────────────────────────────────────────────────────────
  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortCol(col)
      setSortDir(col === 'apelido' ? 'asc' : 'desc')
    }
  }

  function sortArrow(col: SortCol) {
    if (col !== sortCol) return ''
    return sortDir === 'desc' ? ' ↓' : ' ↑'
  }

  // ── Grouped matches ───────────────────────────────────────────────────────────
  const matchPhases = useMemo(() => {
    const nonOfficial = visibleMatches.filter(m => m.score_home === null || m.score_away === null)
    const result: { phase: string; label: string; subLabel: string | null; matches: Match[] }[] = []
    for (const phase of PHASE_ORDER) {
      const pm = nonOfficial.filter(m => m.phase === phase)
      if (pm.length === 0) continue
      if (phase === 'group') {
        const groups = [...new Set(pm.map(m => m.group_name).filter(Boolean) as string[])].sort()
        for (const g of groups) {
          result.push({ phase, label: PHASE_LABELS[phase] ?? phase, subLabel: `Grupo ${g}`, matches: pm.filter(m => m.group_name === g) })
        }
      } else {
        result.push({ phase, label: PHASE_LABELS[phase] ?? phase, subLabel: null, matches: pm })
      }
    }
    return result
  }, [visibleMatches])

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()
  const simCount = [...simMap.values()].filter(s => s.score_home !== null && s.score_away !== null).length

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-bold text-gray-800">Meu Simulador MB</h1>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Projete cenários e veja o impacto no ranking. Os palpites reais não são alterados.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saveStatus === 'saving' && <span className="text-[11px] text-gray-400">Salvando…</span>}
          {saveStatus === 'saved'  && <span className="text-[11px] text-green-500">Salvo ✓</span>}
          {saveStatus === 'error'  && <span className="text-[11px] text-red-500">Erro ao salvar</span>}
          <button
            onClick={handleGabaritar}
            disabled={!activeParticipantId}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-40 transition"
            title="Preenche jogos sem resultado com seus palpites originais"
          >
            Gabaritar
          </button>
          <button
            onClick={handleLimpar}
            disabled={simCount === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* Classificação simulada */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center gap-2">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
            Classificação Simulada
          </h2>
          {simCount > 0 && (
            <span className="text-[11px] text-amber-500 font-semibold">
              {simCount} jogo{simCount !== 1 ? 's' : ''} simulado{simCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs w-full whitespace-nowrap">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th
                  onClick={() => handleSort('ptsTotal')}
                  className="pl-3 pr-2 py-2 text-left cursor-pointer select-none hover:text-gray-600"
                >
                  #{sortArrow('ptsTotal')}
                </th>
                <th
                  onClick={() => handleSort('apelido')}
                  className="px-2 py-2 text-left cursor-pointer select-none hover:text-gray-600"
                >
                  Participante{sortArrow('apelido')}
                </th>
                <th
                  onClick={() => handleSort('ptsOfficial')}
                  className="px-2 py-2 text-right cursor-pointer select-none hover:text-gray-600"
                >
                  PTS Oficial{sortArrow('ptsOfficial')}
                </th>
                <th
                  onClick={() => handleSort('ptsSim')}
                  className="px-2 py-2 text-right cursor-pointer select-none hover:text-amber-600 text-amber-500"
                >
                  + Simulação{sortArrow('ptsSim')}
                </th>
                <th
                  onClick={() => handleSort('ptsTotal')}
                  className="pr-3 pl-2 py-2 text-right cursor-pointer select-none hover:text-gray-600"
                >
                  = Total{sortArrow('ptsTotal')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ranking.map(row => (
                <tr
                  key={row.id}
                  className={`hover:bg-gray-50/60 ${row.id === activeParticipantId ? 'bg-amber-50/50' : ''}`}
                >
                  <td className="pl-3 pr-2 py-2 font-bold text-gray-400 tabular-nums">{row.rank}</td>
                  <td className="px-2 py-2 font-medium text-gray-800">{row.apelido}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{row.ptsOfficial}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-amber-600">
                    {row.ptsSim > 0
                      ? `+${row.ptsSim}`
                      : <span className="text-gray-300 font-normal">–</span>
                    }
                  </td>
                  <td className="pr-3 pl-2 py-2 text-right tabular-nums font-bold text-gray-800">{row.ptsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inputs de simulação */}
      {matchPhases.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 px-4 py-10 text-sm text-center text-gray-400">
          {isAdmin
            ? 'Todos os jogos visíveis já têm resultado oficial.'
            : 'Nenhum jogo disponível para simulação no momento.'
          }
        </div>
      ) : (
        matchPhases.map(({ phase, label, subLabel, matches }) => (
          <div
            key={`${phase}-${subLabel ?? ''}`}
            className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden"
          >
            {/* Section header */}
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
                {subLabel ? (
                  <><span className="text-gray-300">{label} · </span>{subLabel}</>
                ) : label}
              </h2>
            </div>

            {/* Match rows */}
            <div className="divide-y divide-gray-50">
              {matches.map(match => {
                const editable = isEditable(match)
                const sim = simMap.get(match.id) ?? { score_home: null, score_away: null }
                const hasSim = sim.score_home !== null && sim.score_away !== null
                const locked = !editable && !isAdmin

                return (
                  <div
                    key={match.id}
                    className={`px-4 py-3 flex items-center gap-3 transition-colors ${hasSim ? 'bg-amber-50/40' : ''}`}
                  >
                    {/* Match info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-0.5">
                        <span>#{match.match_number}</span>
                        <span className="text-gray-200">·</span>
                        <span>
                          {new Date(match.match_datetime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                        </span>
                        <span className="text-gray-200">·</span>
                        <span>
                          {new Date(match.match_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {match.is_brazil && <span className="text-green-500 font-bold">🇧🇷</span>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Flag code={match.flag_home} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
                        <span className="text-xs font-semibold text-gray-700">{abbr(match.team_home)}</span>
                        <span className="text-[10px] text-gray-300 px-0.5">×</span>
                        <span className="text-xs font-semibold text-gray-700">{abbr(match.team_away)}</span>
                        <Flag code={match.flag_away} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
                      </div>
                    </div>

                    {/* Score input or lock indicator */}
                    {editable ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <ScoreInput
                          value={sim.score_home}
                          onChange={v => setSimScore(match.id, { ...sim, score_home: v })}
                          label={`${abbr(match.team_home)} gols`}
                        />
                        <span className="text-[10px] text-gray-400 font-bold">×</span>
                        <ScoreInput
                          value={sim.score_away}
                          onChange={v => setSimScore(match.id, { ...sim, score_away: v })}
                          label={`${abbr(match.team_away)} gols`}
                        />
                        {hasSim && (
                          <button
                            onClick={() => setSimScore(match.id, { score_home: null, score_away: null })}
                            className="w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition text-[11px] leading-none ml-0.5"
                            title="Apagar simulação deste jogo"
                          >✕</button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 shrink-0">
                        {hasSim ? (
                          <span className="text-xs font-bold text-amber-600 tabular-nums">
                            {sim.score_home} × {sim.score_away}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-300">— × —</span>
                        )}
                        {locked && (
                          <span className="text-[10px] text-gray-300" title="Bloqueado após 4h do início">🔒</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

    </div>
  )
}

// ── ScoreInput ─────────────────────────────────────────────────────────────────

function ScoreInput({ value, onChange, label }: {
  value: number | null
  onChange: (v: number | null) => void
  label: string
}) {
  return (
    <input
      type="number"
      min={0}
      max={30}
      inputMode="numeric"
      aria-label={label}
      value={value ?? ''}
      onChange={e => {
        const raw = e.target.value
        if (raw === '') { onChange(null); return }
        const n = parseInt(raw, 10)
        if (!isNaN(n)) onChange(Math.max(0, Math.min(30, n)))
      }}
      className={[
        'w-9 h-9 text-center text-sm font-bold text-gray-800 rounded-xl',
        'border-2 border-amber-300 bg-amber-50',
        'focus:outline-none focus:border-amber-500 focus:bg-amber-100',
        'transition tabular-nums',
        '[appearance:textfield]',
        '[&::-webkit-inner-spin-button]:appearance-none',
        '[&::-webkit-outer-spin-button]:appearance-none',
      ].join(' ')}
    />
  )
}
