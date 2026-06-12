'use client'

import { useState, useMemo, useEffect } from 'react'
import { Combobox } from '@/components/ui/Combobox'
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
type ThirdBet = { team: string; points: number | null }
type TBet = { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string }

interface Props {
  participants: Participant[]
  matches: MatchInfo[]
  betsByParticipant: Record<string, Record<string, FlatBet>>
  groupBetsByParticipant: Record<string, Record<string, GroupBet>>
  thirdBetsByParticipant: Record<string, Record<string, ThirdBet>>
  tBetByParticipant: Record<string, TBet>
  scoresByParticipant: Record<string, Score>
  colPopMap: Record<string, ColPop>
  rulesMap: Record<string, number>
  zebraThreshold: number
  currentParticipantId: string
  snapshots: Snapshot[]
  isAdmin: boolean
}

// ── Main component ────────────────────────────────────────────────────────────

export function ComparadorClient(props: Props) {
  const {
    participants, matches,
    betsByParticipant, groupBetsByParticipant, thirdBetsByParticipant, tBetByParticipant,
    scoresByParticipant, colPopMap, rulesMap, zebraThreshold, currentParticipantId, snapshots,
    isAdmin,
  } = props

  const storageKey = `comparador_last_${currentParticipantId}`

  const [pidA, setPidA] = useState(currentParticipantId)
  const [pidB, setPidB] = useState('')
  const [activeTab, setActiveTab] = useState<'analise' | 'projecao' | 'matrix' | 'diaadia'>('analise')
  const [showCard, setShowCard] = useState(false)

  // Restaura última comparação ao montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { pidA?: string; pidB?: string }
        const validIds = new Set(participants.map(p => p.id))
        if (parsed.pidA && validIds.has(parsed.pidA)) setPidA(parsed.pidA)
        if (parsed.pidB && validIds.has(parsed.pidB)) setPidB(parsed.pidB)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persiste seleção sempre que mudar (só quando ambos estão selecionados)
  useEffect(() => {
    if (!pidB) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ pidA, pidB }))
    } catch {}
  }, [storageKey, pidA, pidB])

  // ── Computed data ──────────────────────────────────────────────────────────
  const nameA = participants.find(p => p.id === pidA)?.apelido ?? 'Participante A'
  const nameB = participants.find(p => p.id === pidB)?.apelido ?? 'Participante B'
  const scoreA = scoresByParticipant[pidA]
  const scoreB = scoresByParticipant[pidB]

  const duelRows = useMemo(() => {
    if (!pidA || !pidB) return []
    const bA = betsByParticipant[pidA] ?? {}
    const bB = betsByParticipant[pidB] ?? {}
    return buildDuelMatrix(matches, bA, bB, colPopMap, zebraThreshold, rulesMap, isAdmin)
  }, [pidA, pidB, matches, betsByParticipant, colPopMap, zebraThreshold, rulesMap])

  const breakdown = useMemo(() =>
    computeBreakdown(duelRows, rulesMap), [duelRows, rulesMap])

  // Diagnóstico: jogos com placar × palpites × pontos calculados × regras
  const debugInfo = useMemo(() => {
    if (!isAdmin || !pidA || !pidB) return null
    const bA = betsByParticipant[pidA] ?? {}
    const bB = betsByParticipant[pidB] ?? {}
    const played = matches.filter(m => m.scoreHome !== null && m.scoreAway !== null)
    const playedRows = duelRows.filter(r => r.match.scoreHome !== null)
    const ruleKeys = ['placar_exato','vencedor_gols_vencedor','vencedor_diferenca_gols',
                      'vencedor_gols_perdedor','somente_vencedor','empate_gols_errados',
                      'bonus_zebra_jogo','multiplicador_brasil','percentual_zebra']
    return {
      totalMatches: matches.length,
      playedMatches: played.length,
      betsA: Object.keys(bA).length,
      betsB: Object.keys(bB).length,
      playedDetail: played.slice(0, 5).map(m => {
        const row = playedRows.find(r => r.match.id === m.id)
        return {
          n: m.matchNumber,
          score: `${m.scoreHome}-${m.scoreAway}`,
          betA: bA[m.id] ? `${bA[m.id].scoreHome}-${bA[m.id].scoreAway}` : 'null',
          betB: bB[m.id] ? `${bB[m.id].scoreHome}-${bB[m.id].scoreAway}` : 'null',
          ptsA: row?.ptsA ?? '?',
          ptsB: row?.ptsB ?? '?',
        }
      }),
      rules: ruleKeys.map(k => `${k}=${rulesMap[k] ?? 'undef'}`).join(' | '),
      bdA: breakdown.ptsMatchesA,
      bdB: breakdown.ptsMatchesB,
      scA: scoresByParticipant[pidA]?.ptsMatches ?? 'n/a',
      scTotA: scoresByParticipant[pidA]?.ptsTotal ?? 'n/a',
      scB: scoresByParticipant[pidB]?.ptsMatches ?? 'n/a',
      scTotB: scoresByParticipant[pidB]?.ptsTotal ?? 'n/a',
    }
  }, [isAdmin, pidA, pidB, matches, betsByParticipant, duelRows, rulesMap, breakdown, scoresByParticipant])

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

  const thirdDuel = useMemo(() => {
    if (!pidA || !pidB) return []
    const tbA = thirdBetsByParticipant[pidA] ?? {}
    const tbB = thirdBetsByParticipant[pidB] ?? {}
    return GROUP_ORDER
      .map(g => ({ group: g, betA: tbA[g] ?? null, betB: tbB[g] ?? null }))
      .filter(r => r.betA || r.betB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pidA, pidB, thirdBetsByParticipant])

  // Pontos de jogos: usa breakdown (calculado ao vivo) para não depender de participant_scores
  // estar atualizado. Grupos/terceiros/torneio ainda vêm do banco pois o comparador não os computa.
  const effectiveScoreA: Score = {
    ptsMatches:    breakdown.ptsMatchesA,
    ptsGroups:     scoreA?.ptsGroups     ?? 0,
    ptsThirds:     scoreA?.ptsThirds     ?? 0,
    ptsTournament: scoreA?.ptsTournament ?? 0,
    ptsTotal:      breakdown.ptsMatchesA + (scoreA?.ptsGroups ?? 0) + (scoreA?.ptsThirds ?? 0) + (scoreA?.ptsTournament ?? 0),
  }
  const effectiveScoreB: Score = {
    ptsMatches:    breakdown.ptsMatchesB,
    ptsGroups:     scoreB?.ptsGroups     ?? 0,
    ptsThirds:     scoreB?.ptsThirds     ?? 0,
    ptsTournament: scoreB?.ptsTournament ?? 0,
    ptsTotal:      breakdown.ptsMatchesB + (scoreB?.ptsGroups ?? 0) + (scoreB?.ptsThirds ?? 0) + (scoreB?.ptsTournament ?? 0),
  }

  // Total across all categories
  const totalA = effectiveScoreA.ptsTotal
  const totalB = effectiveScoreB.ptsTotal
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

      {/* ── Debug panel (admin only) ─────────────────────────────────────── */}
      {debugInfo && (
        <details className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <summary className="cursor-pointer font-bold">🔧 Debug (admin)</summary>
          <div className="mt-2 space-y-1 font-mono">
            <div>Partidas carregadas: {debugInfo.totalMatches} | Com placar: {debugInfo.playedMatches}</div>
            <div>Palpites A: {debugInfo.betsA} | Palpites B: {debugInfo.betsB}</div>
            {debugInfo.playedDetail.map(d => (
              <div key={d.n}>Jogo #{d.n} [{d.score}] — A: {d.betA} ({d.ptsA}pts) | B: {d.betB} ({d.ptsB}pts)</div>
            ))}
            <div>breakdown.ptsMatchesA={debugInfo.bdA} | breakdown.ptsMatchesB={debugInfo.bdB}</div>
            <div>scoresByParticipant A ptsMatches={debugInfo.scA} ptsTotal={debugInfo.scTotA}</div>
            <div>scoresByParticipant B ptsMatches={debugInfo.scB} ptsTotal={debugInfo.scTotB}</div>
            <div className="mt-1 break-all">{debugInfo.rules}</div>
          </div>
        </details>
      )}

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
                score={effectiveScoreA}
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
                score={effectiveScoreB}
                color="red"
                isLeading={delta < 0}
              />
            </div>

            {/* Score breakdown bar */}
            {hasData && (
              <div className="border-t border-gray-100 px-4 py-3">
                <ScoreBreakdownRow
                  labelA={nameA.split(' ')[0]}
                  labelB={nameB.split(' ')[0]}
                  scoreA={effectiveScoreA}
                  scoreB={effectiveScoreB}
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
              { key: 'projecao', label: '🔮 Próximos'  },
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
                  ptsGroupsA={scoreA?.ptsGroups ?? 0}
                  ptsGroupsB={scoreB?.ptsGroups ?? 0}
                />
              )}
              {thirdDuel.length > 0 && (
                <ThirdBetsDuel
                  rows={thirdDuel}
                  nameA={nameA.split(' ')[0]}
                  nameB={nameB.split(' ')[0]}
                  ptsThirdsA={scoreA?.ptsThirds ?? 0}
                  ptsThirdsB={scoreB?.ptsThirds ?? 0}
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
              rulesMap={rulesMap}
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
  const labelColor = color === 'blue' ? 'text-azul-escuro' : 'text-red-600'
  const borderCls  = color === 'blue'
    ? '[&_input]:border-azul-escuro/30 [&_input]:focus:border-azul-escuro [&_input]:focus:ring-azul-escuro/20'
    : '[&_input]:border-red-300 [&_input]:focus:border-red-500 [&_input]:focus:ring-red-200'

  const options = participants
    .filter(p => p.id !== exclude)
    .map(p => ({ value: p.id, label: p.apelido }))

  return (
    <div>
      <label className={`block text-xs font-bold mb-1 ${labelColor}`}>{label}</label>
      <Combobox
        value={value}
        onChange={onChange}
        options={options}
        placeholder="— buscar participante —"
        className={`w-full rounded-xl border-2 bg-white py-2.5 pl-3 pr-8 text-sm font-semibold focus:outline-none ${borderCls}`}
      />
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
      <div className={`text-3xl font-black ${ptsColor}`}>{score?.ptsTotal ?? 0}</div>
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
    { key: 'ptsTournament', label: '🏆 G4+Art.'   },
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
      <h2 className="text-sm font-bold text-gray-800 mb-3">📊 Decomposição da Diferença dos Jogos</h2>
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

function GroupBetsDuel({ rows, nameA, nameB, ptsGroupsA, ptsGroupsB }: {
  rows: { group: string; betA: GroupBet | null; betB: GroupBet | null }[]
  nameA: string; nameB: string
  ptsGroupsA: number; ptsGroupsB: number
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
              const diffFirst  = r.betA?.first  !== r.betB?.first
              const diffSecond = r.betA?.second !== r.betB?.second
              const anyDiff = diffFirst || diffSecond
              return (
                <tr key={r.group} className={anyDiff ? 'bg-amber-50/30' : ''}>
                  <td className="px-3 py-2 font-bold text-gray-700">Grupo {r.group}</td>
                  <td className="px-3 py-2 text-center text-azul-escuro">
                    {r.betA ? (
                      <>
                        <span className={diffFirst ? 'underline underline-offset-2 decoration-azul-escuro' : ''}>{r.betA.first || '—'}</span>
                        {' / '}
                        <span className={diffSecond ? 'underline underline-offset-2 decoration-azul-escuro' : ''}>{r.betA.second || '—'}</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-azul-escuro">
                    {r.betA?.points != null ? (r.betA.points > 0 ? `+${r.betA.points}` : r.betA.points) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-red-600">
                    {r.betB ? (
                      <>
                        <span className={diffFirst ? 'underline underline-offset-2 decoration-red-500' : ''}>{r.betB.first || '—'}</span>
                        {' / '}
                        <span className={diffSecond ? 'underline underline-offset-2 decoration-red-500' : ''}>{r.betB.second || '—'}</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-red-500">
                    {r.betB?.points != null ? (r.betB.points > 0 ? `+${r.betB.points}` : r.betB.points) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-xs">
            <tr>
              <td className="px-3 py-2 text-gray-700">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-center text-azul-escuro">
                {ptsGroupsA > 0 ? `+${ptsGroupsA}` : ptsGroupsA} pts
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-center text-red-500">
                {ptsGroupsB > 0 ? `+${ptsGroupsB}` : ptsGroupsB} pts
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function ThirdBetsDuel({ rows, nameA, nameB, ptsThirdsA, ptsThirdsB }: {
  rows: { group: string; betA: ThirdBet | null; betB: ThirdBet | null }[]
  nameA: string; nameB: string
  ptsThirdsA: number; ptsThirdsB: number
}) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-800 mb-3">3️⃣ Terceiros Colocados por Grupo</h2>
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Grupo</th>
              <th className="px-3 py-2 text-center text-azul-escuro">{nameA}</th>
              <th className="px-3 py-2 text-center text-azul-escuro">Pts A</th>
              <th className="px-3 py-2 text-center text-red-500">{nameB}</th>
              <th className="px-3 py-2 text-center text-red-500">Pts B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => {
              const diff = r.betA?.team !== r.betB?.team
              return (
                <tr key={r.group} className={diff ? 'bg-amber-50/30' : ''}>
                  <td className="px-3 py-2 font-bold text-gray-700">Grupo {r.group}</td>
                  <td className="px-3 py-2 text-center text-azul-escuro">
                    <span className={diff ? 'underline underline-offset-2 decoration-azul-escuro' : ''}>{r.betA?.team || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-azul-escuro">
                    {r.betA?.points != null ? (r.betA.points > 0 ? `+${r.betA.points}` : r.betA.points) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-red-600">
                    <span className={diff ? 'underline underline-offset-2 decoration-red-500' : ''}>{r.betB?.team || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-red-500">
                    {r.betB?.points != null ? (r.betB.points > 0 ? `+${r.betB.points}` : r.betB.points) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200 font-bold text-xs">
            <tr>
              <td className="px-3 py-2 text-gray-700">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-center text-azul-escuro">
                {ptsThirdsA > 0 ? `+${ptsThirdsA}` : ptsThirdsA} pts
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-center text-red-500">
                {ptsThirdsB > 0 ? `+${ptsThirdsB}` : ptsThirdsB} pts
              </td>
            </tr>
          </tfoot>
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
              const diff = !!a && !!b && !same
              return (
                <tr key={f.key} className={same ? 'bg-verde-50/30' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-700">{f.label}</td>
                  <td className="px-3 py-2 text-center font-semibold text-azul-escuro">
                    <span className={diff ? 'underline underline-offset-2 decoration-azul-escuro' : ''}>{a || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-center font-semibold text-red-500">
                    <span className={diff ? 'underline underline-offset-2 decoration-red-500' : ''}>{b || '—'}</span>
                  </td>
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
              <td className="px-3 py-2 text-gray-700">Total G4+Art.</td>
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
