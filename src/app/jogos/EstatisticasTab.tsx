'use client'

import { useState, useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import type { Participant } from './JogosDashboard'

type GBet    = { participant_id: string; group_name: string; first_place: string; second_place: string }
type ThirdBt = { participant_id: string; group_name: string; team: string }
type TBet    = { participant_id: string; champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }
type MBet    = { participant_id: string; match_id: string; score_home: number; score_away: number }

export interface TeamInfo { name: string; abbr: string; group: string; flag: string }

interface Props {
  participants:    Participant[]
  teams:           TeamInfo[]
  groupBets:       GBet[]
  thirdBets:       ThirdBt[]
  tournamentBets:  TBet[]
  matchBets:       MBet[]
  zebraThreshold:  number
  scorerMapping:   Record<string, string>
  scorerFlagMap?:  Record<string, string>
}

export function EstatisticasTab({ participants, teams, groupBets, thirdBets, tournamentBets, matchBets, zebraThreshold, scorerMapping, scorerFlagMap = {} }: Props) {
  const groups = useMemo(
    () => [...new Set(teams.map(t => t.group))].filter(Boolean).sort(),
    [teams],
  )
  const [selGroup, setSelGroup] = useState<string | null>(null)

  // ── Sort: Seleções ────────────────────────────────────────────────────────
  type SelCol = 'group' | 'name' | 'first' | 'second' | 'third' | 'elim' |
                'champ' | 'vice' | 'third4' | 'fourth' | 'nemSemi'
  const [selSort, setSelSort] = useState<SelCol>('name')
  const [selDir,  setSelDir]  = useState<'asc' | 'desc'>('asc')

  const handleSelSort = (col: SelCol) => {
    if (selSort === col) setSelDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSelSort(col); setSelDir(col === 'name' || col === 'group' ? 'asc' : 'desc') }
  }

  // ── Sort: Placar favorito por participante ────────────────────────────────
  type PartCol = 'apelido' | 'topLabel' | 'topPct' | 'avgGoals' | 'draws' | 'zebras' | 'zebraGrp' | 'zebraG4'
  const [partSort, setPartSort] = useState<PartCol>('apelido')
  const [partDir,  setPartDir]  = useState<'asc' | 'desc'>('asc')

  const handlePartSort = (col: PartCol) => {
    if (partSort === col) setPartDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setPartSort(col); setPartDir(col === 'apelido' || col === 'topLabel' ? 'asc' : 'desc') }
  }

  const SortIcon = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) =>
    active
      ? <span className="ml-0.5">{dir === 'asc' ? '▲' : '▼'}</span>
      : <span className="ml-0.5 opacity-30">↕</span>

  const n      = participants.length
  const tBetsN = tournamentBets.length

  const allStats = useMemo(() => {
    return teams.map(team => {
      const gb  = groupBets.filter(b => b.group_name === team.group)
      const tb  = thirdBets.filter(b => b.group_name === team.group)
      const gbN = gb.length

      const first  = gb.filter(b => b.first_place  === team.name).length
      const second = gb.filter(b => b.second_place === team.name).length
      const third  = tb.filter(b => b.team         === team.name).length
      const elim   = n - first - second - third

      const champ  = tournamentBets.filter(b => b.champion  === team.name).length
      const vice   = tournamentBets.filter(b => b.runner_up === team.name).length
      const third4 = tournamentBets.filter(b => b.semi1     === team.name).length
      const fourth = tournamentBets.filter(b => b.semi2     === team.name).length
      const inG4   = tournamentBets.filter(b =>
        b.champion === team.name || b.runner_up === team.name ||
        b.semi1    === team.name || b.semi2     === team.name
      ).length
      const nemSemi = n - inG4

      const firstZ = first > 0 && gbN    > 0 && (first / gbN)    * 100 < zebraThreshold
      const g4Z    = inG4  > 0 && tBetsN > 0 && (inG4  / tBetsN) * 100 < zebraThreshold

      return { ...team, first, second, third, elim, champ, vice, third4, fourth, inG4, nemSemi, firstZ, g4Z }
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [teams, groupBets, thirdBets, tournamentBets, n, tBetsN, zebraThreshold])

  const rows = useMemo(() => {
    const base = selGroup ? allStats.filter(t => t.group === selGroup) : allStats
    return [...base].sort((a, b) => {
      let cmp = 0
      if      (selSort === 'group')   cmp = a.group.localeCompare(b.group)
      else if (selSort === 'name')    cmp = a.name.localeCompare(b.name, 'pt-BR')
      else if (selSort === 'first')   cmp = a.first   - b.first
      else if (selSort === 'second')  cmp = a.second  - b.second
      else if (selSort === 'third')   cmp = a.third   - b.third
      else if (selSort === 'elim')    cmp = a.elim    - b.elim
      else if (selSort === 'champ')   cmp = a.champ   - b.champ
      else if (selSort === 'vice')    cmp = a.vice    - b.vice
      else if (selSort === 'third4')  cmp = a.third4  - b.third4
      else if (selSort === 'fourth')  cmp = a.fourth  - b.fourth
      else if (selSort === 'nemSemi') cmp = a.nemSemi - b.nemSemi
      return selDir === 'asc' ? cmp : -cmp
    })
  }, [allStats, selGroup, selSort, selDir])

  const tot = rows.reduce((a, t) => ({
    first: a.first + t.first, second: a.second + t.second, third: a.third + t.third,
    elim:  a.elim  + t.elim,  champ:  a.champ  + t.champ,  vice:  a.vice  + t.vice,
    third4: a.third4 + t.third4, fourth: a.fourth + t.fourth, nemSemi: a.nemSemi + t.nemSemi,
  }), { first: 0, second: 0, third: 0, elim: 0, champ: 0, vice: 0, third4: 0, fourth: 0, nemSemi: 0 })

  const scoreFrequency = useMemo(() => {
    const total = matchBets.length
    if (total === 0) return []
    const counts = new Map<string, number>()
    for (const b of matchBets) {
      const hi = Math.max(b.score_home, b.score_away)
      const lo = Math.min(b.score_home, b.score_away)
      const key = `${hi}-${lo}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([key, count]) => {
        const [hi, lo] = key.split('-').map(Number)
        return { label: hi === lo ? `${hi} × ${hi}` : `${hi} × ${lo}`, count, pct: (count / total) * 100 }
      })
      .sort((a, b) => b.count - a.count)
  }, [matchBets])

  const artilharia = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of tournamentBets) {
      const raw = b.top_scorer
      if (!raw?.trim()) continue
      const std = scorerMapping[raw.toLowerCase().trim()] ?? raw.trim()
      m.set(std, (m.get(std) ?? 0) + 1)
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([name, count]) => ({ name, count, flag: scorerFlagMap[name.toLowerCase().trim()] ?? '' }))
  }, [tournamentBets, scorerMapping, scorerFlagMap])

  const participantBetStats = useMemo(() => {
    // Distribuição de resultados por partida (para detectar zebra de jogo)
    const matchDist = new Map<string, { H: number; D: number; A: number; total: number }>()
    for (const b of matchBets) {
      const res = b.score_home > b.score_away ? 'H' : b.score_home < b.score_away ? 'A' : 'D'
      const d   = matchDist.get(b.match_id) ?? { H: 0, D: 0, A: 0, total: 0 }
      d[res]++; d.total++
      matchDist.set(b.match_id, d)
    }

    // Distribuição de 1º lugar por grupo (para zebra de grupo)
    const grpFirstDist = new Map<string, Map<string, number>>()
    for (const b of groupBets) {
      if (!b.first_place) continue
      if (!grpFirstDist.has(b.group_name)) grpFirstDist.set(b.group_name, new Map())
      const m = grpFirstDist.get(b.group_name)!
      m.set(b.first_place, (m.get(b.first_place) ?? 0) + 1)
    }

    // Contagem de aparições de cada time em qualquer posição do G4 (para zebra G4)
    // Critério idêntico ao da tabela Seleções: inG4 / tBetsN < zebraThreshold
    const G4_FIELDS = ['champion', 'runner_up', 'semi1', 'semi2'] as const
    const g4TeamCount = new Map<string, number>()
    for (const b of tournamentBets) {
      for (const f of G4_FIELDS) {
        const team = b[f]; if (!team) continue
        g4TeamCount.set(team, (g4TeamCount.get(team) ?? 0) + 1)
      }
    }

    // Agrupa apostas de jogos por participante
    const betsByPid = new Map<string, MBet[]>()
    for (const b of matchBets) {
      const arr = betsByPid.get(b.participant_id) ?? []
      arr.push(b)
      betsByPid.set(b.participant_id, arr)
    }

    return participants.map(p => {
      const bets  = betsByPid.get(p.id) ?? []
      const total = bets.length

      let topLabel = '–'
      let topPct   = 0

      if (total > 0) {
        const counts = new Map<string, number>()
        for (const b of bets) {
          const hi  = Math.max(b.score_home, b.score_away)
          const lo  = Math.min(b.score_home, b.score_away)
          const key = `${hi}-${lo}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        const [topKey, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
        const [hi, lo] = topKey.split('-').map(Number)
        topLabel = hi === lo ? `${hi} × ${hi}` : `${hi} × ${lo}`
        topPct   = (topCount / total) * 100
      }

      const draws    = bets.filter(b => b.score_home === b.score_away).length
      const avgGoals = total > 0
        ? bets.reduce((s, b) => s + b.score_home + b.score_away, 0) / total
        : 0

      // Zebras de jogos
      let zebras = 0
      for (const b of bets) {
        const dist = matchDist.get(b.match_id)
        if (!dist || dist.total === 0) continue
        const res = b.score_home > b.score_away ? 'H' : b.score_home < b.score_away ? 'A' : 'D'
        if ((dist[res] / dist.total) * 100 <= zebraThreshold) zebras++
      }

      // Zebras de 1º lugar por grupo
      let zebraGrp = 0
      for (const b of groupBets.filter(g => g.participant_id === p.id)) {
        if (!b.first_place) continue
        const dist = grpFirstDist.get(b.group_name)
        if (!dist) continue
        const tot = [...dist.values()].reduce((s, v) => s + v, 0)
        if (tot > 0 && ((dist.get(b.first_place) ?? 0) / tot) * 100 <= zebraThreshold) zebraGrp++
      }

      // Zebras G4: times do participante que aparecem em < zebraThreshold% dos G4 totais
      let zebraG4 = 0
      const myTBet = tournamentBets.find(b => b.participant_id === p.id)
      if (myTBet && tBetsN > 0) {
        for (const f of G4_FIELDS) {
          const team = myTBet[f]; if (!team) continue
          const cnt = g4TeamCount.get(team) ?? 0
          if ((cnt / tBetsN) * 100 < zebraThreshold) zebraG4++
        }
      }

      return { apelido: p.apelido, total, topLabel, topPct, draws, zebras, zebraGrp, zebraG4, avgGoals }
    })
  }, [matchBets, groupBets, tournamentBets, participants, zebraThreshold])

  const sortedPartStats = useMemo(() => {
    return [...participantBetStats].sort((a, b) => {
      let cmp = 0
      if      (partSort === 'apelido')  cmp = a.apelido.localeCompare(b.apelido, 'pt-BR')
      else if (partSort === 'topLabel') cmp = a.topLabel.localeCompare(b.topLabel, 'pt-BR')
      else if (partSort === 'topPct')   cmp = a.topPct   - b.topPct
      else if (partSort === 'avgGoals') cmp = a.avgGoals - b.avgGoals
      else if (partSort === 'draws')    cmp = a.draws    - b.draws
      else if (partSort === 'zebras')   cmp = a.zebras   - b.zebras
      else if (partSort === 'zebraGrp') cmp = a.zebraGrp - b.zebraGrp
      else if (partSort === 'zebraG4')  cmp = a.zebraG4  - b.zebraG4
      return partDir === 'asc' ? cmp : -cmp
    })
  }, [participantBetStats, partSort, partDir])

  // Returns td className and inner element for a numeric cell
  function C(v: number, z = false, dim = false) {
    return {
      cls: z ? 'bg-black' : '',
      el:  v === 0
        ? <span className="text-gray-200">–</span>
        : <span className={`tabular-nums font-bold ${z ? 'text-white' : dim ? 'text-gray-500' : 'text-gray-700'}`}>{v}</span>,
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Seleções ────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 mr-auto">
            <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Seleções</h2>
            <span className="flex items-center gap-1 rounded px-1.5 py-0.5 bg-gray-100 text-[10px] text-gray-500">
              <span className="inline-block w-3 h-3 rounded-[2px] bg-black shrink-0" />
              Zebra potencial
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setSelGroup(null)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition ${!selGroup ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >Todos</button>
            {groups.map(g => (
              <button key={g}
                onClick={() => setSelGroup(g)}
                className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition ${selGroup === g ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >{g}</button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs whitespace-nowrap w-full">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                <th colSpan={2} className="border-b border-gray-100 py-1" />
                <th colSpan={4} className="border-b border-l border-gray-100 py-1 text-center px-1">Fase de Grupos</th>
                <th colSpan={5} className="border-b border-l border-gray-100 py-1 text-center px-1">Torneio</th>
              </tr>
              <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                {([
                  { col: 'group'  as SelCol, label: 'G',    cls: 'pl-3 pr-1 py-1.5 text-left',                          title: undefined },
                  { col: 'name'   as SelCol, label: 'Seleção',cls:'px-2 py-1.5 text-left',                               title: undefined },
                  { col: 'first'  as SelCol, label: '1º',   cls: 'px-2 py-1.5 text-center border-l border-gray-100',    title: '1º do grupo' },
                  { col: 'second' as SelCol, label: '2º',   cls: 'px-2 py-1.5 text-center',                             title: '2º do grupo' },
                  { col: 'third'  as SelCol, label: '3ºC',  cls: 'px-2 py-1.5 text-center',                             title: '3º do grupo (classif)' },
                  { col: 'elim'   as SelCol, label: 'Elim', cls: 'px-2 py-1.5 text-center',                             title: 'Eliminado na 1ª fase' },
                  { col: 'champ'  as SelCol, label: 'Cam',  cls: 'px-2 py-1.5 text-center border-l border-gray-100',    title: 'Campeão' },
                  { col: 'vice'   as SelCol, label: 'Vice', cls: 'px-2 py-1.5 text-center',                             title: 'Vice-campeão' },
                  { col: 'third4' as SelCol, label: '3º',   cls: 'px-2 py-1.5 text-center',                             title: 'Terceiro lugar' },
                  { col: 'fourth' as SelCol, label: '4º',   cls: 'px-2 py-1.5 text-center',                             title: 'Quarto lugar' },
                  { col: 'nemSemi'as SelCol, label: 'Nem',  cls: 'pr-3 pl-2 py-1.5 text-center',                        title: 'Não chegou às semifinais' },
                ] as { col: SelCol; label: string; cls: string; title?: string }[]).map(({ col, label, cls, title }) => (
                  <th key={col} className={`${cls} cursor-pointer select-none hover:bg-gray-100 transition-colors`} title={title}>
                    <button type="button" onClick={() => handleSelSort(col)} className="inline-flex items-center gap-0">
                      {label}<SortIcon active={selSort === col} dir={selDir} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(t => {
                const c1 = C(t.first,   t.firstZ)
                const c2 = C(t.second)
                const c3 = C(t.third)
                const ce = C(t.elim,    false, true)
                const cc = C(t.champ,   t.g4Z && t.champ  > 0)
                const cv = C(t.vice,    t.g4Z && t.vice   > 0)
                const ct = C(t.third4,  t.g4Z && t.third4 > 0)
                const cf = C(t.fourth,  t.g4Z && t.fourth > 0)
                const cn = C(t.nemSemi, false, true)
                return (
                  <tr key={t.name} className="hover:bg-gray-50/60">
                    <td className="pl-3 pr-1 py-1.5 font-bold text-gray-400">{t.group}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-[8rem]">
                        <Flag code={t.flag} size="sm" className="w-5 h-[14px] shrink-0 rounded-[1px]" />
                        <span className="font-medium text-gray-800 truncate max-w-[7.5rem]" title={t.name}>{t.name}</span>
                        <span className="text-[10px] text-gray-400 shrink-0">{t.abbr}</span>
                      </div>
                    </td>
                    <td className={`px-2 py-1.5 text-center border-l border-gray-100 ${c1.cls}`}>{c1.el}</td>
                    <td className={`px-2 py-1.5 text-center ${c2.cls}`}>{c2.el}</td>
                    <td className={`px-2 py-1.5 text-center ${c3.cls}`}>{c3.el}</td>
                    <td className={`px-2 py-1.5 text-center ${ce.cls}`}>{ce.el}</td>
                    <td className={`px-2 py-1.5 text-center border-l border-gray-100 ${cc.cls}`}>{cc.el}</td>
                    <td className={`px-2 py-1.5 text-center ${cv.cls}`}>{cv.el}</td>
                    <td className={`px-2 py-1.5 text-center ${ct.cls}`}>{ct.el}</td>
                    <td className={`px-2 py-1.5 text-center ${cf.cls}`}>{cf.el}</td>
                    <td className={`pr-3 pl-2 py-1.5 text-center ${cn.cls}`}>{cn.el}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 text-xs font-bold">
                <td colSpan={2} className="pl-3 py-2 text-[10px] uppercase text-gray-500">Total</td>
                <td className="px-2 py-2 text-center border-l border-gray-100 tabular-nums text-gray-700">{tot.first   || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.second  || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.third   || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-600">–</td>
                <td className="px-2 py-2 text-center border-l border-gray-100 tabular-nums text-gray-700">{tot.champ   || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.vice    || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.third4  || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.fourth  || '–'}</td>
                <td className="pr-3 pl-2 py-2 text-center tabular-nums text-gray-600">–</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Artilharia ──────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Artilharia</h2>
        </div>
        {artilharia.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-gray-400">Sem palpites de artilheiro registrados.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Artilheiro</th>
                <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Palpites</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {artilharia.map(a => (
                <tr key={a.name} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2 font-medium text-gray-800">
                    <div className="flex items-center gap-1.5">
                      {a.flag && <Flag code={a.flag} size="sm" className="w-5 h-[14px] shrink-0 rounded-[1px]" />}
                      {a.name}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums text-gray-700">{a.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                <td className="px-4 py-2 text-[10px] uppercase text-gray-500">Total</td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                  {artilharia.reduce((s, a) => s + a.count, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* ── Placares mais frequentes ────────────────────────────────── */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Placares mais frequentes</h2>
          <p className="mt-0.5 text-[10px] text-gray-400">2×1 e 1×2 contam como o mesmo placar · {matchBets.length.toLocaleString('pt-BR')} apostas no total</p>
        </div>
        {scoreFrequency.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-gray-400">Sem apostas de placar registradas.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Placar</th>
                <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-16">Apostas</th>
                <th className="text-right px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide w-20">%</th>
                <th className="px-4 py-2 w-32 hidden sm:table-cell" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {scoreFrequency.map(s => (
                <tr key={s.label} className="hover:bg-gray-50/60">
                  <td className="px-4 py-1.5 font-bold tabular-nums text-gray-800 tracking-wider">{s.label}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-gray-600">{s.count.toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-gray-700 whitespace-nowrap">{s.pct.toFixed(1) === '0.0' ? '< 0,1%' : `${s.pct.toFixed(1)}%`}</td>
                  <td className="px-4 py-1.5 hidden sm:table-cell">
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-azul-escuro/60"
                        style={{ width: `${Math.min(s.pct / scoreFrequency[0].pct * 100, 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Placar favorito por participante ────────────────────── */}
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 pt-3 pb-2 border-b border-gray-100">
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Placar favorito por participante</h2>
          <p className="mt-0.5 text-[10px] text-gray-400">1×0 e 0×1 contam como o mesmo placar</p>
        </div>
        {participantBetStats.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-gray-400">Sem apostas de placar registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <colgroup>
                <col className="w-auto min-w-[7rem]" />
                <col className="w-16" />
                <col className="w-12" />
                <col className="w-12" />
                <col className="w-12" />
                <col className="w-12" />
                <col className="w-12" />
                <col className="w-12" />
              </colgroup>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                  {([
                    { col: 'apelido'  as PartCol, label: 'Participante',      cls: 'text-left  px-4 py-1.5 whitespace-nowrap' },
                    { col: 'topLabel' as PartCol, label: 'Placar Favorito',   cls: 'text-center px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'topPct'   as PartCol, label: '% Placar',          cls: 'text-right px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'avgGoals' as PartCol, label: 'Média Gols',        cls: 'text-right px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'draws'    as PartCol, label: 'Empates',        cls: 'text-right px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'zebras'   as PartCol, label: 'Zebras Jogos',      cls: 'text-right px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'zebraGrp' as PartCol, label: 'Zebras 1º Grp',     cls: 'text-right px-2 py-1.5 whitespace-normal leading-tight' },
                    { col: 'zebraG4'  as PartCol, label: 'Zebras G4',         cls: 'text-right px-4 py-1.5 whitespace-normal leading-tight' },
                  ] as { col: PartCol; label: string; cls: string }[]).map(({ col, label, cls }) => (
                    <th key={col} className={`${cls} cursor-pointer select-none hover:bg-gray-100 transition-colors`}>
                      <button type="button" onClick={() => handlePartSort(col)} className="inline-flex items-center gap-0 w-full justify-inherit">
                        {label}<SortIcon active={partSort === col} dir={partDir} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedPartStats.map(s => (
                  <tr key={s.apelido} className="hover:bg-gray-50/60">
                    <td className="px-4 py-1.5 font-medium text-gray-800 whitespace-nowrap">{s.apelido}</td>
                    <td className="px-2 py-1.5 text-center font-bold tabular-nums text-gray-800 tracking-wider whitespace-nowrap">
                      {s.total === 0 ? <span className="text-gray-300">–</span> : s.topLabel}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-700 whitespace-nowrap">
                      {s.total === 0 ? <span className="text-gray-300">–</span> : `${s.topPct.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {s.total === 0 ? <span className="text-gray-300">–</span> : s.avgGoals.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {s.draws === 0 ? <span className="text-gray-300">–</span> : s.draws}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {s.zebras === 0 ? <span className="text-gray-300">–</span> : s.zebras}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {s.zebraGrp === 0 ? <span className="text-gray-300">–</span> : s.zebraGrp}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {s.zebraG4 === 0 ? <span className="text-gray-300">–</span> : s.zebraG4}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
