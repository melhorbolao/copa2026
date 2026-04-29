'use client'

import type { CalcGroupStanding } from '@/lib/bracket/engine'

interface Props {
  group: string
  standings: CalcGroupStanding[]
  teamAbbrs: Record<string, string>
}

export function GroupStandings({ group, standings, teamAbbrs }: Props) {
  const gs = standings.find(s => s.group === group)
  if (!gs) return null

  const abbr = (t: string) => teamAbbrs[t] ?? t.slice(0, 3).toUpperCase()

  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-4 pt-3 pb-1">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Grupo {group} — Classificação ao vivo</h2>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide border-b border-gray-100">
            <th className="text-left px-3 py-1.5 w-6">#</th>
            <th className="text-left px-1 py-1.5">Seleção</th>
            <th className="text-center px-1 py-1.5 w-6">J</th>
            <th className="text-center px-1 py-1.5 w-6">V</th>
            <th className="text-center px-1 py-1.5 w-6">E</th>
            <th className="text-center px-1 py-1.5 w-6">D</th>
            <th className="text-center px-1 py-1.5 w-8">SG</th>
            <th className="text-center px-1 py-1.5 w-8">GF</th>
            <th className="text-center px-3 py-1.5 w-8 font-black text-gray-600">Pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {gs.teams.map((t, i) => {
            const qualified = i < 2
            const tied = gs.tiedTeams.includes(t.team)
            return (
              <tr key={t.team} className={`${qualified ? 'bg-blue-50/60' : ''}`}>
                <td className="px-3 py-1.5 text-gray-500 font-semibold">
                  {i + 1}{tied && <span className="text-amber-400 ml-0.5">*</span>}
                </td>
                <td className="px-1 py-1.5 font-semibold text-gray-800">{abbr(t.team)}</td>
                <td className="text-center px-1 py-1.5 text-gray-500">{t.gp}</td>
                <td className="text-center px-1 py-1.5 text-gray-500">{t.w}</td>
                <td className="text-center px-1 py-1.5 text-gray-500">{t.d}</td>
                <td className="text-center px-1 py-1.5 text-gray-500">{t.l}</td>
                <td className={`text-center px-1 py-1.5 tabular-nums font-semibold ${t.gd > 0 ? 'text-emerald-600' : t.gd < 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                  {t.gd > 0 ? `+${t.gd}` : t.gd}
                </td>
                <td className="text-center px-1 py-1.5 text-gray-500">{t.gf}</td>
                <td className="text-center px-3 py-1.5 font-black text-gray-800">{t.pts}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {gs.tiedTeams.length > 0 && (
        <p className="px-3 py-1.5 text-[10px] text-amber-600 border-t border-gray-100">
          * Empate técnico — classificação definitiva depende de critérios adicionais.
        </p>
      )}
    </div>
  )
}
