import { Flag } from '@/components/ui/Flag'
import type { CalcGroupStanding } from '@/lib/bracket/engine'

interface Props {
  standing: CalcGroupStanding
  advancingGroups: Set<string>  // grupos cujo 3º avança
}

const POS_COLORS = [
  'bg-verde-600 text-white',         // 1º
  'bg-azul-escuro text-white',       // 2º
  'bg-amber-400 text-amber-900',     // 3º (potencialmente avança)
  'bg-gray-200 text-gray-600',       // 4º
]

export function OfficialGroupCard({ standing, advancingGroups }: Props) {
  const thirdAdvances = advancingGroups.has(standing.group)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Cabeçalho */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ backgroundColor: '#002776' }}
      >
        <span className="text-sm font-black uppercase tracking-widest text-white">
          Grupo {standing.group}
        </span>
        {standing.tiedTeams.length > 0 && (
          <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white/80">
            empate pendente
          </span>
        )}
      </div>

      {/* Tabela */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-gray-400">
            <th className="w-6 px-2 py-1.5 text-center font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Seleção</th>
            <th className="w-7 px-1 py-1.5 text-center font-bold text-gray-600">Pts</th>
            <th className="w-6 px-1 py-1.5 text-center font-medium">J</th>
            <th className="w-6 px-1 py-1.5 text-center font-medium">V</th>
            <th className="w-6 px-1 py-1.5 text-center font-medium">E</th>
            <th className="w-6 px-1 py-1.5 text-center font-medium">D</th>
            <th className="w-8 px-1 py-1.5 text-center font-medium">SG</th>
          </tr>
        </thead>
        <tbody>
          {standing.teams.map((team, i) => {
            const isTied = standing.tiedTeams.includes(team.team)
            const posColor = POS_COLORS[i] ?? POS_COLORS[3]
            // 3º com avanço = amber badge especial
            const showAdvances = i === 2 && thirdAdvances

            return (
              <tr
                key={team.team}
                className={`border-t border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}
              >
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${posColor}`}>
                    {i + 1}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <Flag code={team.flag} size="sm" />
                    <span className={`font-medium ${i < 2 ? 'text-gray-900' : 'text-gray-600'}`}>
                      {team.team}
                    </span>
                    {isTied && (
                      <span className="text-[10px] text-orange-400 font-bold" title="Empate não resolvido">≈</span>
                    )}
                    {showAdvances && (
                      <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-700">
                        avança
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-1 py-1.5 text-center font-black text-gray-900">{team.pts}</td>
                <td className="px-1 py-1.5 text-center text-gray-500">{team.gp}</td>
                <td className="px-1 py-1.5 text-center text-gray-500">{team.w}</td>
                <td className="px-1 py-1.5 text-center text-gray-500">{team.d}</td>
                <td className="px-1 py-1.5 text-center text-gray-500">{team.l}</td>
                <td className={`px-1 py-1.5 text-center font-medium ${team.gd > 0 ? 'text-verde-600' : team.gd < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {team.gd > 0 ? `+${team.gd}` : team.gd}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
