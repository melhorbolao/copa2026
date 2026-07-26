'use client'

import { useState } from 'react'
import { RegulamentoContent } from './RegulamentoContent'
import { ScoringTable } from '../pontuacao/ScoringTable'
import type { ScoringRule } from '../pontuacao/ScoringTable'
import { ScoreSimulator } from '../pontuacao/ScoreSimulator'
import { GroupSimulator } from '../pontuacao/GroupSimulator'
import { ENTRY_FEE, PRIZE_DIST, brl } from '@/lib/prizes'

interface Props {
  regulamentoContent: string
  rules: ScoringRule[]
  isAdmin: boolean
  pagos: number
}

export function RegulamentoTabs({ regulamentoContent, rules, isAdmin, pagos }: Props) {
  const [activeTab, setActiveTab] = useState<'regulamento' | 'pontuacao' | 'premiacao'>('regulamento')

  const totalPrize = pagos * ENTRY_FEE

  return (
    <>
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {([
          { key: 'regulamento', label: '📋 Regulamento' },
          { key: 'pontuacao',   label: '⭐ Pontuação'   },
          { key: 'premiacao',   label: '🏆 Premiação'   },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold transition border-b-2 -mb-px whitespace-nowrap ${
              activeTab === t.key
                ? 'border-verde-600 text-verde-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'regulamento' && (
        <RegulamentoContent content={regulamentoContent} />
      )}

      {activeTab === 'pontuacao' && (
        <>
          <ScoringTable rules={rules} isAdmin={isAdmin} />
          <ScoreSimulator rules={rules} />
          <GroupSimulator rules={rules} />
        </>
      )}

      {activeTab === 'premiacao' && (
        <div className="max-w-lg">
          <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="px-4 py-3 text-gray-500">Valor por participante</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {brl(ENTRY_FEE)}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="px-4 py-3 text-gray-500">Participantes</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {pagos}
                  </td>
                </tr>
                <tr className="bg-verde-50">
                  <td className="px-4 py-3 font-bold text-verde-800">Premiação total</td>
                  <td className="px-4 py-3 text-right font-black text-verde-800 text-base tabular-nums">
                    {brl(totalPrize)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2.5 text-left">Colocação</th>
                  <th className="px-4 py-2.5 text-right">Prêmio</th>
                  <th className="px-4 py-2.5 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {PRIZE_DIST.map(({ place, pct }, i) => {
                  const amount = totalPrize * pct / 100
                  const top    = i === 0
                  return (
                    <tr
                      key={place}
                      className={`border-b border-gray-50 last:border-0 ${top ? 'bg-amarelo-50' : ''}`}
                    >
                      <td className={`px-4 py-2.5 ${top ? 'font-bold text-amarelo-800' : 'font-medium text-gray-700'}`}>
                        {place} colocado
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${top ? 'font-bold text-amarelo-800' : 'text-gray-700'}`}>
                        {brl(amount)}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${top ? 'font-bold text-amarelo-800' : 'text-gray-500'}`}>
                        {pct.toFixed(1).replace('.', ',')}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 tabular-nums">
                    {brl(totalPrize)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">
                    100,0%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
            <p>Não há critério de desempate.</p>
            <p>Se houver empate em posições premiadas, o prêmio é dividido igualmente.</p>
            <p>
              <span className="font-semibold">Ex:</span>{' '}
              2 participantes empatam em 1º lugar — soma-se o prêmio do 1º e do 2º e divide-se por 2.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
