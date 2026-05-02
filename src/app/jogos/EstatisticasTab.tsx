'use client'

import { useState, useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import type { Participant } from './JogosDashboard'

type GBet    = { participant_id: string; group_name: string; first_place: string; second_place: string }
type ThirdBt = { participant_id: string; group_name: string; team: string }
type TBet    = { participant_id: string; champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

export interface TeamInfo { name: string; abbr: string; group: string; flag: string }

interface Props {
  participants:    Participant[]
  teams:           TeamInfo[]
  groupBets:       GBet[]
  thirdBets:       ThirdBt[]
  tournamentBets:  TBet[]
  zebraThreshold:  number
}

export function EstatisticasTab({ participants, teams, groupBets, thirdBets, tournamentBets, zebraThreshold }: Props) {
  const groups = useMemo(
    () => [...new Set(teams.map(t => t.group))].filter(Boolean).sort(),
    [teams],
  )
  const [selGroup, setSelGroup] = useState<string | null>(null)

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
    }).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name, 'pt-BR'))
  }, [teams, groupBets, thirdBets, tournamentBets, n, tBetsN, zebraThreshold])

  const rows = selGroup ? allStats.filter(t => t.group === selGroup) : allStats

  const tot = rows.reduce((a, t) => ({
    first: a.first + t.first, second: a.second + t.second, third: a.third + t.third,
    elim:  a.elim  + t.elim,  champ:  a.champ  + t.champ,  vice:  a.vice  + t.vice,
    third4: a.third4 + t.third4, fourth: a.fourth + t.fourth, nemSemi: a.nemSemi + t.nemSemi,
  }), { first: 0, second: 0, third: 0, elim: 0, champ: 0, vice: 0, third4: 0, fourth: 0, nemSemi: 0 })

  const artilharia = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of tournamentBets) {
      const k = b.top_scorer?.trim()
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([name, count]) => ({ name, count }))
  }, [tournamentBets])

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
          <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mr-auto">Seleções</h2>
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
                <th className="pl-3 pr-1 py-1.5 text-left">G</th>
                <th className="px-2 py-1.5 text-left">Seleção</th>
                <th className="px-2 py-1.5 text-center border-l border-gray-100" title="1º do grupo">1º</th>
                <th className="px-2 py-1.5 text-center" title="2º do grupo">2º</th>
                <th className="px-2 py-1.5 text-center" title="3º do grupo (classif)">3ºC</th>
                <th className="px-2 py-1.5 text-center" title="Eliminado na 1ª fase">Elim</th>
                <th className="px-2 py-1.5 text-center border-l border-gray-100" title="Campeão">Cam</th>
                <th className="px-2 py-1.5 text-center" title="Vice-campeão">Vice</th>
                <th className="px-2 py-1.5 text-center" title="Terceiro lugar">3º</th>
                <th className="px-2 py-1.5 text-center" title="Quarto lugar">4º</th>
                <th className="pr-3 pl-2 py-1.5 text-center" title="Não chegou às semifinais">Nem</th>
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
                <td className="px-2 py-2 text-center tabular-nums text-gray-600">{tot.elim    || '–'}</td>
                <td className="px-2 py-2 text-center border-l border-gray-100 tabular-nums text-gray-700">{tot.champ   || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.vice    || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.third4  || '–'}</td>
                <td className="px-2 py-2 text-center tabular-nums text-gray-700">{tot.fourth  || '–'}</td>
                <td className="pr-3 pl-2 py-2 text-center tabular-nums text-gray-600">{tot.nemSemi || '–'}</td>
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
                  <td className="px-4 py-2 font-medium text-gray-800">{a.name}</td>
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

    </div>
  )
}
