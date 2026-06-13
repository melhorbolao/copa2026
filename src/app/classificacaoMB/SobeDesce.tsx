'use client'

/**
 * SobeDesce — módulo completo para o painel "Sobe e Desce" na Classificação MB.
 *
 * Exports:
 *   useSobeDesce()        — hook: busca snapshot, computa deltas e highlights
 *   SobeDesceSelector     — barra de controle (modo + datas)
 *   EvoCell               — célula de evolução de posição (▲3 / ▼2 / —)
 *   DeltaPtsCell          — célula de pontos conquistados na janela
 */

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Tipos exportados ───────────────────────────────────────────────────────────

export type SobeDesceMode = 'hidden' | 'last_day' | 'current_round' | 'custom'

export type HighlightMode = 'me' | 'panela' | 'tribo' | 'none'

export interface SnapshotEntry {
  participant_id: string
  rank:           number
  pts_total:      number
  snapshot_date:  string
}

export interface DeltaEntry {
  /** positivo = subiu posições (refRank era maior = pior; agora menor = melhor) */
  deltaRank: number
  /** positivo = ganhou pontos na janela */
  deltaPts:  number
}

export interface SobeDesceHighlights {
  maxPtsIds:  Set<string>   // maior pontuação no período (todos os empatados)
  minPtsIds:  Set<string>   // menor pontuação (todos os empatados)
  maxUpIds:   Set<string>   // maior subida (todos os empatados)
  maxDownIds: Set<string>   // maior queda (todos os empatados)
}

export interface UseSobeDesceReturn {
  mode:           SobeDesceMode
  setMode:        (m: SobeDesceMode) => void
  customFrom:     string
  setCustomFrom:  (d: string) => void
  customTo:       string
  setCustomTo:    (d: string) => void
  deltaMap:       Map<string, DeltaEntry> | null
  loading:        boolean
  highlights:     SobeDesceHighlights
  refDateLabel:   string
  refToDateLabel: string
  hasData:        boolean
}

// ── Utilidades internas ────────────────────────────────────────────────────────

export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export function todayBR(): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function formatDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}

