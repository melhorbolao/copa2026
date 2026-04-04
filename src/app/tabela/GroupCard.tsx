'use client'

import { Flag } from '@/components/ui/Flag'
import type { CalcGroupStanding } from '@/lib/bracket/engine'

interface Props {
  standing: CalcGroupStanding
  advancingGroups: Set<string>  // grupos com 3º que avança
}

const POS_COLORS = [
  'bg-verde-600 text-white',     // 1º — classifica
  'bg-azul-escuro text-white',   // 2º — classifica
  'bg-amber-400 text-amber-900', // 3º — pode avançar (melhor terceiro)
  'bg-gray-200 text-gray-600',   // 4º — eliminado
]

const POS_TITLE = ['1º', '2º', '3º', '4º']

export function GroupCard({ standing, advancingGroups }: Props) {
  const third = standing.teams[2]
  const thirdAdvances = third && advancingGroups.has(standing.group)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      {/* Cabeçalho */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ backgroundColor: '#002776' }}
      >
        <span className="text-sm font-black uppercase tracking-widest text-white">
          Grupo {standing.group}
        </span>
      </div>

      {/* Tabela */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-gray-400">
            <th className="w-6 px-2 py-1.5 text-center font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Seleção</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">J</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">V</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">E</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">D</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GP</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GC</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">DG</th>
            <th className="w-8 px-2 py-1.5 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standing.teams.map((team, i) => {
            const isThirdAdvancing = i === 2 && thirdAdvances
            return (
              <tr
                key={team.team}
                className={`border-t border-gray-100 ${
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                }`}
              >
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${POS_COLORS[i]}`}
                    title={POS_TITLE[i]}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <Flag code={team.flag} size="sm" />
                    <span className={`font-medium ${i < 2 ? 'text-gray-900' : 'text-gray-600'}`}>
                      {team.team}
                    </span>
                    {isThirdAdvancing && (
                      <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                        3º ✓
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gp}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.w}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.d}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.l}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gf}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.ga}</td>
                <td className={`px-1 py-2 text-center font-medium ${team.gd > 0 ? 'text-verde-600' : team.gd < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  {team.gd > 0 ? `+${team.gd}` : team.gd}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`font-black ${i < 2 || isThirdAdvancing ? 'text-gray-900' : 'text-gray-500'}`}>
                    {team.pts}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Legenda de classificação */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50 px-3 py-2">
        <LegendItem color="bg-verde-600" label="Classificado (1º)" />
        <LegendItem color="bg-azul-escuro" label="Classificado (2º)" />
        {thirdAdvances && <LegendItem color="bg-amber-400" label="Melhor 3º" />}
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}
