'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import {
  scoreMatchBet, detectMatchZebra, getMatchResult,
  scoreGroupBet, scoreTournamentBet,
} from '@/lib/scoring/engine'
import type { RuleMap, TournamentResults } from '@/lib/scoring/engine'
import { Flag } from '@/components/ui/Flag'

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

interface GroupBet {
  participant_id: string
  group_name: string
  first_place: string
  second_place: string
  points: number | null
}

interface ThirdBet {
  participant_id: string
  group_name: string
  team: string
}

interface TournamentBet {
  participant_id: string
  champion: string
  runner_up: string
  semi1: string
  semi2: string
  top_scorer: string
}

interface SimScore { score_home: number | null; score_away: number | null }

interface GroupSim       { group_name: string; first_place: string; second_place: string }
interface ThirdSim       { group_name: string; team: string; qualifies: boolean }
interface TournamentSim  { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

interface Props {
  userId: string
  isAdmin: boolean
  activeParticipantId: string | null
  participants: Participant[]
  visibleMatches: Match[]
  allBets: Bet[]
  allGroupBets: GroupBet[]
  allThirdBets: ThirdBet[]
  allTournamentBets: TournamentBet[]
  rules: RuleMap
  teamAbbrs: Record<string, string>
  teamsByGroup: Record<string, { name: string; flag: string }[]>
  storedTotals: Record<string, number>
  existingSimulations: { match_id: string; score_home: number | null; score_away: number | null }[]
  existingGroupSims: GroupSim[]
  existingThirdSims: ThirdSim[]
  existingTournamentSim: TournamentSim | null
  bonusUnlocked: boolean
  officialScorers: string[]
  scorerMapping: Record<string, string>
}

type SortCol = 'apelido' | 'ptsOfficial' | 'ptsSim' | 'ptsTotal'

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

// ── Component ──────────────────────────────────────────────────────────────────

export function SimuladorClient({
  userId, isAdmin, activeParticipantId,
  participants, visibleMatches, allBets,
  allGroupBets, allThirdBets, allTournamentBets,
  rules, teamAbbrs, teamsByGroup, storedTotals, existingSimulations,
  existingGroupSims, existingThirdSims, existingTournamentSim,
  bonusUnlocked, officialScorers, scorerMapping,
}: Props) {
  const [simMap, setSimMap] = useState<Map<string, SimScore>>(() => {
    const m = new Map<string, SimScore>()
    for (const s of existingSimulations) {
      if (s.score_home !== null && s.score_away !== null)
        m.set(s.match_id, { score_home: s.score_home, score_away: s.score_away })
    }
    return m
  })

  const [groupSim, setGroupSim] = useState<Record<string, { first_place: string; second_place: string }>>(() => {
    const r: Record<string, { first_place: string; second_place: string }> = {}
    for (const g of existingGroupSims) r[g.group_name] = { first_place: g.first_place, second_place: g.second_place }
    return r
  })

  const [thirdSim, setThirdSim] = useState<Record<string, { team: string; qualifies: boolean }>>(() => {
    const r: Record<string, { team: string; qualifies: boolean }> = {}
    for (const t of existingThirdSims) r[t.group_name] = { team: t.team, qualifies: t.qualifies }
    return r
  })

  const [tournamentSim, setTournamentSim] = useState<TournamentSim>(() => existingTournamentSim ?? {
    champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '',
  })

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sortCol, setSortCol]       = useState<SortCol>('ptsTotal')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const supabase   = useRef(createClient())

