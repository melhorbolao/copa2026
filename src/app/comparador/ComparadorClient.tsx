'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { MatchInfo, FlatBet, ColPop } from './engine'
import {
  buildDuelMatrix, computeBreakdown, computeProjection, computeBadges,
  STATUS_LABEL,
} from './engine'
import { MatchMatrix } from './MatchMatrix'
import { ProjectionSection } from './ProjectionSection'
import { DiaDiaSection } from './DiaDiaSection'
import type { Snapshot } from './DiaDiaSection'

const DuelCard = dynamic(() => import('./DuelCard').then(m => ({ default: m.DuelCard })), { ssr: false })

// ── Types (mirrors page.tsx) ──────────────────────────────────────────────────

interface Participant { id: string; apelido: string }
interface Score { ptsMatches: number; ptsGroups: number; ptsThirds: number; ptsTournament: number; ptsTotal: number }
type GroupBet = { first: string; second: string; points: number | null }
type TBet = { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

interface Props {
  participants: Participant[]
  matches: MatchInfo[]
  betsByParticipant: Record<string, Record<string, FlatBet>>
  groupBetsByParticipant: Record<string, Record<string, GroupBet>>
  thirdBetsByParticipant: Record<string, Record<string, string>>
  tBetByParticipant: Record<string, TBet>
  scoresByParticipant: Record<string, Score>
  colPopMap: Record<string, ColPop>
  rulesMap: Record<string, number>
  zebraThreshold: number
  currentParticipantId: string
  snapshots: Snapshot[]
}

// ── Main component ────────────────────────────────────────────────────────────

export function ComparadorClient(props: Props) {
  const {
    participants, matches,
    betsByParticipant, groupBetsByParticipant, thirdBetsByParticipant, tBetByParticipant,
    scoresByParticipant, colPopMap, rulesMap, zebraThreshold, currentParticipantId, snapshots,
  } = props

  const [pidA, setPidA] = useState(currentParticipantId)
  const [pidB, setPidB] = useState('')
  const [activeTab, setActiveTab] = useState<'analise' | 'projecao' | 'matrix' | 'diaadia'>('analise')
  const [showCard, setShowCard] = useState(false)

  // ── Computed data ──────────────────────────────────────────────────────────
  const nameA = participants.find(p => p.id === pidA)?.apelido ?? 'Participante A'
  const nameB = participants.find(p => p.id === pidB)?.apelido ?? 'Participante B'
  const scoreA = scoresByParticipant[pidA]
  const scoreB = scoresByParticipant[pidB]

  const duelRows = useMemo(() => {
    if (!pidA || !pidB) return []
    const bA = betsByParticipant[pidA] ?? {}
    const bB = betsByParticipant[pidB] ?? {}
    return buildDuelMatrix(matches, bA, bB, colPopMap, zebraThreshold, rulesMap, false)
  }, [pidA, pidB, matches, betsByParticipant, colPopMap, zebraThreshold, rulesMap])

  const breakdown = useMemo(() =>
    computeBreakdown(duelRows, rulesMap), [duelRows, rulesMap])

  const projection = useMemo(() =>
    computeProjection(duelRows, rulesMap), [duelRows, rulesMap])

  const badges = useMemo(() =>
    computeBadges(breakdown), [breakdown])

  // Group bets comparison (for the bonus section)
  const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']
  const groupDuel = useMemo(() => {
    if (!pidA || !pidB) return []
    const gbA = groupBetsByParticipant[pidA] ?? {}
    const gbB = groupBetsByParticipant[pidB] ?? {}
    return GROUP_ORDER.map(g => ({
      group: g,
      betA: gbA[g] ?? null,
      betB: gbB[g] ?? null,
    })).filter(r => r.betA || r.betB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidA, pidB, groupBetsByParticipant])

  const tDuel = useMemo(() => {
    if (!pidA || !pidB) return null
    return {
      betA: tBetByParticipant[pidA] ?? null,
      betB: tBetByParticipant[pidB] ?? null,
    }
  }, [pidA, pidB, tBetByParticipant])

  // Total across all categories
  const totalA = scoreA?.ptsTotal ?? 0
  const totalB = scoreB?.ptsTotal ?? 0
  const delta  = totalA - totalB
  const hasData = !!pidA && !!pidB

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 pb-24">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-gray-900">⚔️ Comparador</h1>
        <p className="text-sm text-gray-500 mt-1">Análise profunda de duelo entre dois participantes</p>
      </div>

      {/* Participant selectors */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-6">
        <ParticipantPicker
          participants={participants}
          value={pidA}
          onChange={setPidA}
          exclude={pidB}
          label="Participante A"
          color="blue"
        />
        <ParticipantPicker
          participants={participants}
          value={pidB}
          onChange={setPidB}
          exclude={pidA}
          label="Participante B"
          color="red"
        />
      </div>

      {!hasData && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
          <p className="text-4xl mb-3">⚔️</p>
          <p className="font-bold text-gray-700">Selecione dois participantes para iniciar o duelo</p>
          <p className="mt-1 text-sm text-gray-400">
            O Participante A já está pré-selecionado com você.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* ── Scoreboard ──────────────────────────────────────────────────── */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="grid grid-cols-3 divide-x divide-gray-100">

              {/* Participant A */}
              <ScorePanel
                name={nameA}
                score={scoreA}
                color="blue"
                isLeading={delta > 0}
              />

              {/* VS / Delta */}
              <div className="flex flex-col items-center justify-center gap-2 py-5 px-3 bg-gray-50">
                <div className="text-xs font-black text-gray-400 tracking-[4px]">VS</div>
                <div className={`text-2xl font-black ${delta > 0 ? 'text-azul-escuro' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {delta > 0 ? `+${delta}` : delta < 0 ? delta : '='}
                </div>
                <div className="text-[10px] text-gray-400 text-center leading-tight">
                  {delta > 0 ? `${nameA.split(' ')[0]} está à frente` :
                   delta < 0 ? `${nameB.split(' ')[0]} está à frente` :
                   'Empate técnico!'}
                </div>
                {breakdown.battlefieldsPlayed > 0 && (
                  <div className="text-[10px] text-gray-400">
                    {breakdown.battlefieldsPlayed} batalhas jogadas
                  </div>
                )}
              </div>

              {/* Participant B */}
              <ScorePanel
                name={nameB}
                score={scoreB}
                color="red"
                isLeading={delta < 0}
              />
            </div>

            {/* Score breakdown bar */}
            {(scoreA || scoreB) && (
              <div className="border-t border-gray-100 px-4 py-3">
                <ScoreBreakdownRow
                  labelA={nameA.split(' ')[0]}
                  labelB={nameB.split(' ')[0]}
                  scoreA={scoreA}
                  scoreB={scoreB}
                />
              </div>
            )}
          </div>

          {/* ── Badges ──────────────────────────────────────────────────────── */}
          {(badges.reiCravadas || badges.cacadorZebras || badges.maisEficiente) && (
            <div className="mb-6 flex flex-wrap gap-2">
              {badges.reiCravadas && (
                <BadgeChip
                  icon="🎯"
                  title="Rei das Cravadas"
                  winner={badges.reiCravadas}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                  countA={breakdown.exactCountA}
                  countB={breakdown.exactCountB}
                  unit="placar(es) exato(s)"
                />
              )}
              {badges.cacadorZebras && (
                <BadgeChip
                  icon="⚡"
                  title="Caçador de Zebras"
                  winner={badges.cacadorZebras}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                  countA={breakdown.zebraHitsA}
                  countB={breakdown.zebraHitsB}
                  unit="zebra(s) acertada(s)"
                />
              )}
              {badges.maisEficiente && (
                <BadgeChip
                  icon="📐"
                  title="Mais Eficiente"
                  winner={badges.maisEficiente}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                  countA={breakdown.effPtsA}
                  countB={breakdown.effPtsB}
                  unit="pts ganhos sozinho"
                />
              )}
            </div>
          )}

          {/* ── Tab nav ──────────────────────────────────────────────────────── */}
          <div className="mb-4 flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {([
              { key: 'analise',  label: '📊 Análise'   },
              { key: 'projecao', label: '🔮 Projeção'  },
              { key: 'matrix',   label: '📋 Matriz'    },
              { key: 'diaadia',  label: '📅 Dia a dia' },
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

          {/* ── Análise tab ─────────────────────────────────────────────────── */}
          {activeTab === 'analise' && (
            <div className="space-y-6">
              <DeltaBreakdownSection
                breakdown={breakdown}
                nameA={nameA.split(' ')[0]}
                nameB={nameB.split(' ')[0]}
              />
              {/* Group bets side-by-side */}
              {groupDuel.length > 0 && (
                <GroupBetsDuel
                  rows={groupDuel}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                />
              )}
              {/* Tournament bets */}
              {tDuel && (tDuel.betA || tDuel.betB) && (
                <TournamentBetsDuel
                  betA={tDuel.betA}
                  betB={tDuel.betB}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                  scoreA={scoreA?.ptsTournament ?? 0}
                  scoreB={scoreB?.ptsTournament ?? 0}
                />
              )}
            </div>
          )}

          {/* ── Projeção tab ─────────────────────────────────────────────────── */}
          {activeTab === 'projecao' && (
            <ProjectionSection
              projection={projection}
              nameA={nameA}
              nameB={nameB}
              deltaMatchesTotal={breakdown.delta}
            />
          )}

          {/* ── Matriz tab ───────────────────────────────────────────────────── */}
          {activeTab === 'matrix' && (
            <MatchMatrix rows={duelRows} nameA={nameA} nameB={nameB} />
          )}

          {/* ── Dia a dia tab ──────────────────────────────────────────────────── */}
          {activeTab === 'diaadia' && (
            <DiaDiaSection
              pidA={pidA}
              pidB={pidB}
              nameA={nameA}
              nameB={nameB}
              snapshots={snapshots}
            />
          )}

          {/* ── Share card button ─────────────────────────────────────────────── */}
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setShowCard(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-azul-escuro to-verde-700 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:opacity-90"
            >
              📲 Gerar Cartão de Duelo
            </button>
          </div>
        </>
      )}

      {/* Duel card modal */}
      {showCard && hasData && (
        <DuelCard
          nameA={nameA}
          nameB={nameB}
          totalA={totalA}
          totalB={totalB}
          breakdown={breakdown}
          projection={projection}
          onClose={() => setShowCard(false)}
        />
      )}
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ParticipantPicker({ participants, value, onChange, exclude, label, color }: {
  participants: Participant[]
  value: string
  onChange: (id: string) => void
  exclude: string
  label: string
  color: 'blue' | 'red'
}) {
  const border = color === 'blue' ? 'border-azul-escuro/30 focus:border-azul-escuro' : 'border-red-300 focus:border-red-500'
  const labelColor = color === 'blue' ? 'text-azul-escuro' : 'text-red-600'

  return (
    <div>
      <label className={`block text-xs font-bold mb-1 ${labelColor}`}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full rounded-xl border-2 bg-white py-2.5 pl-3 pr-8 text-sm font-semibold focus:outline-none ${border}`}
      >
        {color === 'red' && <option value="">— Selecionar participante —</option>}
        {participants.filter(p => p.id !== exclude).map(p => (
          <option key={p.id} value={p.id}>{p.apelido}</option>
        ))}
      </select>
    </div>
  )
}

function ScorePanel({ name, score, color, isLeading }: {
  name: string; score: Score | undefined; color: 'blue' | 'red'; isLeading: boolean
}) {
  const nameColor = color === 'blue' ? 'text-azul-escuro' : 'text-red-600'
  const ptsColor  = color === 'blue' ? 'text-azul-escuro' : 'text-red-600'
  const bgLeading = isLeading ? (color === 'blue' ? 'bg-azul-escuro/5' : 'bg-red-50') : ''

  return (
    <div className={`flex flex-col items-center justify-center py-5 px-3 text-center ${bgLeading}`}>
      {isLeading && (
        <div className={`text-[10px] font-bold mb-1 ${nameColor} uppercase tracking-widest`}>
          🏆 Na frente
        </div>
      )}
      <div className={`text-sm font-bold ${nameColor} mb-2 leading-tight`}>{name}</div>
      <div className={`text-3xl font-black ${ptsColor}`}>{score?.ptsTotal ?? '—'}</div>
      <div className="text-xs text-gray-400">pts totais</div>
    </div>
  )
}

function ScoreBreakdownRow({ labelA, labelB, scoreA, scoreB }: {
  labelA: string; labelB: string
  scoreA: Score | undefined; scoreB: Score | undefined
}) {
  const cats: { key: keyof Score; label: string }[] = [
    { key: 'ptsMatches',    label: '⚽ Jogos'   },
    { key: 'ptsGroups',     label: '📊 Classif.' },
    { key: 'ptsThirds',     label: '3️⃣ Terceiros' },
    { key: 'ptsTournament', label: '🏆 G4'       },
  ]

  return (
    <div className="grid grid-cols-4 gap-2">
      {cats.map(({ key, label }) => {
        const a = scoreA?.[key] ?? 0
        const b = scoreB?.[key] ?? 0
        const diff = a - b
        return (
          <div key={key} className="text-center">
            <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
            <div className="flex items-center justify-center gap-1 text-xs font-bold">
              <span className="text-azul-escuro">{a}</span>
              <span className="text-gray-300">×</span>
              <span className="text-red-500">{b}</span>
            </div>
            {diff !== 0 && (
              <div className={`text-[10px] font-bold ${diff > 0 ? 'text-azul-escuro' : 'text-red-500'}`}>
                {diff > 0 ? `+${diff}` : diff}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BadgeChip({ icon, title, winner, nameA, nameB, countA, countB, unit }: {
  icon: string; title: string; winner: 'A' | 'B' | 'tie'
  nameA: string; nameB: string
  countA: number; countB: number; unit: string
}) {
  const name = winner === 'A' ? nameA : winner === 'B' ? nameB : null
  const count = winner === 'A' ? countA : countB

  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <span className="text-xl">{icon}</span>
      <div>
        <div className="text-xs font-bold text-amber-800">{title}</div>
        <div className="text-[11px] text-amber-700">
          {winner === 'tie'
            ? `Empate: ${countA} × ${countB} ${unit}`
            : `${name}: ${count} ${unit}`
          }
        </div>
      </div>
    </div>
  )
}

function DeltaBreakdownSection({ breakdown, nameA, nameB }: {
  breakdown: ReturnType<typeof computeBreakdown>
  nameA: string; nameB: string
}) {
  const rows = [
    {
      icon: '🎯',
      label: 'Δ Cravadas',
      desc: `Pontos gerados de placares exatos`,
      valA: breakdown.exactPtsA,
      valB: breakdown.exactPtsB,
      delta: breakdown.deltaExact,
      subA: `${breakdown.exactCountA} cravada${breakdown.exactCountA !== 1 ? 's' : ''}`,
      subB: `${breakdown.exactCountB} cravada${breakdown.exactCountB !== 1 ? 's' : ''}`,
    },
    {
      icon: '📐',
      label: 'Δ Eficiência',
      desc: 'Pts ganhos acertando coluna enquanto adversário zerou',
      valA: breakdown.effPtsA,
      valB: breakdown.effPtsB,
      delta: breakdown.deltaEff,
      subA: `${breakdown.effPtsA} pts exclusivos`,
      subB: `${breakdown.effPtsB} pts exclusivos`,
    },
    {
      icon: '⚡',
      label: 'Δ Bônus Zebra',
      desc: 'Todos os pontos em jogos com resultado improváveis',
      valA: breakdown.zebraPtsA,
      valB: breakdown.zebraPtsB,
      delta: breakdown.deltaZebra,
      subA: `${breakdown.zebraHitsA} zebra${breakdown.zebraHitsA !== 1 ? 's' : ''} acertada${breakdown.zebraHitsA !== 1 ? 's' : ''}`,
      subB: `${breakdown.zebraHitsB} zebra${breakdown.zebraHitsB !== 1 ? 's' : ''} acertada${breakdown.zebraHitsB !== 1 ? 's' : ''}`,
    },
  ]

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-800 mb-3">📊 Decomposição da Diferença</h2>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Categoria</th>
              <th className="px-3 py-2 text-center text-azul-escuro">{nameA}</th>
              <th className="px-3 py-2 text-center">Δ</th>
              <th className="px-3 py-2 text-center text-red-500">{nameB}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.label} className="hover:bg-gray-50">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{r.icon}</span>
                    <div>
                      <div className="font-semibold text-gray-800">{r.label}</div>
                      <div className="text-[10px] text-gray-400">{r.desc}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="font-bold text-azul-escuro">{r.valA > 0 ? `+${r.valA}` : r.valA}</div>
                  <div className="text-[10px] text-gray-400">{r.subA}</div>
                </td>
                <td className="px-3 py-3 text-center">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-black ${
                    r.delta > 0 ? 'bg-azul-escuro/10 text-azul-escuro' :
                    r.delta < 0 ? 'bg-red-100 text-red-600' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? r.delta : '='}
                  </span>
                </td>
                <td className="px-3 py-3 text-center">
                  <div className="font-bold text-red-500">{r.valB > 0 ? `+${r.valB}` : r.valB}</div>
                  <div className="text-[10px] text-gray-400">{r.subB}</div>
                </td>
              </tr>
            ))}

            {/* Total row */}
            <tr className="bg-gray-50 font-bold">
              <td className="px-3 py-3 text-gray-700">⚽ Total Jogos</td>
              <td className="px-3 py-3 text-center text-azul-escuro">{breakdown.ptsMatchesA}</td>
              <td className="px-3 py-3 text-center">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-black ${
                  breakdown.delta > 0 ? 'bg-azul-escuro text-white' :
                  breakdown.delta < 0 ? 'bg-red-500 text-white' :
                  'bg-gray-200 text-gray-600'
                }`}>
                  {breakdown.delta > 0 ? `+${breakdown.delta}` : breakdown.delta < 0 ? breakdown.delta : '='}
                </span>
              </td>
              <td className="px-3 py-3 text-center text-red-500">{breakdown.ptsMatchesB}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Played count */}
      <p className="mt-2 text-xs text-gray-400 text-right">
        {breakdown.scoredA + breakdown.scoredB > 0
          ? `${nameA} pontuou em ${breakdown.scoredA} jogos · ${nameB} pontuou em ${breakdown.scoredB} jogos`
          : 'Nenhum jogo realizado ainda.'
        }
      </p>
    </div>
  )
}

function GroupBetsDuel({ rows, nameA, nameB }: {
  rows: { group: string; betA: GroupBet | null; betB: GroupBet | null }[]
  nameA: string; nameB: string
}) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-800 mb-3">📊 Classificados por Grupo</h2>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Grupo</th>
              <th className="px-3 py-2 text-center text-azul-escuro">{nameA} (1º/2º)</th>
              <th className="px-3 py-2 text-center text-azul-escuro">Pts A</th>
              <th className="px-3 py-2 text-center text-red-500">{nameB} (1º/2º)</th>
              <th className="px-3 py-2 text-center text-red-500">Pts B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const diff = (r.betA?.first !== r.betB?.first || r.betA?.second !== r.betB?.second)
              return (
                <tr key={r.group} className={diff ? 'bg-amber-50/30' : ''}>
                  <td className="px-3 py-2 font-bold text-gray-700">Grupo {r.group}</td>
                  <td className="px-3 py-2 text-center text-gray-600">
                    {r.betA ? `${r.betA.first || '—'} / ${r.betA.second || '—'}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-azul-escuro">
                    {r.betA?.points != null ? (r.betA.points > 0 ? `+${r.betA.points}` : r.betA.points) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">
                    {r.betB ? `${r.betB.first || '—'} / ${r.betB.second || '—'}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-red-500">
                    {r.betB?.points != null ? (r.betB.points > 0 ? `+${r.betB.points}` : r.betB.points) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TournamentBetsDuel({ betA, betB, nameA, nameB, scoreA, scoreB }: {
  betA: TBet | null; betB: TBet | null; nameA: string; nameB: string
  scoreA: number; scoreB: number
}) {
  const fields: { key: keyof TBet; label: string }[] = [
    { key: 'champion',   label: '🥇 Campeão'    },
    { key: 'runner_up',  label: '🥈 Vice'        },
    { key: 'semi1',      label: '🥉 3º Lugar'    },
    { key: 'semi2',      label: '4️⃣ 4º Lugar'    },
    { key: 'top_scorer', label: '⚽ Artilheiro'  },
  ]

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-800 mb-3">🏆 Apostas G4 e Artilheiro</h2>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Campo</th>
              <th className="px-3 py-2 text-center text-azul-escuro">{nameA}</th>
              <th className="px-3 py-2 text-center text-red-500">{nameB}</th>
              <th className="px-3 py-2 text-center">Igual?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {fields.map(f => {
              const a = betA?.[f.key] ?? ''
              const b = betB?.[f.key] ?? ''
              const same = !!a && !!b && a === b
              return (
                <tr key={f.key} className={same ? 'bg-verde-50/30' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-700">{f.label}</td>
                  <td className="px-3 py-2 text-center font-semibold text-azul-escuro">{a || '—'}</td>
                  <td className="px-3 py-2 text-center font-semibold text-red-500">{b || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {same ? <span className="text-verde-600 font-bold">✓</span> :
                     a && b ? <span className="text-gray-400">—</span> : ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 font-bold text-xs">
            <tr>
              <td className="px-3 py-2 text-gray-700">Total G4</td>
              <td className="px-3 py-2 text-center text-azul-escuro">{scoreA > 0 ? `+${scoreA}` : scoreA} pts</td>
              <td className="px-3 py-2 text-center text-red-500">{scoreB > 0 ? `+${scoreB}` : scoreB} pts</td>
              <td className="px-3 py-2 text-center">
                <span className={`font-black ${scoreA - scoreB > 0 ? 'text-azul-escuro' : scoreA - scoreB < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                  {scoreA - scoreB > 0 ? `+${scoreA - scoreB}` : scoreA - scoreB || '='}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
