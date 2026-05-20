'use client'

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts'

export interface ChartPoint {
  dateLabel: string
  A?: number
  B?: number
}

function CustomTooltip({ active, payload, label, nameA, nameB }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
  label?: string
  nameA: string
  nameB: string
}) {
  if (!active || !payload?.length) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = payload.find((p: any) => p.dataKey === 'A')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = payload.find((p: any) => p.dataKey === 'B')
  const diff = a && b ? a.value - b.value : null

  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-lg text-xs min-w-[140px]">
      <p className="font-bold text-gray-600 mb-1.5">{label}</p>
      {a && (
        <p className="font-semibold" style={{ color: '#002776' }}>
          {nameA}: <span className="font-black">{a.value}</span> pts
        </p>
      )}
      {b && (
        <p className="font-semibold" style={{ color: '#EF4444' }}>
          {nameB}: <span className="font-black">{b.value}</span> pts
        </p>
      )}
      {diff !== null && (
        <p
          className="font-black mt-1.5 pt-1.5 border-t border-gray-100"
          style={{ color: diff > 0 ? '#002776' : diff < 0 ? '#EF4444' : '#9CA3AF' }}
        >
          Δ {diff > 0 ? `+${diff}` : diff === 0 ? '=' : diff}
        </p>
      )}
    </div>
  )
}

export function DiaDiaChart({ data, nameA, nameB }: {
  data: ChartPoint[]
  nameA: string
  nameB: string
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 16, left: -8, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 10, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip nameA={nameA} nameB={nameB} />} />
        <Line
          type="monotone"
          dataKey="A"
          name={nameA}
          stroke="#002776"
          strokeWidth={2.5}
          dot={{ r: 3, fill: '#002776', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#002776' }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="B"
          name={nameB}
          stroke="#EF4444"
          strokeWidth={2.5}
          dot={{ r: 3, fill: '#EF4444', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#EF4444' }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