  const groupNames = useMemo(() => Object.keys(teamsByGroup).sort(), [teamsByGroup])
  const allTeams = useMemo(() => {
    const seen = new Set<string>()
    const out: { name: string; flag: string }[] = []
    for (const g of groupNames) for (const t of teamsByGroup[g]) {
      if (!seen.has(t.name)) { seen.add(t.name); out.push(t) }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [groupNames, teamsByGroup])
  const flagOf = useCallback((team: string): string => {
    const t = allTeams.find(x => x.name === team)
    return t?.flag ?? ''
  }, [allTeams])

  // ── Editable rule ─────────────────────────────────────────────────────────────
  const isEditable = useCallback((m: Match) => {
    if (m.score_home !== null && m.score_away !== null) return false
    if (isAdmin) return true
    return Date.now() - new Date(m.match_datetime).getTime() <= FOUR_HOURS_MS
  }, [isAdmin])

  // ── Sim pts: 4 categorias ─────────────────────────────────────────────────────
  const simPtsMap = useMemo<Record<string, number>>(() => {
    const result: Record<string, number> = {}
    const add = (pid: string, n: number) => { if (n) result[pid] = (result[pid] ?? 0) + n }

    // 1) Match bets
    const zebraThr = rules['percentual_zebra'] ?? 15
    for (const m of visibleMatches) {
      if (m.score_home !== null && m.score_away !== null) continue
      const sim = simMap.get(m.id)
      if (!sim || sim.score_home === null || sim.score_away === null) continue
      const betsForMatch = allBets.filter(b => b.match_id === m.id)
      const isZebra = detectMatchZebra(betsForMatch, getMatchResult(sim.score_home, sim.score_away), zebraThr)
      for (const bet of betsForMatch) {
        const pts = scoreMatchBet(bet.score_home, bet.score_away, sim.score_home, sim.score_away, isZebra, m.is_brazil, rules)
        add(bet.participant_id, pts)
      }
    }

    if (!bonusUnlocked) return result

    // 2) Group bets
    for (const gb of allGroupBets) {
      const sim = groupSim[gb.group_name]
      if (!sim || !sim.first_place || !sim.second_place || sim.first_place === sim.second_place) continue
      const offPts = gb.points ?? 0
      const simPts = scoreGroupBet(gb.first_place, gb.second_place, sim.first_place, sim.second_place, false, rules)
      add(gb.participant_id, simPts - offPts)
    }

    // 3) Third-place qualifiers
    const thirdPts = rules['terceiro_classificado'] ?? 3
    for (const tb of allThirdBets) {
      const sim = thirdSim[tb.group_name]
      const simHit = !!(sim && sim.qualifies && sim.team && sim.team === tb.team)
      add(tb.participant_id, simHit ? thirdPts : 0)
    }

    // 4) Tournament bets (G4 + artilheiro)
    const semis = [tournamentSim.champion, tournamentSim.runner_up, tournamentSim.semi1, tournamentSim.semi2].filter(Boolean) as string[]
    const fins  = [tournamentSim.champion, tournamentSim.runner_up].filter(Boolean) as string[]
    const simResults: TournamentResults = {
      semifinalists: semis,
      finalists:     fins,
      champion:      tournamentSim.champion || null,
      runnerUp:      tournamentSim.runner_up || null,
      third:         tournamentSim.semi1 || null,
      fourth:        tournamentSim.semi2 || null,
      officialScorers: tournamentSim.top_scorer ? [tournamentSim.top_scorer] : [],
    }
    for (const tb of allTournamentBets) {
      const bet = {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: tb.top_scorer ?? '',
      }
      add(tb.participant_id, scoreTournamentBet(bet, simResults, rules, false, scorerMapping))
    }

    return result
  }, [
    simMap, visibleMatches, allBets, rules, bonusUnlocked,
    groupSim, thirdSim, tournamentSim,
    allGroupBets, allThirdBets, allTournamentBets, scorerMapping,
  ])

  // ── Ranking ───────────────────────────────────────────────────────────────────
  const ranking = useMemo(() => {
    const rows = participants.map(p => ({
      id:          p.id,
      apelido:     p.apelido,
      ptsOfficial: storedTotals[p.id] ?? 0,
      ptsSim:      simPtsMap[p.id]    ?? 0,
      ptsTotal:    (storedTotals[p.id] ?? 0) + (simPtsMap[p.id] ?? 0),
    }))
    const byTotal = [...rows].sort((a, b) => b.ptsTotal - a.ptsTotal || a.apelido.localeCompare(b.apelido, 'pt-BR'))
    const rankMap = new Map(byTotal.map((r, i) => [r.id, i + 1]))
    const dir = sortDir === 'desc' ? -1 : 1
    rows.sort((a, b) => {
      if (sortCol === 'apelido') return dir * a.apelido.localeCompare(b.apelido, 'pt-BR')
      const diff = a[sortCol] - b[sortCol]
      if (diff !== 0) return dir * diff
      return a.apelido.localeCompare(b.apelido, 'pt-BR')
    })
    return rows.map(r => ({ ...r, rank: rankMap.get(r.id)! }))
  }, [participants, storedTotals, simPtsMap, sortCol, sortDir])

  // ── Persist helpers ──────────────────────────────────────────────────────────
  const flashStatus = useCallback((s: 'saved' | 'error') => {
    setSaveStatus(s)
    setTimeout(() => setSaveStatus(prev => prev === s ? 'idle' : prev), 2000)
  }, [])

  async function persistSim(matchId: string, sim: SimScore | null) {
    setSaveStatus('saving')
    try {
      if (!sim || sim.score_home === null || sim.score_away === null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_simulations').delete().eq('user_id', userId).eq('match_id', matchId)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_simulations').upsert(
          { user_id: userId, match_id: matchId, score_home: sim.score_home, score_away: sim.score_away, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,match_id' },
        )
      }
      flashStatus('saved')
    } catch { flashStatus('error') }
  }

  function debouncedSave(key: string, fn: () => Promise<void>) {
    const t = saveTimers.current.get(key)
    if (t) clearTimeout(t)
    saveTimers.current.set(key, setTimeout(async () => {
      saveTimers.current.delete(key)
      await fn()
    }, 500))
  }

  function setSimScore(matchId: string, sim: SimScore) {
    setSimMap(prev => {
      const next = new Map(prev)
      if (sim.score_home === null && sim.score_away === null) next.delete(matchId)
      else next.set(matchId, sim)
      return next
    })
    debouncedSave(`m:${matchId}`, () => persistSim(matchId, sim))
  }

  async function persistGroupSim(group: string, payload: { first_place: string; second_place: string }) {
    setSaveStatus('saving')
    try {
      if (!payload.first_place && !payload.second_place) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_group_simulations')
          .delete().eq('user_id', userId).eq('group_name', group)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_group_simulations').upsert(
          { user_id: userId, group_name: group, first_place: payload.first_place, second_place: payload.second_place, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,group_name' },
        )
      }
      flashStatus('saved')
    } catch { flashStatus('error') }
  }
  function setGroupSimField(group: string, field: 'first_place' | 'second_place', value: string) {
    setGroupSim(prev => {
      const cur = prev[group] ?? { first_place: '', second_place: '' }
      const next = { ...cur, [field]: value }
      const updated = { ...prev, [group]: next }
      debouncedSave(`g:${group}`, () => persistGroupSim(group, next))
      return updated
    })
  }

  const qualifiedThirdsCount = useMemo(
    () => Object.values(thirdSim).filter(t => t.qualifies && t.team).length,
    [thirdSim],
  )

  async function persistThirdSim(group: string, payload: { team: string; qualifies: boolean }) {
    setSaveStatus('saving')
    try {
      if (!payload.team) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_third_simulations')
          .delete().eq('user_id', userId).eq('group_name', group)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase.current as any).from('user_third_simulations').upsert(
          { user_id: userId, group_name: group, team: payload.team, qualifies: payload.qualifies, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,group_name' },
        )
      }
      flashStatus('saved')
    } catch { flashStatus('error') }
  }
  function setThirdSimField(group: string, field: 'team' | 'qualifies', value: string | boolean) {
    setThirdSim(prev => {
      const cur = prev[group] ?? { team: '', qualifies: true }
      const next = { ...cur, [field]: value as never }
      const updated = { ...prev, [group]: next }
      debouncedSave(`t:${group}`, () => persistThirdSim(group, next))
      return updated
    })
  }

