'use client'

import { useState, useRef } from 'react'
import { Flag } from '@/components/ui/Flag'
import type { ScoringRule } from './ScoringTable'

interface Props {
  rules: ScoringRule[]
}

interface Team {
  name: string
  flag: string
}

// Grupo A da Copa 2026
const GROUP_A_TEAMS: Team[] = [
  { name: 'México',        flag: 'mx' },
  { name: 'África do Sul', flag: 'za' },
  { name: 'Coreia do Sul', flag: 'kr' },
  { name: 'Rep. Tcheca',   flag: 'cz' },
]

type GroupBreakdown = {
  top2Label: string   // descrição do acerto 1º/2º
  top2Pts: number
  thirdPts: number
  // zebra apenas para 1º colocado; não há zebra para 2º ou 3º
  zebraBonus1: number
  total: number
}

function calcGroupPoints(
  bet1st: string,
  bet2nd: string,
  betThirdAdvances: boolean,
  bet3rd: string,
  real: Team[],          // ordered [0]=1st … [3]=4th
  realThirdAdvances: boolean,
  isZebra1: boolean,
  ruleMap: Record<string, number>,
): GroupBreakdown {
  const real1st = real[0]?.name ?? ''
  const real2nd = real[1]?.name ?? ''
  const real3rd = real[2]?.name ?? ''

  let top2Label = ''
  let top2Pts   = 0

  const exactOrder = bet1st === real1st && bet2nd === real2nd
  const inverted   = bet1st === real2nd && bet2nd === real1st
  const only1st    = bet1st === real1st && bet2nd !== real2nd && bet2nd !== real1st
  const only2nd    = bet2nd === real2nd && bet1st !== real1st && bet1st !== real2nd
  const oneInTop2  =
    !exactOrder && !inverted &&
    (bet1st === real2nd || bet2nd === real1st) &&
    !(bet1st === real1st) && !(bet2nd === real2nd)

  // Registra se o 1º foi especificamente acertado (para aplicar zebra)
  const first1stCorrect = exactOrder || only1st

  if (exactOrder) {
    top2Pts   = ruleMap['grupo_ordem_certa'] ?? 16
    top2Label = 'Ordem certa (1º e 2º)'
  } else if (inverted) {
    top2Pts   = ruleMap['grupo_ordem_invertida'] ?? 10
    top2Label = 'Ordem invertida (1º e 2º trocados)'
  } else if (only1st) {
    top2Pts   = ruleMap['grupo_primeiro_certo'] ?? 8
    top2Label = 'Somente o 1º correto'
  } else if (only2nd) {
    top2Pts   = ruleMap['grupo_segundo_certo'] ?? 6
    top2Label = 'Somente o 2º correto'
  } else if (oneInTop2) {
    top2Pts   = ruleMap['grupo_um_dos_dois'] ?? 3
    top2Label = 'Um dos dois classificados (posição errada)'
  } else {
    top2Label = 'Nenhum classificado acertado'
  }

  // 3º classificado: só pontua se ambos os lados têm o flag ativo e o time bate
  const thirdPts =
    betThirdAdvances && realThirdAdvances && bet3rd === real3rd
      ? (ruleMap['terceiro_classificado'] ?? 3)
      : 0

  // Zebra somente para 1º colocado (itens 17.1 e 17.2 do regulamento)
  const zebraBonus1 = isZebra1 && first1stCorrect ? (ruleMap['bonus_zebra_grupo_1'] ?? 6) : 0

  return {
    top2Label,
    top2Pts,
    thirdPts,
    zebraBonus1,
    total: top2Pts + thirdPts + zebraBonus1,
  }
}

// ── Componente TeamSelect ─────────────────────────────────────

