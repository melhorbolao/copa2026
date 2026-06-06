'use client'

import { Flag } from '@/components/ui/Flag'
import { formatBrasilia } from '@/utils/date'
import { scoreMatchBet } from '@/lib/scoring/engine'
import type { ProjectionData, MatchDuelRow } from './engine'

interface Props {
  projection: ProjectionData
  nameA: string
  nameB: string
  deltaMatchesTotal: number
  rulesMap: Record<string, number>
}

export function ProjectionSection({ projection, nameA, nameB, deltaMatchesTotal, rulesMap }: Props) {
  const { neutral, concordant, battlefields, maxSwingA, maxSwingB } = projection

  const shortA = nameA.split(' ')[0]
  const shortB = nameB.split(' ')[0]

  return (
    <div className="space-y-6">

      {/* ── Summary cards ── */}
      <div className="space-y-3">
        {/* Row 1: counts */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard icon="🟰" label="Zona Neutra"          value={neutral.length}     sub="palpites idênticos — Δ sempre 0"         color="gray" />
          <SummaryCard icon="⚔️" label="Campos de Batalha"   value={battlefields.length} sub={`${battlefields.filter(r => r.status === 'zebra_battle').length} com duelo de zebra ⚡`} color="red" />
          <SummaryCard icon="🤝" label="Zona de Concordância" value={concordant.length}   sub="mesma coluna, placares diferentes"       color="teal" />
        </div>
        {/* Row 2: max swings */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="text-xs font-bold text-azul-escuro mb-1">🔼 Máx. vantagem de {shortA}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-azul-escuro">+{maxSwingA}</span>
              <span className="text-xs text-azul-mid">pts sobre {shortB}</span>
            </div>
            {deltaMatchesTotal < 0 && maxSwingA >= Math.abs(deltaMatchesTotal) && (
              <p className="mt-1 text-[10px] text-azul-escuro font-semibold">✅ {shortA} pode virar nos jogos restantes!</p>
            )}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold text-amber-700 mb-1">⚠️ Máx. vantagem de {shortB}</div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-amber-800">+{maxSwingB}</span>
              <span className="text-xs text-amber-600">pts sobre {shortA}</span>
            </div>
            {deltaMatchesTotal > 0 && maxSwingB >= deltaMatchesTotal && (
              <p className="mt-1 text-[10px] text-amber-700 font-semibold">⚠️ {shortB} pode virar nos jogos restantes!</p>
            )}
            {deltaMatchesTotal > 0 && maxSwingB < deltaMatchesTotal && (
              <p className="mt-1 text-[10px] text-verde-700 font-semibold">✅ {shortA} está seguro mesmo no pior cenário.</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Campos de Batalha ── */}
      {battlefields.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
            <span>⚔️</span> Campos de Batalha
            <span className="text-xs font-normal text-gray-500">— apostas em colunas diferentes</span>
            <span className="ml-auto text-xs font-normal text-gray-400">{battlefields.length} jogo{battlefields.length !== 1 ? 's' : ''}</span>
          </h3>
          <div className="rounded-xl border border-red-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-red-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Jogo</th>
                  <th className="px-3 py-2 text-center">Data</th>
                  <th className="px-3 py-2 text-center">{shortA}</th>
                  <th className="px-3 py-2 text-center">{shortB}</th>
                  <th className="px-3 py-2 text-center">Tipo</th>
                  <th className="px-3 py-2 text-center">Δ pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50">
                {battlefields.map(row => (
                  <BattlefieldRow key={row.match.id} row={row} shortA={shortA} shortB={shortB} rulesMap={rulesMap} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Zona de Concordância ── */}
      {concordant.length > 0 && (
        <details className="group">
          <summary className="text-sm font-bold text-gray-700 cursor-pointer list-none flex items-center gap-2 select-none">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            🤝 Zona de Concordância
            <span className="text-xs font-normal text-gray-400">— mesma coluna, placares diferentes</span>
            <span className="ml-auto text-xs font-normal text-gray-400">{concordant.length} jogo{concordant.length !== 1 ? 's' : ''}</span>
          </summary>
          <div className="mt-2 rounded-xl border border-teal-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-teal-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Jogo</th>
                  <th className="px-3 py-2 text-center">Data</th>
                  <th className="px-3 py-2 text-center">{shortA}</th>
                  <th className="px-3 py-2 text-center">{shortB}</th>
                  <th className="px-3 py-2 text-center">Δ pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50">
                {concordant.map(row => (
                  <ConcordantRow key={row.match.id} row={row} rulesMap={rulesMap} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* ── Zona Neutra ── */}
      {neutral.length > 0 && (
        <details className="group">
          <summary className="text-sm font-bold text-gray-700 cursor-pointer list-none flex items-center gap-2 select-none">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            🟰 Zona Neutra
            <span className="text-xs font-normal text-gray-400">— palpites idênticos</span>
            <span className="ml-auto text-xs font-normal text-gray-400">{neutral.length} jogo{neutral.length !== 1 ? 's' : ''}</span>
          </summary>
          <div className="mt-2 rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Jogo</th>
                  <th className="px-3 py-2 text-center">Data</th>
                  <th className="px-3 py-2 text-center">{shortA}</th>
                  <th className="px-3 py-2 text-center">{shortB}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {neutral.map(row => (
                  <NeutralRow key={row.match.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

    </div>
  )
}

// ── Row components ────────────────────────────────────────────────────────────

function BattlefieldRow({ row, shortA, shortB, rulesMap }: {
  row: MatchDuelRow; shortA: string; shortB: string
  rulesMap: Record<string, number>
}) {
  const isZebraBattle = row.status === 'zebra_battle'

  const base  = rulesMap['placar_exato']     ?? 12
  const zebra = rulesMap['bonus_zebra_jogo'] ?? 6
  const mult  = row.match.isBrazil ? (rulesMap['multiplicador_brasil'] ?? 2) : 1
  const maxA  = Math.round((base + (row.aOnMinority ? zebra : 0)) * mult)
  const maxB  = Math.round((base + (row.bOnMinority ? zebra : 0)) * mult)

  return (
    <tr className={`hover:bg-red-50 ${isZebraBattle ? 'bg-orange-50/50' : ''}`}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {isZebraBattle && <span className="text-orange-500 font-bold">⚡</span>}
          <div>
            <div className="flex items-center gap-1">
              <Flag code={row.match.flagHome} size="xs" />
              <span className="text-gray-700">{row.match.teamHome}</span>
              <span className="text-gray-400">×</span>
              <span className="text-gray-700">{row.match.teamAway}</span>
              <Flag code={row.match.flagAway} size="xs" />
            </div>
            <div className="text-[10px] text-gray-400">{row.match.phase === 'group' ? `Grupo ${row.match.groupName}` : row.match.phase}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-center text-gray-500">
        {formatBrasilia(row.match.matchDatetime, 'dd/MM HH:mm')}
      </td>
      <td className="px-3 py-2 text-center">
        {row.betA ? (
          <span className={`font-mono font-bold ${row.aOnMinority ? 'text-orange-600' : 'text-azul-escuro'}`}>
            {row.betA.scoreHome}–{row.betA.scoreAway}
            {row.aOnMinority && <span className="ml-0.5 text-[10px]">⚡</span>}
          </span>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2 text-center">
        {row.betB ? (
          <span className={`font-mono font-bold ${row.bOnMinority ? 'text-orange-600' : 'text-red-500'}`}>
            {row.betB.scoreHome}–{row.betB.scoreAway}
            {row.bOnMinority && <span className="ml-0.5 text-[10px]">⚡</span>}
          </span>
        ) : <span className="text-gray-300">—</span>}
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${isZebraBattle ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
          {isZebraBattle ? '⚡ Batalha Zebra' : '⚔️ Batalha'}
        </span>
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap">
        <span className="font-bold text-azul-escuro">+{maxA}</span>
        <span className="text-gray-400 mx-0.5">|</span>
        <span className="font-bold text-red-500">−{maxB}</span>
      </td>
    </tr>
  )
}

function NeutralRow({ row }: { row: MatchDuelRow }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Flag code={row.match.flagHome} size="xs" />
          <span className="text-gray-700">{row.match.teamHome}</span>
          <span className="text-gray-400">×</span>
          <span className="text-gray-700">{row.match.teamAway}</span>
          <Flag code={row.match.flagAway} size="xs" />
        </div>
      </td>
      <td className="px-3 py-2 text-center text-gray-500">
        {formatBrasilia(row.match.matchDatetime, 'dd/MM HH:mm')}
      </td>
      <td className="px-3 py-2 text-center font-mono text-gray-600">
        {row.betA ? `${row.betA.scoreHome}–${row.betA.scoreAway}` : '—'}
      </td>
      <td className="px-3 py-2 text-center font-mono text-gray-600">
        {row.betB ? `${row.betB.scoreHome}–${row.betB.scoreAway}` : '—'}
      </td>
    </tr>
  )
}

function ConcordantRow({ row, rulesMap }: { row: MatchDuelRow; rulesMap: Record<string, number> }) {
  let deltaA: number | null = null
  let deltaB: number | null = null
  if (row.betA && row.betB) {
    const mult     = row.match.isBrazil ? (rulesMap['multiplicador_brasil'] ?? 2) : 1
    const exactPts = Math.round((rulesMap['placar_exato'] ?? 12) * mult)
    const bScore   = scoreMatchBet(row.betB.scoreHome, row.betB.scoreAway, row.betA.scoreHome, row.betA.scoreAway, false, row.match.isBrazil, rulesMap)
    const aScore   = scoreMatchBet(row.betA.scoreHome, row.betA.scoreAway, row.betB.scoreHome, row.betB.scoreAway, false, row.match.isBrazil, rulesMap)
    deltaA = exactPts - bScore
    deltaB = exactPts - aScore
  }

  return (
    <tr className="hover:bg-teal-50">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Flag code={row.match.flagHome} size="xs" />
          <span className="text-gray-700">{row.match.teamHome}</span>
          <span className="text-gray-400">×</span>
          <span className="text-gray-700">{row.match.teamAway}</span>
          <Flag code={row.match.flagAway} size="xs" />
        </div>
      </td>
      <td className="px-3 py-2 text-center text-gray-500">
        {formatBrasilia(row.match.matchDatetime, 'dd/MM HH:mm')}
      </td>
      <td className="px-3 py-2 text-center font-mono text-gray-600">
        {row.betA ? `${row.betA.scoreHome}–${row.betA.scoreAway}` : '—'}
      </td>
      <td className="px-3 py-2 text-center font-mono text-gray-600">
        {row.betB ? `${row.betB.scoreHome}–${row.betB.scoreAway}` : '—'}
      </td>
      <td className="px-3 py-2 text-center whitespace-nowrap">
        {deltaA !== null && deltaB !== null ? (
          <>
            <span className="font-bold text-azul-escuro">+{deltaA}</span>
            <span className="text-gray-400 mx-0.5">|</span>
            <span className="font-bold text-red-500">−{deltaB}</span>
          </>
        ) : <span className="text-gray-300">—</span>}
      </td>
    </tr>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: number; sub: string
  color: 'teal' | 'red' | 'gray'
}) {
  const styles = {
    teal: { border: 'border-teal-200 bg-teal-50', text: 'text-teal-800', sub: 'text-teal-600' },
    red:  { border: 'border-red-200 bg-red-50',   text: 'text-red-800',  sub: 'text-red-500'  },
    gray: { border: 'border-gray-200 bg-gray-50',  text: 'text-gray-700', sub: 'text-gray-500' },
  }[color]

  return (
    <div className={`rounded-xl border p-3 ${styles.border}`}>
      <div className={`text-xs font-bold mb-1 ${styles.text}`}>{icon} {label}</div>
      <div className={`text-3xl font-black ${styles.text}`}>{value}</div>
      <div className={`text-[10px] mt-0.5 ${styles.sub}`}>{sub}</div>
    </div>
  )
}
