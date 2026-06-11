'use client'

import { useState } from 'react'
import { RegulamentoContent } from './RegulamentoContent'
import { ScoringTable } from '../pontuacao/ScoringTable'
import type { ScoringRule } from '../pontuacao/ScoringTable'
import { ScoreSimulator } from '../pontuacao/ScoreSimulator'
import { GroupSimulator } from '../pontuacao/GroupSimulator'

interface Props {
  regulamentoContent: string
  rules: ScoringRule[]
  isAdmin: boolean
}

export function RegulamentoTabs({ regulamentoContent, rules, isAdmin }: Props) {
  const [activeTab, setActiveTab] = useState<'regulamento' | 'pontuacao'>('regulamento')

  return (
    <>
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {([
          { key: 'regulamento', label: '📋 Regulamento' },
          { key: 'pontuacao',   label: '⭐ Pontuação'   },
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
    </>
  )
}
