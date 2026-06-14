'use client'

import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'

export interface ChartPoint {
  dateLabel: string
  date: string
  selected?: number
  selectedRank?: number
  leader?: number
  zona10?: number
  zona55?: number
  zona110?: number
}

export interface ShowRefs {
  leader: boolean
  zona10: boolean
  zona55: boolean
  zona110: boolean
}

const C = {
  selected: '#002776',
  leader:   '#FFD700',
  zona10:   '#009c3b',
  zona55:   '#eab308',
  zona110:  '#ef4444',
}

function CustomTooltip({ active, payload, label, viewMode, selectedName }: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
  label?: string
  viewMode: 'pontuacao' | 'colocacao'
  selectedName: string
}) {
  if (!active || !payload?.length) return null
  const isPts = viewMode === 'pontuacao'
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-lg text-xs min-w-[160px]">
      <p className="font-bold text-gray-600 mb-2">{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <p key={p.dataKey} className="font-semibold mb-0.5" style={{ color: p.stroke }}>
          {p.name}:{' '}
          <span className="font-black">
            {isPts ? `${p.value} pts` : `${p.value}º`}
          </span>
        </p>
      ))}
    </div>
  )
}

export function EvolucaoChart({
  data, viewMode, show, selectedName,
}: {
  data: ChartPoint[]
  viewMode: 'pontuacao' | 'colocacao'
  show: ShowRefs
  selectedName: string
}) {
  const isPts = viewMode === 'pontuacao'

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 5, right: 48, left: -8, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
        <XAxis
          dataKey="dateLabel"
          tick={{ fontSize: 10, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          reversed={!isPts}
          tick={{ fontSize: 10, fill: '#9CA3AF' }}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={isPts ? undefined : (v: number) => `${v}º`}
        />
        <Tooltip content={<CustomTooltip viewMode={viewMode} selectedName={selectedName} />} />

        {/* Linha do participante selecionado */}
        <Line
          type="monotone"
          dataKey={isPts ? 'selected' : 'selectedRank'}
          name={selectedName}
          stroke={C.selected}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: C.selected }}
          connectNulls
        />

        {/* Modo pontuação: linhas dinâmicas de referência */}
        {isPts && show.leader && (
          <Line type="monotone" dataKey="leader" name="Líder" stroke={C.leader} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
        )}
        {isPts && show.zona10 && (
          <Line type="monotone" dataKey="zona10" name="Zona Premiação (10º)" stroke={C.zona10} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
        )}
        {isPts && show.zona55 && (
          <Line type="monotone" dataKey="zona55" name="Zona 2º Corte (55º)" stroke={C.zona55} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
        )}
        {isPts && show.zona110 && (
          <Line type="monotone" dataKey="zona110" name="Zona 1º Corte (110º)" stroke={C.zona110} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls />
        )}

        {/* Modo colocação: linhas horizontais fixas de referência */}
        {!isPts && show.leader && (
          <ReferenceLine y={1} stroke={C.leader} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: '1º', position: 'right', fontSize: 10, fill: C.leader }} />
        )}
        {!isPts && show.zona10 && (
          <ReferenceLine y={10} stroke={C.zona10} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: '10º', position: 'right', fontSize: 10, fill: C.zona10 }} />
        )}
        {!isPts && show.zona55 && (
          <ReferenceLine y={55} stroke={C.zona55} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: '55º', position: 'right', fontSize: 10, fill: C.zona55 }} />
        )}
        {!isPts && show.zona110 && (
          <ReferenceLine y={110} stroke={C.zona110} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: '110º', position: 'right', fontSize: 10, fill: C.zona110 }} />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