  async function persistTournamentSim(payload: TournamentSim) {
    setSaveStatus('saving')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.current as any).from('user_tournament_simulations').upsert(
        { user_id: userId, ...payload, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      flashStatus('saved')
    } catch { flashStatus('error') }
  }
  function setTournamentSimField(field: keyof TournamentSim, value: string) {
    setTournamentSim(prev => {
      const next = { ...prev, [field]: value }
      debouncedSave('tournament', () => persistTournamentSim(next))
      return next
    })
  }

  // ── Gabaritar (apenas placares de jogos) ──────────────────────────────────────
  const handleGabaritar = useCallback(async () => {
    if (!activeParticipantId) return
    const myBets = allBets.filter(b => b.participant_id === activeParticipantId)
    const nonOfficialEditable = new Set(
      visibleMatches.filter(m => (m.score_home === null || m.score_away === null) && isEditable(m)).map(m => m.id)
    )
    const toSet: [string, SimScore][] = myBets.filter(b => nonOfficialEditable.has(b.match_id))
      .map(b => [b.match_id, { score_home: b.score_home, score_away: b.score_away }])
    if (toSet.length === 0) { toast('Nenhum palpite disponível para preencher.'); return }
    setSimMap(prev => {
      const next = new Map(prev)
      for (const [id, score] of toSet) next.set(id, score)
      return next
    })
    setSaveStatus('saving')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.current as any).from('user_simulations').upsert(
        toSet.map(([match_id, s]) => ({ user_id: userId, match_id, score_home: s.score_home, score_away: s.score_away, updated_at: new Date().toISOString() })),
        { onConflict: 'user_id,match_id' },
      )
      flashStatus('saved')
      toast.success(`${toSet.length} palpite${toSet.length !== 1 ? 's' : ''} preenchido${toSet.length !== 1 ? 's' : ''}.`)
    } catch { flashStatus('error'); toast.error('Erro ao salvar simulações.') }
  }, [activeParticipantId, allBets, visibleMatches, isEditable, userId, flashStatus])

  // ── Limpar (todas as simulações) ──────────────────────────────────────────────
  const handleLimpar = useCallback(async () => {
    setSimMap(new Map())
    setGroupSim({}); setThirdSim({})
    setTournamentSim({ champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '' })
    setSaveStatus('saving')
    try {
      const c = supabase.current
      await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).from('user_simulations').delete().eq('user_id', userId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).from('user_group_simulations').delete().eq('user_id', userId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).from('user_third_simulations').delete().eq('user_id', userId),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).from('user_tournament_simulations').delete().eq('user_id', userId),
      ])
      flashStatus('saved')
      toast.success('Simulações apagadas.')
    } catch { flashStatus('error'); toast.error('Erro ao apagar simulações.') }
  }, [userId, flashStatus])

  // ── Sort header ───────────────────────────────────────────────────────────────
  function handleSort(col: SortCol) {
    if (col === sortCol) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir(col === 'apelido' ? 'asc' : 'desc') }
  }
  function sortArrow(col: SortCol) { if (col !== sortCol) return ''; return sortDir === 'desc' ? ' ↓' : ' ↑' }

  // ── Lista de jogos cronológica plana ─────────────────────────────────────────
  const chronologicalMatches = useMemo(() => {
    return visibleMatches
      .filter(m => m.score_home === null || m.score_away === null)
      .slice()
      .sort((a, b) => new Date(a.match_datetime).getTime() - new Date(b.match_datetime).getTime() || a.match_number - b.match_number)
  }, [visibleMatches])

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()
  const simCount = [...simMap.values()].filter(s => s.score_home !== null && s.score_away !== null).length

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

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
          <button onClick={handleGabaritar} disabled={!activeParticipantId}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-40 transition"
            title="Preenche jogos sem resultado com seus palpites originais">
            Gabaritar
          </button>
          <button onClick={handleLimpar}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
            Limpar tudo
          </button>
        </div>
      </div>

      {/* Classificação simulada */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center gap-2">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Classificação Simulada</h2>
          {simCount > 0 && <span className="text-[11px] text-amber-500 font-semibold">{simCount} jogo{simCount !== 1 ? 's' : ''} simulado{simCount !== 1 ? 's' : ''}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs w-full whitespace-nowrap">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th onClick={() => handleSort('ptsTotal')}    className="pl-3 pr-2 py-2 text-left  cursor-pointer select-none hover:text-gray-600">#{sortArrow('ptsTotal')}</th>
                <th onClick={() => handleSort('apelido')}     className="px-2 py-2 text-left  cursor-pointer select-none hover:text-gray-600">Participante{sortArrow('apelido')}</th>
                <th onClick={() => handleSort('ptsOfficial')} className="px-2 py-2 text-right cursor-pointer select-none hover:text-gray-600">PTS Oficial{sortArrow('ptsOfficial')}</th>
                <th onClick={() => handleSort('ptsSim')}      className="px-2 py-2 text-right cursor-pointer select-none hover:text-amber-600 text-amber-500">+ Simulação{sortArrow('ptsSim')}</th>
                <th onClick={() => handleSort('ptsTotal')}    className="pr-3 pl-2 py-2 text-right cursor-pointer select-none hover:text-gray-600">= Total{sortArrow('ptsTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ranking.map(row => (
                <tr key={row.id} className={`hover:bg-gray-50/60 ${row.id === activeParticipantId ? 'bg-amber-50/50' : ''}`}>
                  <td className="pl-3 pr-2 py-2 font-bold text-gray-400 tabular-nums">{row.rank}</td>
                  <td className="px-2 py-2 font-medium text-gray-800">{row.apelido}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{row.ptsOfficial}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-amber-600">
                    {row.ptsSim !== 0 ? (row.ptsSim > 0 ? `+${row.ptsSim}` : `${row.ptsSim}`) : <span className="text-gray-300 font-normal">–</span>}
                  </td>
                  <td className="pr-3 pl-2 py-2 text-right tabular-nums font-bold text-gray-800">{row.ptsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bonus simulations: 1º/2º, thirds, G4 + artilheiro ────────────────── */}
      {bonusUnlocked && (
        <>
          {/* 1º e 2º de cada grupo */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Simular 1º e 2º de cada grupo</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">Os pontos de cada participante em group_bets são recalculados contra essas escolhas.</p>
            </div>
            <div className="divide-y divide-gray-50">
              {groupNames.map(g => {
                const cur = groupSim[g] ?? { first_place: '', second_place: '' }
                const opts = teamsByGroup[g] ?? []
                return (
                  <div key={g} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                    <span className="font-bold text-gray-400 w-14">Grupo {g}</span>
                    <TeamSelect label={`1º Grupo ${g}`} value={cur.first_place} options={opts}
                      excludeValue={cur.second_place}
                      onChange={v => setGroupSimField(g, 'first_place', v)} />
                    <TeamSelect label={`2º Grupo ${g}`} value={cur.second_place} options={opts}
                      excludeValue={cur.first_place}
                      onChange={v => setGroupSimField(g, 'second_place', v)} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* 8 terceiros que se classificam */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex items-center gap-2">
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Simular os 8 terceiros classificados</h2>
              <span className={`text-[10px] font-semibold ${qualifiedThirdsCount === 8 ? 'text-green-600' : 'text-amber-500'}`}>
                {qualifiedThirdsCount}/8 marcados
              </span>
            </div>
            <p className="px-4 pt-1 text-[10px] text-gray-400">Para cada grupo, escolha o 3º colocado. Marque "classifica" para os 8 que avançam (4 grupos ficam fora).</p>
            <div className="divide-y divide-gray-50">
              {groupNames.map(g => {
                const cur = thirdSim[g] ?? { team: '', qualifies: true }
                const opts = teamsByGroup[g] ?? []
                return (
                  <div key={g} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                    <span className="font-bold text-gray-400 w-14">Grupo {g}</span>
                    <TeamSelect label={`3º Grupo ${g}`} value={cur.team} options={opts}
                      onChange={v => setThirdSimField(g, 'team', v)} />
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={cur.qualifies}
                        onChange={e => setThirdSimField(g, 'qualifies', e.target.checked)}
                        className="h-3.5 w-3.5 accent-amber-500" />
                      <span className="text-[11px] text-gray-600">classifica</span>
                    </label>
                  </div>
                )
              })}
            </div>
          </div>

          {/* G4 + artilheiro */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Simular G4 e artilheiro</h2>
            </div>
            <div className="divide-y divide-gray-50 text-xs">
              <FieldRow label="Campeão">
                <TeamSelect label="Campeão" value={tournamentSim.champion} options={allTeams}
                  onChange={v => setTournamentSimField('champion', v)} />
              </FieldRow>
              <FieldRow label="Vice">
                <TeamSelect label="Vice" value={tournamentSim.runner_up} options={allTeams}
                  excludeValue={tournamentSim.champion}
                  onChange={v => setTournamentSimField('runner_up', v)} />
              </FieldRow>
              <FieldRow label="3º lugar">
                <TeamSelect label="3º lugar" value={tournamentSim.semi1} options={allTeams}
                  excludeValues={[tournamentSim.champion, tournamentSim.runner_up, tournamentSim.semi2]}
                  onChange={v => setTournamentSimField('semi1', v)} />
              </FieldRow>
              <FieldRow label="4º lugar">
                <TeamSelect label="4º lugar" value={tournamentSim.semi2} options={allTeams}
                  excludeValues={[tournamentSim.champion, tournamentSim.runner_up, tournamentSim.semi1]}
                  onChange={v => setTournamentSimField('semi2', v)} />
              </FieldRow>
              <FieldRow label="Artilheiro">
                <input type="text" value={tournamentSim.top_scorer}
                  onChange={e => setTournamentSimField('top_scorer', e.target.value)}
                  placeholder={officialScorers.length > 0 ? officialScorers.join(', ') : 'Nome do artilheiro'}
                  className="rounded border border-gray-200 px-2 py-1 text-xs w-60 focus:outline-none focus:border-amber-400" />
              </FieldRow>
            </div>
          </div>
        </>
      )}

      {/* Inputs de placar de jogo */}
      {chronologicalMatches.length === 0 ? (
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 px-4 py-10 text-sm text-center text-gray-400">
          Nenhum jogo disponível para simulação no momento.
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Jogos sem resultado oficial</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {chronologicalMatches.map(match => {
              const editable = isEditable(match)
              const sim = simMap.get(match.id) ?? { score_home: null, score_away: null }
              const hasSim = sim.score_home !== null && sim.score_away !== null
              const locked = !editable && !isAdmin
              return (
                <div key={match.id} className={`px-4 py-3 flex items-center gap-3 transition-colors ${hasSim ? 'bg-amber-50/40' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-0.5">
                      <span>#{match.match_number}</span>
                      <span className="text-gray-200">·</span>
                      <span>{new Date(match.match_datetime).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                      <span className="text-gray-200">·</span>
                      <span>{new Date(match.match_datetime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
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
                  {editable ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ScoreInput value={sim.score_home} onChange={v => setSimScore(match.id, { ...sim, score_home: v })} label={`${abbr(match.team_home)} gols`} />
                      <span className="text-[10px] text-gray-400 font-bold">×</span>
                      <ScoreInput value={sim.score_away} onChange={v => setSimScore(match.id, { ...sim, score_away: v })} label={`${abbr(match.team_away)} gols`} />
                      {hasSim && (
                        <button onClick={() => setSimScore(match.id, { score_home: null, score_away: null })}
                          className="w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition text-[11px] leading-none ml-0.5"
                          title="Apagar simulação deste jogo">✕</button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      {hasSim ? <span className="text-xs font-bold text-amber-600 tabular-nums">{sim.score_home} × {sim.score_away}</span> : <span className="text-[10px] text-gray-300">— × —</span>}
                      {locked && <span className="text-[10px] text-gray-300" title="Bloqueado após 4h do início">🔒</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hint no início se ainda não rolou nada */}
      {!bonusUnlocked && (
        <p className="text-center text-[11px] text-gray-400">
          Simulação de 1º/2º de grupos, 8 terceiros e G4 + artilheiro ficam disponíveis quando o prazo dos palpites bonus acabar.
        </p>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function TeamSelect({
  label, value, options, onChange, excludeValue, excludeValues,
}: {
  label: string
  value: string
  options: { name: string; flag: string }[]
  onChange: (v: string) => void
  excludeValue?: string
  excludeValues?: string[]
}) {
  const exclusions = new Set([
    ...(excludeValue ? [excludeValue] : []),
    ...(excludeValues ?? []),
  ].filter(Boolean))
  return (
    <select aria-label={label} value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded border border-gray-200 px-1.5 py-1 text-xs flex-1 min-w-0 focus:outline-none focus:border-amber-400">
      <option value="">—</option>
      {options.filter(o => !exclusions.has(o.name) || o.name === value).map(o => (
        <option key={o.name} value={o.name}>{o.name}</option>
      ))}
    </select>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 flex items-center gap-3">
      <span className="font-bold text-gray-400 w-20 shrink-0">{label}</span>
      {children}
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
