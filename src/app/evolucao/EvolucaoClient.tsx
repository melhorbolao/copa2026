'use client'

import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Combobox } from '@/components/ui/Combobox'
import type { ChartPoint, ShowRefs } from './EvolucaoChart'

const EvolucaoChart = dynamic(
  () => import('./EvolucaoChart').then(m => ({ default: m.EvolucaoChart })),
  { ssr: false, loading: () => <div className="h-[320px] rounded-xl bg-gray-100 animate-pulse" /> },
)

type RawDailyPoint = {
  event_date: string
  participant_id: string
  pts_matches: number
  pts_groups: number
  pts_thirds: number
  pts_tournament: number
}

type LiveScore = { participant_id: string; pts_total: number }

function fmtShort(d: string) {
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}

/**
 * Injeta o ponto "Hoje" ao final do histórico do gráfico.
 * Usa participant_scores (ao vivo) para o total atual e as 4 referências de ranking.
 * Só injeta se:
 *  - houver ao menos 1 jogo finalizado ou em andamento hoje
 *  - o último ponto histórico não for já de hoje (proteção contra batch recente)
 */
function mergeCurrentDayWithHistory(
  chartHistory: ChartPoint[],
  liveScores: LiveScore[],
  selectedId: string,
  todayStr: string,
  hasMatchToday: boolean,
): ChartPoint[] {
  if (!hasMatchToday || liveScores.length === 0) return chartHistory
  if (chartHistory[chartHistory.length - 1]?.date === todayStr) return chartHistory

  const sorted = [...liveScores].sort((a, b) => b.pts_total - a.pts_total)
  const selIdx = sorted.findIndex(s => s.participant_id === selectedId)

  return [
    ...chartHistory,
    {
      dateLabel:    'Hoje',
      date:         todayStr,
      selected:     selIdx >= 0 ? sorted[selIdx].pts_total : undefined,
      selectedRank: selIdx >= 0 ? selIdx + 1 : undefined,
      leader:       sorted[0]?.pts_total,
      zona10:       sorted[9]?.pts_total,
      zona55:       sorted[54]?.pts_total,
      zona110:      sorted[109]?.pts_total,
    },
  ]
}

const REF_CONFIG: {
  key: keyof ShowRefs
  label: string
  sublabel: string
  color: string
}[] = [
  { key: 'leader',  label: 'Líder',          sublabel: '1º lugar',   color: '#dc2626' },
  { key: 'zona10',  label: 'Zona Premiação',  sublabel: '10º lugar',  color: '#16a34a' },
  { key: 'zona55',  label: 'Zona 2º Corte',   sublabel: '55º lugar',  color: '#0284c7' },
  { key: 'zona110', label: 'Zona 1º Corte',   sublabel: '110º lugar', color: '#d97706' },
]

