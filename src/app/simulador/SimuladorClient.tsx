'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import {
  scoreMatchBet, detectMatchZebra, getMatchResult,
  scoreGroupBet, scoreTournamentBet,
} from '@/lib/scoring/engine'
import type { RuleMap, TournamentResults } from '@/lib/scoring/engine'
import {
  calcGroupStandings, rankThirds, resolveThirdSlots,
} from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'
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

interface Props {
  userId: string
  isAdmin: boolean
  activeParticipantId: string | null
  participants: Participant[]
  visibleMatches: Match[]
  allMatches: Match[]
  allBets: Bet[]
  allGroupBets: GroupBet[]
  allThirdBets: ThirdBet[]
  allTournamentBets: TournamentBet[]
  rules: RuleMap
  teamAbbrs: Record<string, string>
  storedTotals: Record<string, number>
  existingSimulations: { match_id: string; score_home: number | null; score_away: number | null }[]
  bonusUnlocked: boolean
  officialScorers: string[]
  scorerMapping: Record<string, string>
}

type SortCol = 'apelido' | 'ptsOfficial' | 'ptsSim' | 'ptsTotal'

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

function knockoutWinnerOf(m: {
  team_home: string; team_away: string
  score_home: number | null; score_away: number | null
  penalty_winner: string | null
}): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  if (m.penalty_winner === 'H') return m.team_home
  if (m.penalty_winner === 'A') return m.team_away
  return null
}

