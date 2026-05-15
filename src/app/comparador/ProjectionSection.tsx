'use client'

import { Flag } from '@/components/ui/Flag'
import { formatBrasilia } from '@/utils/date'
import type { ProjectionData, MatchDuelRow } from './engine'

interface Props {
  projection: ProjectionData
  nameA: string
  nameB: string
  deltaMatchesTotal: number  // current Δ from played matches
}

export function ProjectionSection({ projection, nameA, nameB, deltaMatchesTotal }: Props) {
  const { concordant, battlefields, maxSwingA, maxSwingB } = projection

  const shortA = nameA.split(' ')[0]
  const shortB = nameB.split(' ')[0]

  return (
    <div className="space-y-6">

      {/* Risk summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          icon="🤝"
          label="Zonas de Concordância"
          value={concordant.length}
          sub="jogos — Δ pouco muda aqui"
          color="teal"
        />
        <SummaryCard
          icon="⚔️"
          label="Campos de Batalha"
          value={battlefields.length}
          sub={`${battlefields.filter(r => r.status === 'zebra_battle').length} com duelo de zebra ⚡`}
          color="red"
        />
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-bold text-amber-700 mb-1">⚠️ Risco de Virada</div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-black text-amber-800">{maxSwingB}</span>
            <span className="text-xs text-amber-600">pts max que {shortB} pode tirar de {shortA}</span>
          </div>
          {deltaMatchesTotal > 0 && maxSwingB >= deltaMatchesTotal && (
            <p className="mt-1 text-[10px] text-amber-700 font-semibold">
              ⚠️ {shortB} pode virar a partida nos jogos restantes!
            </p>
          )}
          {deltaMatchesTotal > 0 && maxSwingB < deltaMatchesTotal && (
            <p className="mt-1 text-[10px] text-verde-700 font-semibold">
              ✅ {shortA} está seguro mesmo no pior cenário.
            </p>
          )}
        </div>
      </div>

      {/* Battlefields */}
      {battlefields.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
            <span>⚔️</span> Campos de Batalha
            <span className="text-xs font-normal text-gray-500">— apostas em colunas opostas</span>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50">
                {battlefields.map(row => (
                  <BattlefieldRow key={row.match.id} row={row} shortA={shortA} shortB={shortB} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Concordant (collapsed by default) */}
      {concordant.length > 0 && (
        <details className="group">
          <summary className="text-sm font-bold text-gray-700 cursor-pointer list-none flex items-center gap-2 select-none">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            🤝 Zonas de Concordância ({concordant.length} jogos)
            <span className="text-xs font-normal text-gray-400">— Δ dificilmente muda aqui</span>
          </summary>
          <div className="mt-2 rounded-xl border border-teal-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-teal-50 text-gray-500 uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2 text-left">Jogo</th>
                  <th className="px-3 py-2 text-center">Data</th>
                  <th className="px-3 py-2 text-center">{shortA}</th>
                  <th className="px-3 py-2 text-center">{shortB}</th>
                  <th className="px-3 py-2 text-center">Coluna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-teal-50">
                {concordant.map(row => (
                  <ConcordantRow key={row.match.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

    </div>
  )
}

function BattlefieldRow({ row, shortA, shortB }: { row: MatchDuelRow; shortA: string; shortB: string }) {
  const isZebraBattle = row.status === 'zebra_battle'
  const colLabel = (c: string | null) =>
    c === 'H' ? 'Casa 🏠' : c === 'A' ? 'Fora ✈️' : c === 'D' ? 'Empate 🤝' : '—'

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
        <div className="text-[10px] text-gray-400">{colLabel(row.colA)}</div>
      </td>
      <td className="px-3 py-2 text-center">
        {row.betB ? (
          <span className={`font-mono font-bold ${row.bOnMinority ? 'text-orange-600' : 'text-red-500'}`}>
            {row.betB.scoreHome}–{row.betB.scoreAway}
            {row.bOnMinority && <span className="ml-0.5 text-[10px]">⚡</span>}
          </span>
        ) : <span className="text-gray-300">—</span>}
        <div className="text-[10px] text-gray-400">{colLabel(row.colB)}</div>
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${isZebraBattle ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
          {isZebraBattle ? '⚡ Zebra Battle' : '⚔️ Batalha'}
        </span>
      </td>
    </tr>
  )
}

function ConcordantRow({ row }: { row: MatchDuelRow }) {
  const colLabel = (c: string | null) =>
    c === 'H' ? '🏠 Casa' : c === 'A' ? '✈️ Fora' : c === 'D' ? '🤝 Empate' : '—'

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
      <td className="px-3 py-2 text-center">
        <span className="inline-block rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700">
          {colLabel(row.colA ?? row.colB)}
        </span>
      </td>
    </tr>
  )
}

function SummaryCard({ icon, label, value, sub, color }: {
  icon: string; label: string; value: number; sub: string
  color: 'teal' | 'red'
}) {
  const border = color === 'teal' ? 'border-teal-200 bg-teal-50' : 'border-red-200 bg-red-50'
  const text   = color === 'teal' ? 'text-teal-800' : 'text-red-800'
  const sub_   = color === 'teal' ? 'text-teal-600' : 'text-red-500'

  return (
    <div className={`rounded-xl border p-3 ${border}`}>
      <div className={`text-xs font-bold mb-1 ${text}`}>{icon} {label}</div>
      <div className={`text-3xl font-black ${text}`}>{value}</div>
      <div className={`text-[10px] mt-0.5 ${sub_}`}>{sub}</div>
    </div>
  )
}