export function EvolucaoClient({
  participants,
  panelaIds,
  currentParticipantId,
  rawDailyPoints,
  liveScores,
  todayStr,
  hasMatchToday,
}: {
  participants: { id: string; apelido: string }[]
  panelaIds: string[]
  currentParticipantId: string
  rawDailyPoints: RawDailyPoint[]
  liveScores: LiveScore[]
  todayStr: string
  hasMatchToday: boolean
}) {
  const [selectedId, setSelectedId] = useState(currentParticipantId)
  const [viewMode, setViewMode]     = useState<'pontuacao' | 'colocacao'>('pontuacao')
  const [show, setShow]             = useState<ShowRefs>({
    leader: true, zona10: true, zona55: true, zona110: true,
  })

  // Combobox options: Minha Panela no topo, demais abaixo com separador
  const comboOptions = useMemo(() => {
    const panelaSet = new Set([currentParticipantId, ...panelaIds])
    const panela = participants
      .filter(p => panelaSet.has(p.id))
      .sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'))
    const others = participants
      .filter(p => !panelaSet.has(p.id))
      .sort((a, b) => a.apelido.localeCompare(b.apelido, 'pt-BR'))

    const opts: { value: string; label: string; disabled?: boolean }[] =
      panela.map(p => ({ value: p.id, label: p.apelido }))
    if (panela.length > 0 && others.length > 0) {
      opts.push({ value: '__sep__', label: '─────────', disabled: true })
    }
    opts.push(...others.map(p => ({ value: p.id, label: p.apelido })))
    return opts
  }, [participants, panelaIds, currentParticipantId])

  // Cálculo do chartData em JS a partir de participant_points_by_day + ponto "Hoje" ao vivo
  const chartData = useMemo((): ChartPoint[] => {
    // 1. Pontos do dia: { date → { pid → pts } }
    const dailyMap: Record<string, Record<string, number>> = {}
    for (const r of rawDailyPoints) {
      const pts = (r.pts_matches ?? 0) + (r.pts_groups ?? 0) + (r.pts_thirds ?? 0) + (r.pts_tournament ?? 0)
      ;(dailyMap[r.event_date] ??= {})[r.participant_id] = pts
    }

    const allDates = Object.keys(dailyMap).sort()

    // 2. Acumulado progressivo: { date → { pid → pts_total } }
    // Inicializa o participante selecionado em 0 para que sua linha apareça
    // mesmo em dias onde ele zerou (sem entrada na tabela)
    const running: Record<string, number> = { [selectedId]: 0 }
    const cumulativeByDate: Record<string, Record<string, number>> = {}
    for (const date of allDates) {
      const day = dailyMap[date]
      for (const [pid, pts] of Object.entries(day)) {
        running[pid] = (running[pid] ?? 0) + pts
      }
      cumulativeByDate[date] = { ...running }
    }

    // 3. Para cada data histórica: ponto com selecionado + referências via .sort
    const history: ChartPoint[] = allDates.map(date => {
      const cum = cumulativeByDate[date]
      const sorted = Object.entries(cum).sort((a, b) => b[1] - a[1])
      const selIdx = sorted.findIndex(([pid]) => pid === selectedId)

      return {
        dateLabel:    fmtShort(date),
        date,
        selected:     cum[selectedId],
        selectedRank: selIdx >= 0 ? selIdx + 1 : undefined,
        leader:       sorted[0]?.[1],
        zona10:       sorted[9]?.[1],
        zona55:       sorted[54]?.[1],
        zona110:      sorted[109]?.[1],
      }
    })

    // 4. Injeta o ponto "Hoje" ao vivo no final (se houver jogo hoje)
    return mergeCurrentDayWithHistory(history, liveScores, selectedId, todayStr, hasMatchToday)
  }, [rawDailyPoints, liveScores, selectedId, todayStr, hasMatchToday])

  const selectedName = participants.find(p => p.id === selectedId)?.apelido ?? ''
  const hasData      = chartData.length > 0

  const toggleRef = (key: keyof ShowRefs) =>
    setShow(s => ({ ...s, [key]: !s[key] }))

  return (
    <main className="min-h-screen bg-gray-50 pb-16">
      <div className="mx-auto max-w-4xl px-4 pt-6 space-y-4">

        <h1 className="text-xl font-bold text-azul-escuro">Evolução do Bolão</h1>

        {/* Card de filtros */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">

          {/* Linha: Participante + toggle de visualização */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Participante
              </label>
              <Combobox
                value={selectedId}
                onChange={val => { if (!val.startsWith('__')) setSelectedId(val) }}
                options={comboOptions}
                placeholder="Buscar participante…"
              />
            </div>

            <div className="flex-shrink-0">
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Visualização
              </label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                <button
                  onClick={() => setViewMode('pontuacao')}
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === 'pontuacao'
                      ? 'bg-azul-escuro text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Por Pontuação
                </button>
                <button
                  onClick={() => setViewMode('colocacao')}
                  className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${
                    viewMode === 'colocacao'
                      ? 'bg-azul-escuro text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Por Colocação
                </button>
              </div>
            </div>
          </div>

          {/* Checkboxes de referência */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Linhas de Referência
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {REF_CONFIG.map(ref => {
                const active = show[ref.key]
                return (
                  <button
                    key={ref.key}
                    onClick={() => toggleRef(ref.key)}
                    className="flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-all text-left"
                    style={active ? {
                      backgroundColor: ref.color + '18',
                      borderColor: ref.color,
                      color: ref.color,
                    } : {
                      borderColor: '#e5e7eb',
                      backgroundColor: '#fff',
                      color: '#9ca3af',
                    }}
                  >
                    <span className="flex items-center gap-1.5 font-semibold">
                      <svg width="18" height="8" className="flex-shrink-0">
                        <line
                          x1="0" y1="4" x2="18" y2="4"
                          stroke={active ? ref.color : '#d1d5db'}
                          strokeWidth="2"
                          strokeDasharray="4 2"
                        />
                      </svg>
                      {ref.label}
                    </span>
                    <span className="text-[10px] pl-5 opacity-70">{ref.sublabel}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Gráfico */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4">
          {!hasData ? (
            <div className="py-16 text-center">
              <p className="text-3xl mb-2">📅</p>
              <p className="font-bold text-gray-700">Ainda não há dados históricos</p>
              <p className="mt-1 text-sm text-gray-400">
                Os snapshots são capturados automaticamente às 6h (horário de Brasília).
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h2 className="text-sm font-bold text-gray-800">
                  {viewMode === 'pontuacao' ? '📈 Pontuação Acumulada' : '🏆 Evolução de Colocação'}
                </h2>
                <div className="ml-auto flex items-center gap-1.5">
                  <svg width="16" height="4">
                    <line x1="0" y1="2" x2="16" y2="2" stroke="#002776" strokeWidth="2.5" />
                  </svg>
                  <span className="text-xs font-semibold text-azul-escuro">{selectedName}</span>
                </div>
              </div>

              <EvolucaoChart
                data={chartData}
                viewMode={viewMode}
                show={show}
                selectedName={selectedName}
              />

              {viewMode === 'colocacao' && (
                <p className="text-[10px] text-gray-400 mt-2 text-right">
                  Eixo Y: 1º ao topo — quanto mais acima, melhor a colocação.
                </p>
              )}
            </>
          )}
        </div>

      </div>
    </main>
  )
}
