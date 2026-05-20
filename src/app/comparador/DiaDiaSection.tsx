'use client'

import { useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { ChartPoint } from './DiaDiaChart'

const DiaDiaChart = dynamic(
  () => import('./DiaDiaChart').then(m => ({ default: m.DiaDiaChart })),
  {
    ssr: false,
    loading: () => <div className="h-[280px] rounded-xl bg-gray-100 animate-pulse" />,
  }
)

export type Snapshot = {
  snapshot_date: string
  participant_id: string
  pts_total: number
}

interface TableRow {
  date: string
  dateLabel: string
  dateFull: string
  dayA: number | null
  dayB: number | null
  accumA: number | null
  accumB: number | null
  delta: number | null
}

function fmtShort(d: string) {
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}

function fmtFull(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

export function DiaDiaSection({
  pidA, pidB, nameA, nameB, snapshots,
}: {
  pidA: string
  pidB: string
  nameA: string
  nameB: string
  snapshots: Snapshot[]
}) {
  const { chartData, tableRows, bestDayA, bestDayB, arrancadaA, arrancadaB } = useMemo(() => {
    const mapA: Record<string, number> = {}
    const mapB: Record<string, number> = {}
    for (const s of snapshots) {
      if (s.participant_id === pidA) mapA[s.snapshot_date] = s.pts_total
      if (s.participant_id === pidB) mapB[s.snapshot_date] = s.pts_total
    }

    const allDates = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])].sort()

    const rows: TableRow[] = allDates.map((d, i) => {
      const accumA = mapA[d] ?? null
      const accumB = mapB[d] ?? null

      // Find nearest previous value for each participant
      let prevA: number | null = null
      let prevB: number | null = null
      for (let j = i - 1; j >= 0; j--) {
        const pd = allDates[j]
        if (prevA === null && mapA[pd] !== undefined) prevA = mapA[pd]
        if (prevB === null && mapB[pd] !== undefined) prevB = mapB[pd]
        if (prevA !== null && prevB !== null) break
      }

      const dayA = accumA !== null ? (prevA !== null ? accumA - prevA : accumA) : null
      const dayB = accumB !== null ? (prevB !== null ? accumB - prevB : accumB) : null

      return {
        date: d,
        dateLabel: fmtShort(d),
        dateFull:  fmtFull(d),
        dayA,
        dayB,
        accumA,
        accumB,
        delta: accumA !== null && accumB !== null ? accumA - accumB : null,
      }
    })

    // Chart data
    const chartData: ChartPoint[] = rows.map(r => ({
      dateLabel: r.dateLabel,
      A: r.accumA ?? undefined,
      B: r.accumB ?? undefined,
    }))

    // "Melhor Dia": max single-day advantage
    let bestDayA = { dateFull: '', diff: 0, dayPts: 0 }
    let bestDayB = { dateFull: '', diff: 0, dayPts: 0 }
    for (const r of rows) {
      if (r.dayA !== null && r.dayB !== null) {
        const dA = r.dayA - r.dayB
        const dB = r.dayB - r.dayA
        if (dA > bestDayA.diff) bestDayA = { dateFull: r.dateFull, diff: dA, dayPts: r.dayA }
        if (dB > bestDayB.diff) bestDayB = { dateFull: r.dateFull, diff: dB, dayPts: r.dayB }
      }
    }

    // "Maior Arrancada": max pts in 3 consecutive days
    let arrancadaA = { start: '', end: '', pts: 0 }
    let arrancadaB = { start: '', end: '', pts: 0 }
    for (let i = 0; i <= rows.length - 3; i++) {
      const w = rows.slice(i, i + 3)
      const sumA = w.reduce((s, r) => s + (r.dayA ?? 0), 0)
      const sumB = w.reduce((s, r) => s + (r.dayB ?? 0), 0)
      if (sumA > arrancadaA.pts) arrancadaA = { start: w[0].dateFull, end: w[2].dateFull, pts: sumA }
      if (sumB > arrancadaB.pts) arrancadaB = { start: w[0].dateFull, end: w[2].dateFull, pts: sumB }
    }

    return { chartData, tableRows: rows, bestDayA, bestDayB, arrancadaA, arrancadaB }
  }, [pidA, pidB, snapshots])

  const shortA = nameA.split(' ')[0]
  const shortB = nameB.split(' ')[0]

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-16 text-center">
        <p className="text-3xl mb-2">📅</p>
        <p className="font-bold text-gray-700">Ainda não há dados históricos diários</p>
        <p className="mt-1 text-sm text-gray-400">
          Os snapshots são capturados automaticamente às 6h (horário de Brasília).
        </p>
      </div>
    )
  }

  const showArrancada = arrancadaA.pts > 0 || arrancadaB.pts > 0
  const arrancadaWinner = arrancadaA.pts >= arrancadaB.pts ? 'A' : 'B'

  return (
    <div className="space-y-5">

      {/* ── Highlights ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {bestDayA.diff > 0 && (
          <HighlightCard
            icon="📅"
            title="Melhor Dia"
            color="blue"
            text={`No dia ${bestDayA.dateFull}, ${shortA} abriu +${bestDayA.diff} pontos de vantagem sobre ${shortB}.`}
          />
        )}
        {bestDayB.diff > 0 && (
          <HighlightCard
            icon="📅"
            title="Melhor Dia"
            color="red"
            text={`No dia ${bestDayB.dateFull}, ${shortB} abriu +${bestDayB.diff} pontos de vantagem sobre ${shortA}.`}
          />
        )}
        {showArrancada && arrancadaWinner === 'A' && arrancadaA.pts > 0 && (
          <HighlightCard
            icon="🚀"
            title="Maior Arrancada (3 dias)"
            color="blue"
            text={`${shortA} somou ${arrancadaA.pts} pts entre ${arrancadaA.start} e ${arrancadaA.end}.`}
          />
        )}
        {showArrancada && arrancadaWinner === 'B' && arrancadaB.pts > 0 && (
          <HighlightCard
            icon="🚀"
            title="Maior Arrancada (3 dias)"
            color="red"
            text={`${shortB} somou ${arrancadaB.pts} pts entre ${arrancadaB.start} e ${arrancadaB.end}.`}
          />
        )}
      </div>

      {/* ── Gráfico ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-sm font-bold text-gray-800">📈 Evolução Acumulada</h2>
          <div className="flex items-center gap-3 ml-auto text-xs font-semibold">
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-0.5 bg-[#002776] rounded" />
              <span className="text-[#002776]">{shortA}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-4 h-0.5 bg-red-500 rounded" />
              <span className="text-red-500">{shortB}</span>
            </span>
          </div>
        </div>
        <DiaDiaChart data={chartData} nameA={nameA} nameB={nameB} />
      </div>

      {/* ── Tabela ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <h2 className="text-sm font-bold text-gray-800 px-4 py-3 border-b border-gray-100">
          📋 Histórico Dia a Dia
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-center" style={{ color: '#002776' }}>Pts dia {shortA}</th>
                <th className="px-3 py-2 text-center text-red-500">Pts dia {shortB}</th>
                <th className="hidden sm:table-cell px-3 py-2 text-center" style={{ color: '#002776' }}>Acum. {shortA}</th>
                <th className="hidden sm:table-cell px-3 py-2 text-center text-red-500">Acum. {shortB}</th>
                <th className="px-3 py-2 text-center">Δ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tableRows.map((row, i) => (
                <tr key={row.date} className={i % 2 === 1 ? 'bg-gray-50/50' : ''}>
                  <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                    {row.dateFull}
                  </td>
                  <td className="px-3 py-2 text-center font-bold" style={{ color: '#002776' }}>
                    {row.dayA !== null ? (row.dayA > 0 ? `+${row.dayA}` : row.dayA) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center font-bold text-red-500">
                    {row.dayB !== null ? (row.dayB > 0 ? `+${row.dayB}` : row.dayB) : '—'}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-center text-gray-600">
                    {row.accumA ?? '—'}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-center text-gray-600">
                    {row.accumB ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.delta !== null ? (
                      <span
                        className="font-bold"
                        style={{ color: row.delta > 0 ? '#002776' : row.delta < 0 ? '#EF4444' : '#9CA3AF' }}
                      >
                        {row.delta > 0 ? `+${row.delta}` : row.delta === 0 ? '=' : row.delta}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function HighlightCard({ icon, title, color, text }: {
  icon: string
  title: string
  color: 'blue' | 'red'
  text: string
}) {
  const cls = color === 'blue'
    ? 'border-blue-200 bg-blue-50'
    : 'border-red-200 bg-red-50'
  const titleCls = color === 'blue' ? 'text-blue-700' : 'text-red-700'
  const textCls  = color === 'blue' ? 'text-blue-900' : 'text-red-900'

  return (
    <div className={`rounded-xl border px-4 py-3 ${cls}`}>
      <div className={`flex items-center gap-1.5 mb-1 text-[10px] font-bold uppercase tracking-wide ${titleCls}`}>
        <span className="text-base">{icon}</span>
        {title}
      </div>
      <p className={`text-sm font-semibold leading-snug ${textCls}`}>{text}</p>
    </div>
  )
}
