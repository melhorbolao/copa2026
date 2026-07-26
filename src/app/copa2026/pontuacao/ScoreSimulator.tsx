'use client'

import { useState } from 'react'
import { Flag } from '@/components/ui/Flag'
import type { ScoringRule } from './ScoringTable'

interface Props {
  rules: ScoringRule[]
}

type Breakdown = {
  label: string
  base: number
  zebraBonus: number
  total: number
}

function calcSimulator(
  betHome: number,
  betAway: number,
  realHome: number,
  realAway: number,
  isZebra: boolean,
  ruleMap: Record<string, number>,
): Breakdown {
  const betResult  = Math.sign(betHome  - betAway)
  const realResult = Math.sign(realHome - realAway)

  let base  = 0
  let label = ''

  if (betHome === realHome && betAway === realAway) {
    base  = ruleMap['placar_exato'] ?? 12
    label = 'Placar exato'
  } else if (betResult !== realResult) {
    base  = 0
    label = 'Resultado errado'
  } else if (betResult === 0) {
    // empate, gols diferentes
    base  = ruleMap['empate_gols_errados'] ?? 7
    label = 'Empate (gols diferentes)'
  } else {
    const winnerBet  = betResult  > 0 ? betHome  : betAway
    const winnerReal = realResult > 0 ? realHome  : realAway
    const loserBet   = betResult  > 0 ? betAway  : betHome
    const loserReal  = realResult > 0 ? realAway  : realHome

    if (winnerBet === winnerReal) {
      base  = ruleMap['vencedor_gols_vencedor'] ?? 6
      label = 'Vencedor + gols do vencedor'
    } else if ((betHome - betAway) === (realHome - realAway)) {
      base  = ruleMap['vencedor_diferenca_gols'] ?? 5
      label = 'Vencedor + diferença de gols'
    } else if (loserBet === loserReal) {
      base  = ruleMap['vencedor_gols_perdedor'] ?? 5
      label = 'Vencedor + gols do perdedor'
    } else {
      base  = ruleMap['somente_vencedor'] ?? 4
      label = 'Somente o vencedor'
    }
  }

  const zebraBonus = (isZebra && base > 0) ? (ruleMap['bonus_zebra_jogo'] ?? 6) : 0
  const total = base + zebraBonus

  return { label, base, zebraBonus, total }
}

function ScoreInput({
  value, onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="number"
      min={0}
      max={99}
      value={value}
      onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      className="w-12 rounded-lg border border-gray-200 py-1.5 text-center text-lg font-black text-gray-900 focus:border-azul-escuro focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}

export function ScoreSimulator({ rules }: Props) {
  const ruleMap = Object.fromEntries(rules.map(r => [r.key, r.points]))

  const [betHome,  setBetHome]  = useState(2)
  const [betAway,  setBetAway]  = useState(1)
  const [realHome, setRealHome] = useState(1)
  const [realAway, setRealAway] = useState(0)
  const [isZebra,  setIsZebra]  = useState(false)

  const result = calcSimulator(betHome, betAway, realHome, realAway, isZebra, ruleMap)

  const totalColor =
    result.total === 0 ? 'text-gray-400'
    : result.zebraBonus > 0 ? 'text-amber-700'
    : 'text-azul-escuro'

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
        <span>🧮</span>
        <h2 className="text-sm font-black uppercase tracking-widest text-white">
          Simulador de Pontuação — Jogos
        </h2>
      </div>

      <div className="p-4 space-y-5">
        {/* Nome do jogo */}
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-1.5">
            <Flag code="mx" name="México" size="md" />
            <span className="text-sm font-bold text-gray-700">México</span>
          </div>
          <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">vs</span>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-gray-700">África do Sul</span>
            <Flag code="za" name="África do Sul" size="md" />
          </div>
        </div>

        {/* Dois campos de placar */}
        <div className="grid grid-cols-2 gap-3">
          {/* Palpite */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Seu palpite
            </p>
            <div className="flex items-center justify-center gap-2">
              <ScoreInput value={betHome}  onChange={setBetHome} />
              <span className="text-lg font-black text-gray-300">×</span>
              <ScoreInput value={betAway}  onChange={setBetAway} />
            </div>
          </div>

          {/* Placar real */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
            <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Placar do jogo
            </p>
            <div className="flex items-center justify-center gap-2">
              <ScoreInput value={realHome} onChange={setRealHome} />
              <span className="text-lg font-black text-gray-300">×</span>
              <ScoreInput value={realAway} onChange={setRealAway} />
            </div>
          </div>
        </div>

        {/* Toggle zebra */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => setIsZebra(v => !v)}
            className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              isZebra
                ? 'border-amber-300 bg-amber-100 text-amber-800'
                : 'border-gray-200 bg-white text-gray-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
            }`}
          >
            <span className="text-base leading-none">🦓</span>
            <span>{isZebra ? 'Resultado zebra' : 'Resultado não é zebra'}</span>
          </button>
        </div>

        {/* Resultado */}
        <div className={`rounded-xl border p-4 ${result.total > 0 ? 'border-azul-escuro/20 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500">
                {result.label || '—'}
              </p>
              {result.zebraBonus > 0 && (
                <p className="text-xs text-amber-700">
                  🦓 +{result.zebraBonus} pts bônus zebra
                </p>
              )}
              {result.base === 0 && (
                <p className="text-xs text-gray-400">Nenhum ponto marcado</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className={`text-3xl font-black leading-none ${totalColor}`}>
                {result.total}
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">pontos</p>
            </div>
          </div>

          {/* Breakdown detalhado quando há ponto */}
          {result.base > 0 && result.zebraBonus > 0 && (
            <div className="mt-3 border-t border-gray-200 pt-3 flex items-center justify-end gap-3 text-xs text-gray-500">
              <span>{result.base} pts (base)</span>
              <span>+</span>
              <span className="text-amber-700">{result.zebraBonus} pts (zebra)</span>
              <span>=</span>
              <span className={`font-black ${totalColor}`}>{result.total} pts</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