function knockoutLoserOf(m: Parameters<typeof knockoutWinnerOf>[0]): string | null {
  const w = knockoutWinnerOf(m)
  if (!w) return null
  return w === m.team_home ? m.team_away : m.team_home
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SimuladorClient({
  userId, isAdmin, activeParticipantId,
  participants, visibleMatches, allMatches, allBets,
  allGroupBets, allThirdBets, allTournamentBets,
  rules, teamAbbrs, storedTotals, existingSimulations,
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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [sortCol, setSortCol]       = useState<SortCol>('ptsTotal')
  const [sortDir, setSortDir]       = useState<'asc' | 'desc'>('desc')

  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const supabase   = useRef(createClient())

  // ── Editable rule ─────────────────────────────────────────────────────────────
  const isEditable = useCallback((m: Match) => {
    if (m.score_home !== null && m.score_away !== null) return false
    if (isAdmin) return true
    return Date.now() - new Date(m.match_datetime).getTime() <= FOUR_HOURS_MS
  }, [isAdmin])

  // ── Effective score (sim or official) por jogo ────────────────────────────────
  const effectiveScore = useCallback((m: Match): { home: number; away: number } | null => {
    if (m.score_home !== null && m.score_away !== null) return { home: m.score_home, away: m.score_away }
    const sim = simMap.get(m.id)
    if (sim && sim.score_home !== null && sim.score_away !== null) return { home: sim.score_home, away: sim.score_away }
    return null
  }, [simMap])

  // ── Standings (oficial + sim) ─────────────────────────────────────────────────
  const groupMatchesAll = useMemo(() => allMatches.filter(m => m.phase === 'group'), [allMatches])

  const simStandings = useMemo(() => {
    const slim: MatchSlim[] = groupMatchesAll.map(m => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away,
      flag_home: m.flag_home, flag_away: m.flag_away,
    }))
    const betMap = new Map<string, BetSlim>()
    for (const m of groupMatchesAll) {
      const eff = effectiveScore(m)
      if (eff) betMap.set(m.id, { match_id: m.id, score_home: eff.home, score_away: eff.away })
    }
    return calcGroupStandings(slim, betMap)
  }, [groupMatchesAll, effectiveScore])

  const simThirds = useMemo(() => rankThirds(simStandings), [simStandings])
  const simThirdSlots = useMemo(() => resolveThirdSlots(simThirds), [simThirds])

  // Resultado do torneio simulado (knockouts)
  const simTournamentResults = useMemo<TournamentResults>(() => {
    const semifinalists: string[] = []
    for (const m of allMatches.filter(x => x.phase === 'quarterfinal')) {
      const eff = effectiveScore(m)
      if (eff) {
        const w = knockoutWinnerOf({ ...m, score_home: eff.home, score_away: eff.away })
        if (w) semifinalists.push(w)
      }
    }
    const finalists: string[] = []
    for (const m of allMatches.filter(x => x.phase === 'semifinal')) {
      const eff = effectiveScore(m)
      if (eff) {
        const w = knockoutWinnerOf({ ...m, score_home: eff.home, score_away: eff.away })
        if (w) finalists.push(w)
      }
    }
    let champion: string | null = null, runnerUp: string | null = null
    const finM = allMatches.find(x => x.phase === 'final')
    if (finM) {
      const eff = effectiveScore(finM)
      if (eff) {
        const sim = { ...finM, score_home: eff.home, score_away: eff.away }
        champion = knockoutWinnerOf(sim)
        runnerUp = knockoutLoserOf(sim)
      }
    }
    let third: string | null = null, fourth: string | null = null
    const tpM = allMatches.find(x => x.phase === 'third_place')
    if (tpM) {
      const eff = effectiveScore(tpM)
      if (eff) {
        const sim = { ...tpM, score_home: eff.home, score_away: eff.away }
        third  = knockoutWinnerOf(sim)
        fourth = knockoutLoserOf(sim)
      }
    }
    return { semifinalists, finalists, champion, runnerUp, third, fourth, officialScorers }
  }, [allMatches, effectiveScore, officialScorers])

  // ── Δ pts: simulação - oficial (apenas a contribuição que muda com sim) ──────
  // Pontos OFICIAIS já estão em storedTotals. Aqui calculamos os pontos SE
  // os jogos fossem decididos pelo simMap atual, depois subtraímos a parcela
  // oficial para isolar o "ganho" da simulação por participante.

  // pts oficiais por categoria (para subtrair depois)
  const officialMatchScoresMap = useMemo(() => {
    const m = new Map<string, BetSlim>()
    for (const x of groupMatchesAll) {
      if (x.score_home !== null && x.score_away !== null)
        m.set(x.id, { match_id: x.id, score_home: x.score_home, score_away: x.score_away })
    }
    return m
  }, [groupMatchesAll])

  const officialStandings = useMemo(() => {
    const slim: MatchSlim[] = groupMatchesAll.map(m => ({
      id: m.id, group_name: m.group_name, phase: m.phase,
      team_home: m.team_home, team_away: m.team_away,
      flag_home: m.flag_home, flag_away: m.flag_away,
    }))
    return calcGroupStandings(slim, officialMatchScoresMap)
  }, [groupMatchesAll, officialMatchScoresMap])

  const officialThirds = useMemo(() => rankThirds(officialStandings), [officialStandings])

  // pts ganhos com simulações (todas as categorias)
  const simPtsMap = useMemo<Record<string, number>>(() => {
    const result: Record<string, number> = {}
    const add = (pid: string, n: number) => { if (n) result[pid] = (result[pid] ?? 0) + n }

    // ── 1) Match bets ─────────────────────────────────────────
    const zebraThr = rules['percentual_zebra'] ?? 15
    for (const m of visibleMatches) {
      if (m.score_home !== null && m.score_away !== null) continue
      const sim = simMap.get(m.id)
      if (!sim || sim.score_home === null || sim.score_away === null) continue
      const betsForMatch = allBets.filter(b => b.match_id === m.id)
      const isZebra = detectMatchZebra(
        betsForMatch,
        getMatchResult(sim.score_home, sim.score_away),
        zebraThr,
      )
      for (const bet of betsForMatch) {
        const pts = scoreMatchBet(
          bet.score_home, bet.score_away,
          sim.score_home, sim.score_away,
          isZebra, m.is_brazil, rules,
        )
        add(bet.participant_id, pts)
      }
    }

    if (!bonusUnlocked) return result

    // ── 2) Group bets — Δ vs oficial ──────────────────────────
    const simFirst:  Record<string, string> = {}
    const simSecond: Record<string, string> = {}
    for (const s of simStandings) {
      simFirst[s.group]  = s.teams[0]?.team ?? ''
      simSecond[s.group] = s.teams[1]?.team ?? ''
    }
    const offFirst:  Record<string, string> = {}
    const offSecond: Record<string, string> = {}
    for (const s of officialStandings) {
      offFirst[s.group]  = s.teams[0]?.team ?? ''
      offSecond[s.group] = s.teams[1]?.team ?? ''
    }
    for (const gb of allGroupBets) {
      const sf = simFirst[gb.group_name],  ss = simSecond[gb.group_name]
      const of = offFirst[gb.group_name],  os = offSecond[gb.group_name]
      if (!sf || !ss) continue
      // Sem informação de zebra simulada (mantém false; coerente com preview)
      const simPts = scoreGroupBet(gb.first_place, gb.second_place, sf, ss, false, rules)
      const offPts = (of && os)
        ? scoreGroupBet(gb.first_place, gb.second_place, of, os, false, rules)
        : 0
      add(gb.participant_id, simPts - offPts)
    }

    // ── 3) Third-place qualifiers — Δ vs oficial ──────────────
    const thirdPts = rules['terceiro_classificado'] ?? 3
    const simAdvByGroup: Record<string, { team: string; advances: boolean }> = {}
    for (const t of simThirds) simAdvByGroup[t.group] = { team: t.team, advances: t.advances }
    const offAdvByGroup: Record<string, { team: string; advances: boolean }> = {}
    for (const t of officialThirds) offAdvByGroup[t.group] = { team: t.team, advances: t.advances }

    for (const tb of allThirdBets) {
      const sim = simAdvByGroup[tb.group_name]
      const off = offAdvByGroup[tb.group_name]
      const simHit = !!(sim && sim.advances && sim.team === tb.team)
      const offHit = !!(off && off.advances && off.team === tb.team)
      const simP = simHit ? thirdPts : 0
      const offP = offHit ? thirdPts : 0
      add(tb.participant_id, simP - offP)
    }

    // ── 4) Tournament bets (G4 + artilheiro) — Δ vs oficial ───
    // Resultado oficial = só com scores oficiais
    const officialTournament: TournamentResults = (() => {
      const semis: string[] = []
      for (const m of allMatches.filter(x => x.phase === 'quarterfinal' && x.score_home !== null && x.score_away !== null)) {
        const w = knockoutWinnerOf(m); if (w) semis.push(w)
      }
      const fins: string[] = []
      for (const m of allMatches.filter(x => x.phase === 'semifinal' && x.score_home !== null && x.score_away !== null)) {
        const w = knockoutWinnerOf(m); if (w) fins.push(w)
      }
      let champ: string | null = null, ru: string | null = null
      const fM = allMatches.find(x => x.phase === 'final' && x.score_home !== null && x.score_away !== null)
      if (fM) { champ = knockoutWinnerOf(fM); ru = knockoutLoserOf(fM) }
      let thd: string | null = null, fth: string | null = null
      const tM = allMatches.find(x => x.phase === 'third_place' && x.score_home !== null && x.score_away !== null)
      if (tM) { thd = knockoutWinnerOf(tM); fth = knockoutLoserOf(tM) }
      return { semifinalists: semis, finalists: fins, champion: champ, runnerUp: ru, third: thd, fourth: fth, officialScorers }
    })()

    for (const tb of allTournamentBets) {
      const bet = {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: tb.top_scorer ?? '',
      }
      const simP = scoreTournamentBet(bet, simTournamentResults, rules, false, scorerMapping)
      const offP = scoreTournamentBet(bet, officialTournament,    rules, false, scorerMapping)
      add(tb.participant_id, simP - offP)
    }

    return result
  }, [
    simMap, visibleMatches, allMatches, allBets, rules,
    bonusUnlocked, simStandings, officialStandings,
    simThirds, officialThirds, allGroupBets, allThirdBets,
    allTournamentBets, simTournamentResults, scorerMapping, officialScorers,
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

    const byTotal = [...rows].sort((a, b) =>
      b.ptsTotal - a.ptsTotal || a.apelido.localeCompare(b.apelido, 'pt-BR')
    )
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

  // ── Lista de jogos cronológica (sem subdivisão por grupo) ─────────────────────
  const chronologicalMatches = useMemo(() => {
    return visibleMatches
      .filter(m => m.score_home === null || m.score_away === null)
      .slice()
      .sort((a, b) => new Date(a.match_datetime).getTime() - new Date(b.match_datetime).getTime() || a.match_number - b.match_number)
  }, [visibleMatches])

  const abbr = (team: string) => teamAbbrs[team] ?? team.slice(0, 3).toUpperCase()
  const flagOf = (team: string): string => {
    for (const m of allMatches) {
      if (m.team_home === team) return m.flag_home
      if (m.team_away === team) return m.flag_away
    }
    return ''
  }
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
                <th onClick={() => handleSort('ptsTotal')}     className="pl-3 pr-2 py-2 text-left  cursor-pointer select-none hover:text-gray-600">#{sortArrow('ptsTotal')}</th>
                <th onClick={() => handleSort('apelido')}      className="px-2 py-2 text-left  cursor-pointer select-none hover:text-gray-600">Participante{sortArrow('apelido')}</th>
                <th onClick={() => handleSort('ptsOfficial')}  className="px-2 py-2 text-right cursor-pointer select-none hover:text-gray-600">PTS Oficial{sortArrow('ptsOfficial')}</th>
                <th onClick={() => handleSort('ptsSim')}       className="px-2 py-2 text-right cursor-pointer select-none hover:text-amber-600 text-amber-500">+ Simulação{sortArrow('ptsSim')}</th>
                <th onClick={() => handleSort('ptsTotal')}     className="pr-3 pl-2 py-2 text-right cursor-pointer select-none hover:text-gray-600">= Total{sortArrow('ptsTotal')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ranking.map(row => (
                <tr key={row.id} className={`hover:bg-gray-50/60 ${row.id === activeParticipantId ? 'bg-amber-50/50' : ''}`}>
                  <td className="pl-3 pr-2 py-2 font-bold text-gray-400 tabular-nums">{row.rank}</td>
                  <td className="px-2 py-2 font-medium text-gray-800">{row.apelido}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{row.ptsOfficial}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-bold text-amber-600">
                    {row.ptsSim !== 0
                      ? (row.ptsSim > 0 ? `+${row.ptsSim}` : `${row.ptsSim}`)
                      : <span className="text-gray-300 font-normal">–</span>}
                  </td>
                  <td className="pr-3 pl-2 py-2 text-right tabular-nums font-bold text-gray-800">{row.ptsTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resultado simulado: 1º/2º, thirds, G4 — só quando bonus deadline passou */}
      {bonusUnlocked && (
        <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-gray-100">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">
              Resultado Simulado
            </h2>
            <p className="text-[10px] text-gray-400 mt-0.5">
              Derivado dos placares simulados (jogos sem resultado oficial usam sua simulação).
            </p>
          </div>

          {/* Grupos: 1º e 2º */}
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">1º e 2º de cada grupo</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {simStandings.map(s => (
                <div key={s.group} className="rounded-lg border border-gray-100 px-2 py-1.5">
                  <div className="text-[10px] font-bold text-gray-400 mb-1">Grupo {s.group}</div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold text-gray-400 w-3">1º</span>
                    {s.teams[0] ? <>
                      <Flag code={s.teams[0].flag} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
                      <span className="font-semibold text-gray-700">{abbr(s.teams[0].team)}</span>
                    </> : <span className="text-gray-300">–</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 w-3">2º</span>
                    {s.teams[1] ? <>
                      <Flag code={s.teams[1].flag} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
                      <span className="font-semibold text-gray-700">{abbr(s.teams[1].team)}</span>
                    </> : <span className="text-gray-300">–</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 8 terceiros que se classificam */}
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">
              8 terceiros classificados {simThirdSlots ? '' : '(em construção)'}
            </h3>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {simThirds.filter(t => t.advances).map(t => (
                <div key={t.group} className="flex items-center gap-1.5 rounded-full border border-gray-100 px-2 py-0.5">
                  <span className="text-[10px] font-bold text-gray-400">{t.group}</span>
                  <Flag code={flagOf(t.team)} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
                  <span className="font-semibold text-gray-700">{abbr(t.team)}</span>
                </div>
              ))}
              {simThirds.filter(t => t.advances).length === 0 && (
                <span className="text-[11px] text-gray-300">Faltam jogos do grupo simulados.</span>
              )}
            </div>
          </div>

          {/* G4 + artilheiro */}
          <div className="px-4 py-3">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">G4 e artilheiro</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <SimG4Cell label="Campeão"   team={simTournamentResults.champion}  flag={flagOf(simTournamentResults.champion ?? '')}  abbr={abbr} />
              <SimG4Cell label="Vice"      team={simTournamentResults.runnerUp}  flag={flagOf(simTournamentResults.runnerUp ?? '')}  abbr={abbr} />
              <SimG4Cell label="3º"        team={simTournamentResults.third}     flag={flagOf(simTournamentResults.third ?? '')}     abbr={abbr} />
              <SimG4Cell label="4º"        team={simTournamentResults.fourth}    flag={flagOf(simTournamentResults.fourth ?? '')}    abbr={abbr} />
              <div className="rounded-lg border border-gray-100 px-2 py-1.5">
                <div className="text-[10px] font-bold text-gray-400">Artilheiro</div>
                <div className="font-semibold text-gray-700 truncate">
                  {officialScorers.length > 0 ? officialScorers.join(', ') : <span className="text-gray-300">–</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Inputs de simulação — lista cronológica plana */}
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
                        <span className="text-xs font-bold text-amber-600 tabular-nums">{sim.score_home} × {sim.score_away}</span>
                      ) : (
                        <span className="text-[10px] text-gray-300">— × —</span>
                      )}
                      {locked && <span className="text-[10px] text-gray-300" title="Bloqueado após 4h do início">🔒</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}

function SimG4Cell({ label, team, flag, abbr }: { label: string; team: string | null; flag: string; abbr: (t: string) => string }) {
  return (
    <div className="rounded-lg border border-gray-100 px-2 py-1.5">
      <div className="text-[10px] font-bold text-gray-400">{label}</div>
      {team ? (
        <div className="flex items-center gap-1.5 mt-0.5">
          <Flag code={flag} size="sm" className="w-4 h-[11px] shrink-0 rounded-[1px]" />
          <span className="font-semibold text-gray-700 truncate">{abbr(team)}</span>
        </div>
      ) : <span className="text-gray-300">–</span>}
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