async function fetchSnapshotAtDate(date: string): Promise<SnapshotEntry[]> {
  try {
    const res = await fetch(`/api/rankings/snapshots?date=${encodeURIComponent(date)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// ── Hook principal ─────────────────────────────────────────────────────────────

interface UseSobeDesceOptions {
  lastResultDate:        string | null
  currentPhaseStartDate: string | null
  /** Array estável (memoizado no componente pai) */
  rankedRows: ReadonlyArray<{ id: string; pts: number; rank: number }>
  /** Última data com dados em participant_points_by_day (limite para o seletor) */
  lastDataDate: string | null
}

export function useSobeDesce({
  lastResultDate,
  currentPhaseStartDate,
  rankedRows,
  lastDataDate,
}: UseSobeDesceOptions): UseSobeDesceReturn {
  const router = useRouter()

  const [mode,        setMode]        = useState<SobeDesceMode>('hidden')
  const [customFrom,  setCustomFrom]  = useState(() => subtractDays(lastDataDate ?? todayBR(), 7))
  const [customTo,    setCustomTo]    = useState(() => lastDataDate ?? subtractDays(todayBR(), 1))
  const [snapshots,   setSnapshots]   = useState<SnapshotEntry[] | null>(null)
  const [snapshotsTo, setSnapshotsTo] = useState<SnapshotEntry[] | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [loadingTo,   setLoadingTo]   = useState(false)

  // Data de referência FROM derivada do modo
  const refDate = useMemo((): string | null => {
    switch (mode) {
      case 'last_day':
        return lastResultDate        ? subtractDays(lastResultDate,        1) : null
      case 'current_round':
        return currentPhaseStartDate ?? null
      case 'custom':
        return customFrom || null
      default:
        return null
    }
  }, [mode, lastResultDate, currentPhaseStartDate, customFrom])

  // Data TO: só modo custom com data anterior a hoje
  const refDateTo = useMemo((): string | null => {
    if (mode !== 'custom') return null
    const today = todayBR()
    return (customTo && customTo < today) ? customTo : null
  }, [mode, customTo])

  const refDateLabel   = refDate   ? formatDateBR(refDate)   : ''
  const refToDateLabel = refDateTo ? formatDateBR(refDateTo) : ''

  // Busca snapshot FROM quando a data de referência muda
  useEffect(() => {
    if (!refDate || mode === 'hidden') {
      setSnapshots(null)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchSnapshotAtDate(refDate)
      .then(data => { if (!cancelled) { setSnapshots(data); setLoading(false) } })
      .catch(()   => { if (!cancelled) { setSnapshots([]);   setLoading(false) } })
    return () => { cancelled = true }
  }, [refDate, mode])

  // Busca snapshot TO para modo custom com data fim passada
  useEffect(() => {
    if (!refDateTo) {
      setSnapshotsTo(null)
      return
    }
    let cancelled = false
    setLoadingTo(true)
    fetchSnapshotAtDate(refDateTo)
      .then(data => { if (!cancelled) { setSnapshotsTo(data); setLoadingTo(false) } })
      .catch(()   => { if (!cancelled) { setSnapshotsTo([]);   setLoadingTo(false) } })
    return () => { cancelled = true }
  }, [refDateTo])

  // Supabase Realtime — recarrega dados do server quando "Rodada em andamento"
  useEffect(() => {
    if (mode !== 'current_round') return
    const supabase = createClient()
    const channel = supabase
      .channel('sobe-desce-scores')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'participant_scores' },
        () => router.refresh(),
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [mode, router])

  // Mapa de deltas
  const deltaMap = useMemo((): Map<string, DeltaEntry> | null => {
    if (!snapshots || snapshots.length === 0 || mode === 'hidden') return null
    const byPidFrom = new Map(snapshots.map(s => [s.participant_id, s]))
    const map = new Map<string, DeltaEntry>()

    if (snapshotsTo && snapshotsTo.length > 0) {
      // Comparação entre dois snapshots passados
      const byPidTo = new Map(snapshotsTo.map(s => [s.participant_id, s]))
      for (const [pid, fromEntry] of byPidFrom) {
        const toEntry = byPidTo.get(pid)
        if (toEntry) {
          map.set(pid, {
            deltaRank: fromEntry.rank    - toEntry.rank,
            deltaPts:  toEntry.pts_total - fromEntry.pts_total,
          })
        }
      }
    } else {
      // Comparação do snapshot FROM com o ranking atual
      // Participantes sem snapshot (0 pts histórico) entram com deltaPts = pts atual e deltaRank = 0
      for (const row of rankedRows) {
        const ref = byPidFrom.get(row.id)
        map.set(row.id, {
          deltaRank: ref ? ref.rank - row.rank : 0,
          deltaPts:  ref ? row.pts - ref.pts_total : row.pts,
        })
      }
    }
    return map.size > 0 ? map : null  // null só se não houver snapshot algum
  }, [snapshots, snapshotsTo, rankedRows, mode])

  // Destaques
  const highlights = useMemo((): SobeDesceHighlights => {
    const empty = (): SobeDesceHighlights => ({
      maxPtsIds: new Set(), minPtsIds: new Set(),
      maxUpIds:  new Set(), maxDownIds: new Set(),
    })
    if (!deltaMap || deltaMap.size === 0) return empty()

    let maxPts = -Infinity, minPts = Infinity
    let maxUp  = -Infinity, maxDown = Infinity

    for (const d of deltaMap.values()) {
      if (d.deltaPts  > maxPts)  maxPts  = d.deltaPts
      if (d.deltaPts  < minPts)  minPts  = d.deltaPts
      if (d.deltaRank > maxUp)   maxUp   = d.deltaRank
      if (d.deltaRank < maxDown) maxDown = d.deltaRank
    }

    const maxPtsIds  = new Set<string>()
    const minPtsIds  = new Set<string>()
    const maxUpIds   = new Set<string>()
    const maxDownIds = new Set<string>()

    for (const [id, d] of deltaMap.entries()) {
      if (maxPts  > 0 && d.deltaPts  === maxPts)  maxPtsIds.add(id)
      if (minPts  <= 0 && d.deltaPts  === minPts)  minPtsIds.add(id)
      if (maxUp   > 0 && d.deltaRank === maxUp)   maxUpIds.add(id)
      if (maxDown < 0 && d.deltaRank === maxDown) maxDownIds.add(id)
    }

    return { maxPtsIds, minPtsIds, maxUpIds, maxDownIds }
  }, [deltaMap])

  return {
    mode, setMode,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    deltaMap,
    loading: loading || loadingTo,
    highlights,
    refDateLabel,
    refToDateLabel,
    hasData: deltaMap !== null,
  }
}

// ── SobeDesceSelector ──────────────────────────────────────────────────────────

interface SobeDesceSelectorProps {
  mode:                  SobeDesceMode
  setMode:               (m: SobeDesceMode) => void
  customFrom:            string
  setCustomFrom:         (d: string) => void
  customTo:              string
  setCustomTo:           (d: string) => void
  loading:               boolean
  refDateLabel:          string
  refToDateLabel:        string
  hasData:               boolean
  lastResultDate:        string | null
  currentPhaseStartDate: string | null
  lastDataDate:          string | null
  highlightMode?:        HighlightMode
  onHighlightChange?:    (m: HighlightMode) => void
  showPanelaOption?:     boolean
  tribes?:               { id: string; name: string }[]
  activeTribeId?:        string | null
  onTribeSelect?:        (id: string | null) => void
}

export function SobeDesceSelector({
  mode, setMode,
  customFrom, setCustomFrom,
  customTo, setCustomTo,
  loading, refDateLabel, refToDateLabel, hasData,
  lastResultDate, currentPhaseStartDate, lastDataDate,
  highlightMode, onHighlightChange, showPanelaOption,
  tribes, activeTribeId, onTribeSelect,
}: SobeDesceSelectorProps) {
  const [tribeOpen, setTribeOpen] = useState(false)
  const options: { value: SobeDesceMode; label: string; title: string; disabled?: boolean }[] = [
    {
      value: 'hidden',
      label: 'Ocultar',
      title: 'Remove as colunas de evolução',
    },
    {
      value:    'last_day',
      label:    'Último dia',
      title:    'Comparação com o estado antes dos últimos resultados',
      disabled: !lastResultDate,
    },
    {
      value:    'current_round',
      label:    'Rodada atual',
      title:    'Evolução desde o início da fase atual',
      disabled: !currentPhaseStartDate,
      hidden:   true,
    },
    {
      value: 'custom',
      label: 'Período',
      title: 'Escolha o intervalo de datas da comparação',
    },
  ]

  const dateRangeLabel = refToDateLabel
    ? `de ${refDateLabel} até ${refToDateLabel}`
    : refDateLabel ? `desde ${refDateLabel}` : ''

  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {/* Label */}
        <span className="shrink-0 text-xs font-bold text-gray-600">📈 Sobe e Desce:</span>

        {/* Botões de modo */}
        <div className="flex flex-wrap gap-1">
          {options.filter(opt => !opt.hidden).map(opt => (
            <button
              key={opt.value}
              disabled={!!opt.disabled}
              onClick={() => setMode(opt.value)}
              title={opt.title}
              className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                mode === opt.value
                  ? 'bg-verde-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Separador + Botões de destaque */}
        {highlightMode !== undefined && onHighlightChange && (
          <>
            <span className="mx-1 h-4 w-px shrink-0 bg-gray-200" />
            <div className="flex flex-wrap gap-1">
              {([
                { value: 'me'    as HighlightMode, label: 'Destacar meu nome' },
                ...(showPanelaOption ? [{ value: 'panela' as HighlightMode, label: 'Destacar minha panela' }] : []),
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onHighlightChange(opt.value); onTribeSelect?.(null) }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    highlightMode === opt.value
                      ? 'bg-azul-escuro text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}

              {/* Botão Destacar Tribo — só aparece se houver tribos */}
              {tribes && tribes.length > 0 && onTribeSelect && (
                <div className="relative">
                  <button
                    onClick={() => setTribeOpen(o => !o)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      highlightMode === 'tribo'
                        ? 'bg-azul-escuro text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {highlightMode === 'tribo' && activeTribeId
                      ? (tribes.find(t => t.id === activeTribeId)?.name ?? 'Tribo')
                      : 'Destacar Tribo'} ▾
                  </button>
                  {tribeOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                      {tribes.map(t => (
                        <button
                          key={t.id}
                          onClick={() => { onTribeSelect(t.id); onHighlightChange('tribo'); setTribeOpen(false) }}
                          className={`flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-50 transition ${
                            activeTribeId === t.id ? 'font-semibold text-azul-escuro' : 'text-gray-700'
                          }`}
                        >
                          {t.name}
                        </button>
                      ))}
                      <div className="my-1 border-t border-gray-100" />
                      <button
                        onClick={() => { onTribeSelect(null); onHighlightChange('none'); setTribeOpen(false) }}
                        className="flex w-full items-center px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-50 transition"
                      >
                        Limpar destaque
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => { onHighlightChange('none'); onTribeSelect?.(null) }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  highlightMode === 'none'
                    ? 'bg-azul-escuro text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Sem destaques
              </button>
            </div>
          </>
        )}

        {/* Status */}
        {loading && (
          <span className="ml-1 animate-pulse text-[10px] text-gray-400">
            Carregando...
          </span>
        )}
        {!loading && dateRangeLabel && mode !== 'hidden' && (
          <span className="ml-1 text-[10px] text-gray-400">
            {dateRangeLabel}
          </span>
        )}
        {lastDataDate && (
          <span className="ml-auto text-[9px] text-gray-300" title="Última data com dados históricos disponíveis">
            dados até {formatDateBR(lastDataDate)}
          </span>
        )}
        {mode === 'current_round' && (
          <span className="ml-1 flex items-center gap-1 text-[10px] font-semibold text-verde-600">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-verde-500" />
            Ao vivo
          </span>
        )}
      </div>

      {/* Período personalizado */}
      {mode === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-3 py-2">
          <label className="shrink-0 text-xs font-medium text-gray-600">De:</label>
          <input
            type="date"
            value={customFrom}
            max={customTo || todayBR()}
            onChange={e => setCustomFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-verde-400"
          />
          <label className="shrink-0 text-xs font-medium text-gray-600">Até:</label>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={lastDataDate ?? todayBR()}
            onChange={e => setCustomTo(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-verde-400"
          />

          {/* Atalhos */}
          <button
            type="button"
            onClick={() => { setCustomFrom(subtractDays(todayBR(), 1)); setCustomTo(todayBR()) }}
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200"
          >
            Últimas 24h
          </button>
          <button
            type="button"
            onClick={() => { setCustomFrom(subtractDays(todayBR(), 7)); setCustomTo(todayBR()) }}
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200"
          >
            Últimos 7 dias
          </button>
        </div>
      )}

      {/* Aviso: sem dados históricos */}
      {!loading && mode !== 'hidden' && refDateLabel && !hasData && (
        <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-700">
          ⚠️ Sem dados disponíveis para o período selecionado.
          Use o botão <strong>&quot;Recalcular Pontos Diários&quot;</strong> no painel Admin → Classificação para popular o histórico.
        </p>
      )}
    </div>
  )
}

// ── EvoCell — célula de evolução de posição ────────────────────────────────────

interface EvoCellProps {
  delta:     DeltaEntry | undefined
  isMaxUp:   boolean
  isMaxDown: boolean
}

export function EvoCell({ delta, isMaxUp, isMaxDown }: EvoCellProps) {
  if (!delta) return <span className="text-[10px] text-gray-200">—</span>
  const { deltaRank } = delta
  if (deltaRank === 0) {
    return <span className="font-mono text-[10px] text-gray-400">▬</span>
  }
  if (deltaRank > 0) {
    return (
      <span
        title={`Subiu ${deltaRank} posição${deltaRank !== 1 ? 'ões' : ''}`}
        className={`inline-flex items-center gap-0 text-[11px] font-bold text-verde-600 ${
          isMaxUp ? 'rounded bg-verde-100 px-1' : ''
        }`}
      >
        ▲<span className="tabular-nums">{deltaRank}</span>
      </span>
    )
  }
  return (
    <span
      title={`Caiu ${Math.abs(deltaRank)} posição${Math.abs(deltaRank) !== 1 ? 'ões' : ''}`}
      className={`inline-flex items-center gap-0 text-[11px] font-bold text-red-500 ${
        isMaxDown ? 'rounded bg-red-100 px-1' : ''
      }`}
    >
      ▼<span className="tabular-nums">{Math.abs(deltaRank)}</span>
    </span>
  )
}

// ── DeltaPtsCell — pontos conquistados na janela ───────────────────────────────

interface DeltaPtsCellProps {
  delta:    DeltaEntry | undefined
  isMaxPts: boolean
  isMinPts: boolean
}

export function DeltaPtsCell({ delta, isMaxPts, isMinPts }: DeltaPtsCellProps) {
  if (!delta) return <span className="text-[10px] text-gray-200">—</span>
  const { deltaPts } = delta
  const color = deltaPts > 0 ? 'text-verde-600' : deltaPts < 0 ? 'text-red-500' : 'text-gray-400'
  const bg    = isMaxPts ? 'rounded bg-amber-100 px-1' : isMinPts ? 'rounded bg-gray-100 px-1' : ''
  return (
    <span className={`font-mono text-[11px] font-bold tabular-nums ${color} ${bg}`}>
      {deltaPts > 0 ? `+${deltaPts}` : deltaPts}
    </span>
  )
}
