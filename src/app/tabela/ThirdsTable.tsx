import { Flag } from '@/components/ui/Flag'
import type { ThirdTeam } from '@/lib/bracket/engine'

interface Props {
  thirds: ThirdTeam[]
}

export function ThirdsTable({ thirds }: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ backgroundColor: '#002776' }}
      >
        <span className="text-sm font-black uppercase tracking-widest text-white">
          🏅 Melhores Terceiros Colocados
        </span>
        <span className="ml-auto text-[11px] font-medium text-white/60">
          Art. 13 FIFA · 8 de 12 avançam
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-gray-400">
            <th className="w-8 px-3 py-2 text-center font-medium">#</th>
            <th className="w-12 px-2 py-2 text-center font-medium">Grp</th>
            <th className="px-2 py-2 text-left font-medium">Seleção</th>
            <th className="w-8 px-2 py-2 text-center font-medium">Pts</th>
            <th className="w-7 px-1 py-2 text-center font-medium">J</th>
            <th className="w-7 px-1 py-2 text-center font-medium">V</th>
            <th className="w-7 px-1 py-2 text-center font-medium">E</th>
            <th className="w-7 px-1 py-2 text-center font-medium">D</th>
            <th className="w-7 px-1 py-2 text-center font-medium">GP</th>
            <th className="w-7 px-1 py-2 text-center font-medium">GC</th>
            <th className="w-7 px-1 py-2 text-center font-medium">SG</th>
          </tr>
        </thead>
        <tbody>
          {thirds.map((t, i) => (
            <tr
              key={t.group}
              className={`border-t border-gray-100 ${
                t.advances
                  ? i % 2 === 0 ? 'bg-amber-50' : 'bg-amber-50/60'
                  : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
              }`}
            >
              <td className="px-3 py-2 text-center">
                {t.advances ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-black text-amber-900">
                    {t.rank}
                  </span>
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500">
                    {t.rank}
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-center font-semibold text-gray-500">
                {t.group}
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <Flag code={t.flag} size="sm" />
                  <span className={`font-medium ${t.advances ? 'text-gray-900' : 'text-gray-400'}`}>
                    {t.team}
                  </span>
                  {t.advances && (
                    <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                      avança
                    </span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2 text-center">
                <span className={`font-black ${t.advances ? 'text-gray-900' : 'text-gray-400'}`}>
                  {t.pts}
                </span>
              </td>
              <td className="px-1 py-2 text-center text-gray-500">{t.gp}</td>
              <td className="px-1 py-2 text-center text-gray-500">{t.w}</td>
              <td className="px-1 py-2 text-center text-gray-500">{t.d}</td>
              <td className="px-1 py-2 text-center text-gray-500">{t.l}</td>
              <td className="px-1 py-2 text-center text-gray-500">{t.gf}</td>
              <td className="px-1 py-2 text-center text-gray-500">{t.ga}</td>
              <td className={`px-1 py-2 text-center font-medium ${t.gd > 0 ? 'text-verde-600' : t.gd < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                {t.gd > 0 ? `+${t.gd}` : t.gd}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Nota */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-[11px] text-gray-400">
          Critérios de desempate: Pts → DG → GP → Vitórias → Alfabético.
          Conduta (cartões) e Ranking FIFA não são simulados nos palpites.
        </p>
      </div>
    </div>
  )
}