function TeamSelect({
  label,
  value,
  onChange,
  exclude = [],
}: {
  label: string
  value: string
  onChange: (v: string) => void
  exclude?: string[]
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-6 text-right text-[10px] font-bold uppercase tracking-widest text-gray-400 shrink-0">
        {label}
      </span>
      <div className="relative flex-1">
        {value && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">
            <Flag code={GROUP_A_TEAMS.find(t => t.name === value)?.flag ?? ''} size="sm" />
          </span>
        )}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`w-full rounded-lg border border-gray-200 py-1.5 pr-2 text-xs font-semibold text-gray-800 focus:border-azul-escuro focus:outline-none ${value ? 'pl-8' : 'pl-2'}`}
        >
          <option value="">— selecionar —</option>
          {GROUP_A_TEAMS.filter(t => !exclude.includes(t.name)).map(t => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ── Componente SortableList (drag & drop nativo) ──────────────

function SortableList({
  teams,
  onChange,
}: {
  teams: Team[]
  onChange: (teams: Team[]) => void
}) {
  const dragIdx = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const handleDragStart = (i: number) => { dragIdx.current = i }
  const handleDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    setDragOver(i)
  }
  const handleDrop = (i: number) => {
    const from = dragIdx.current
    if (from === null || from === i) { setDragOver(null); return }
    const next = [...teams]
    const [moved] = next.splice(from, 1)
    next.splice(i, 0, moved)
    onChange(next)
    dragIdx.current = null
    setDragOver(null)
  }
  const handleDragEnd = () => {
    dragIdx.current = null
    setDragOver(null)
  }

  const POSITION_LABELS = ['1º', '2º', '3º', '4º']

  return (
    <div className="space-y-1">
      {teams.map((team, i) => (
        <div
          key={team.name}
          draggable
          onDragStart={() => handleDragStart(i)}
          onDragOver={e  => handleDragOver(e, i)}
          onDrop={() => handleDrop(i)}
          onDragEnd={handleDragEnd}
          className={`flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 select-none transition active:cursor-grabbing ${
            dragOver === i
              ? 'border-azul-escuro bg-blue-50'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
        >
          <span className="w-5 text-[10px] font-bold text-gray-400">{POSITION_LABELS[i]}</span>
          <Flag code={team.flag} size="sm" />
          <span className="flex-1 text-xs font-semibold text-gray-800">{team.name}</span>
          <span className="text-gray-300">⠿</span>
        </div>
      ))}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────

export function GroupSimulator({ rules }: Props) {
  const ruleMap = Object.fromEntries(rules.map(r => [r.key, r.points]))

  // Palpite
  const [bet1st,            setBet1st]            = useState('México')
  const [bet2nd,            setBet2nd]            = useState('África do Sul')
  const [betThirdAdvances,  setBetThirdAdvances]  = useState(false)
  const [bet3rd,            setBet3rd]            = useState('')

  // Resultado
  const [realOrder,         setRealOrder]         = useState<Team[]>([...GROUP_A_TEAMS])
  const [realThirdAdvances, setRealThirdAdvances] = useState(false)

  // Zebra apenas para 1º colocado
  const [isZebra1, setIsZebra1] = useState(false)

  const result = calcGroupPoints(
    bet1st, bet2nd, betThirdAdvances, bet3rd,
    realOrder, realThirdAdvances,
    isZebra1,
    ruleMap,
  )

  const totalColor =
    result.total === 0       ? 'text-gray-400'
    : result.zebraBonus1 > 0 ? 'text-amber-700'
    : 'text-azul-escuro'

  const hasPts = result.total > 0

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
        <span>🏅</span>
        <h2 className="text-sm font-black uppercase tracking-widest text-white">
          Simulador de Pontuação — Classificados do Grupo
        </h2>
      </div>

      <div className="p-4 space-y-5">
        {/* Cabeçalho do grupo */}
        <div className="flex items-center justify-center gap-2">
          {GROUP_A_TEAMS.map(t => (
            <div key={t.name} className="flex items-center gap-1">
              <Flag code={t.flag} name={t.name} size="sm" />
            </div>
          ))}
          <span className="ml-1 text-xs font-bold text-gray-500">Grupo A</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* ── Palpite ── */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Seu palpite
            </p>

            <TeamSelect
              label="1º"
              value={bet1st}
              onChange={setBet1st}
              exclude={[bet2nd, bet3rd]}
            />
            <TeamSelect
              label="2º"
              value={bet2nd}
              onChange={setBet2nd}
              exclude={[bet1st, bet3rd]}
            />

            {/* Toggle 3º */}
            <button
              onClick={() => { setBetThirdAdvances(v => !v); if (betThirdAdvances) setBet3rd('') }}
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                betThirdAdvances
                  ? 'border-azul-escuro/30 bg-blue-50 text-azul-escuro'
                  : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
              }`}
            >
              <span>{betThirdAdvances ? '✓' : '○'}</span>
              <span>3º lugar classificado?</span>
            </button>

            {betThirdAdvances && (
              <TeamSelect
                label="3º"
                value={bet3rd}
                onChange={setBet3rd}
                exclude={[bet1st, bet2nd]}
              />
            )}
          </div>

          {/* ── Resultado ── */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-2">
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Resultado do grupo
            </p>

            <SortableList teams={realOrder} onChange={setRealOrder} />

            {/* Toggle 3º */}
            <button
              onClick={() => setRealThirdAdvances(v => !v)}
              className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                realThirdAdvances
                  ? 'border-azul-escuro/30 bg-blue-50 text-azul-escuro'
                  : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
              }`}
            >
              <span>{realThirdAdvances ? '✓' : '○'}</span>
              <span>3º lugar classificado?</span>
            </button>
          </div>
        </div>

        {/* Zebra toggle — apenas para 1º colocado */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setIsZebra1(v => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isZebra1
                ? 'border-amber-300 bg-amber-100 text-amber-800'
                : 'border-gray-200 bg-white text-gray-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
            }`}
          >
            <span>🦓</span>
            <span>Zebra 1º do grupo</span>
          </button>
        </div>

        {/* Resultado */}
        <div className={`rounded-xl border p-4 ${hasPts ? 'border-azul-escuro/20 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-700">
                {result.top2Label || '—'}
              </p>
              {result.top2Pts > 0 && result.thirdPts === 0 && result.zebraBonus1 === 0 && (
                <p className="text-xs text-gray-500">{result.top2Pts} pts</p>
              )}
              {result.thirdPts > 0 && (
                <p className="text-xs text-gray-600">+ {result.thirdPts} pts (3º classificado)</p>
              )}
              {result.zebraBonus1 > 0 && (
                <p className="text-xs text-amber-700">🦓 +{result.zebraBonus1} pts zebra (1º)</p>
              )}
              {result.total === 0 && (
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

          {/* Breakdown detalhado quando há múltiplas parcelas */}
          {hasPts && (result.thirdPts > 0 || result.zebraBonus1 > 0) && (
            <div className="mt-3 border-t border-gray-200 pt-3 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-gray-500">
              {result.top2Pts > 0 && <span>{result.top2Pts} pts</span>}
              {result.thirdPts > 0  && <><span>+</span><span>{result.thirdPts} pts (3º)</span></>}
              {result.zebraBonus1 > 0 && <><span>+</span><span className="text-amber-700">{result.zebraBonus1} (zebra 1º)</span></>}
              <span>=</span>
              <span className={`font-black ${totalColor}`}>{result.total} pts</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
