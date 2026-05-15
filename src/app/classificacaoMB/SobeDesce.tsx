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
  maxPtsId:  string | null   // maior pontuação no período
  minPtsId:  string | null   // menor pontuação (pode ser negativo)
  maxUpId:   string | null   // maior subida
  maxDownId: string | null   // maior queda
}

export interface UseSobeDesceReturn {
  mode:          SobeDesceMode
  setMode:       (m: SobeDesceMode) => void
  customFrom:    string
  setCustomFrom: (d: string) => void
  deltaMap:      Map<string, DeltaEntry> | null
  loading:       boolean
  highlights:    SobeDesceHighlights
  refDateLabel:  string
  hasData:       boolean
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
  } catch { return [] }
}

// ── Hook principal ─────────────────────────────────────────────────────────────

interface UseSobeDesceOptions {
  lastResultDate:        string | null
  currentPhaseStartDate: string | null
  /** Array estável (memoizado no componente pai) */
  rankedRows: ReadonlyArray<{ id: string; pts: number; rank: number }>
}

export function useSobeDesce({
  lastResultDate,
  currentPhaseStartDate,
  rankedRows,
}: UseSobeDesceOptions): UseSobeDesceReturn {
  const router = useRouter()

  const [mode,        setMode]        = useState<SobeDesceMode>('hidden')
  const [customFrom,  setCustomFrom]  = useState(() => subtractDays(todayBR(), 7))
  const [snapshots,   setSnapshots]   = useState<SnapshotEntry[] | null>(null)
  const [loading,     setLoading]     = useState(false)

  // Data de referência derivada do modo
  const refDate = useMemo((): string | null => {
    switch (mode) {
      case 'last_day':
        return lastResultDate        ? subtractDays(lastResultDate,        1) : null
      case 'current_round':
        return currentPhaseStartDate ? subtractDays(currentPhaseStartDate, 1) : null
      case 'custom':
        return customFrom || null
      default:
        return null
    }
  }, [mode, lastResultDate, currentPhaseStartDate, customFrom])

  const refDateLabel = refDate ? formatDateBR(refDate) : ''

  // Busca snapshot quando a data de referência muda
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
    const byPid = new Map(snapshots.map(s => [s.participant_id, s]))
    const map   = new Map<string, DeltaEntry>()
    for (const row of rankedRows) {
      const ref = byPid.get(row.id)
      if (ref) {
        map.set(row.id, {
          deltaRank: ref.rank   - row.rank,     // positivo = subiu
          deltaPts:  row.pts    - ref.pts_total, // positivo = ganhou
        })
      }
    }
    return map.size > 0 ? map : null
  }, [snapshots, rankedRows, mode])

  // Destaques
  const highlights = useMemo((): SobeDesceHighlights => {
    const none: SobeDesceHighlights = { maxPtsId: null, minPtsId: null, maxUpId: null, maxDownId: null }
    if (!deltaMap || deltaMap.size === 0) return none

    let maxPts = -Infinity, minPts = Infinity
    let maxUp  = -Infinity, maxDown = Infinity
    let maxPtsId: string|null = null, minPtsId: string|null = null
    let maxUpId:  string|null = null, maxDownId: string|null = null

    for (const [id, d] of deltaMap.entries()) {
      if (d.deltaPts  > maxPts)  { maxPts  = d.deltaPts;   maxPtsId  = id }
      if (d.deltaPts  < minPts)  { minPts  = d.deltaPts;   minPtsId  = id }
      if (d.deltaRank > maxUp)   { maxUp   = d.deltaRank;  maxUpId   = id }
      if (d.deltaRank < maxDown) { maxDown = d.deltaRank;  maxDownId = id }
    }

    return {
      maxPtsId:  maxPts  > 0 ? maxPtsId  : null,
      minPtsId:  minPts  < 0 ? minPtsId  : null,
      maxUpId:   maxUp   > 0 ? maxUpId   : null,
      maxDownId: maxDown < 0 ? maxDownId : null,
    }
  }, [deltaMap])

  return {
    mode, setMode,
    customFrom, setCustomFrom,
    deltaMap, loading,
    highlights, refDateLabel,
    hasData: deltaMap !== null,
  }
}

// ── SobeDesceSelector ──────────────────────────────────────────────────────────

interface SobeDesceSelectorProps {
  mode:                  SobeDesceMode
  setMode:               (m: SobeDesceMode) => void
  customFrom:            string
  setCustomFrom:         (d: string) => void
  loading:               boolean
  refDateLabel:          string
  hasData:               boolean
  lastResultDate:        string | null
  currentPhaseStartDate: string | null
}

export function SobeDesceSelector({
  mode, setMode,
  customFrom, setCustomFrom,
  loading, refDateLabel, hasData,
  lastResultDate, currentPhaseStartDate,
}: SobeDesceSelectorProps) {
  const options: { value: SobeDesceMode; label: string; title: string; disabled?: boolean }[] = [
    {
      value: 'hidden',
      label: 'Ocultar Sobe e Desce',
      title: 'Remove as colunas de evolução',
    },
    {
      value:    'last_day',
      label:    'Último dia de resultados',
      title:    'Comparação com o estado antes dos últimos resultados',
      disabled: !lastResultDate,
    },
    {
      value:    'current_round',
      label:    'Rodada em andamento',
      title:    'Evolução desde o início da fase atual',
      disabled: !currentPhaseStartDate,
    },
    {
      value: 'custom',
      label: 'Período Personalizado',
      title: 'Escolha a data de início da comparação',
    },
  ]

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {/* Label */}
        <span className="shrink-0 text-xs font-bold text-gray-600">📈 Sobe e Desce:</span>

        {/* Botões de modo */}
        <div className="flex flex-wrap gap-1">
          {options.map(opt => (
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

        {/* Status */}
        {loading && (
          <span className="ml-1 animate-pulse text-[10px] text-gray-400">
            Carregando...
          </span>
        )}
        {!loading && refDateLabel && mode !== 'hidden' && (
          <span className="ml-1 text-[10px] text-gray-400">
            desde {refDateLabel}
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
            max={todayBR()}
            onChange={e => setCustomFrom(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-verde-400"
          />
          <span className="text-xs text-gray-400">Até: agora</span>

          {/* Atalhos */}
          <button
            type="button"
            onClick={() => setCustomFrom(subtractDays(todayBR(), 1))}
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200"
          >
            Últimas 24h
          </button>
          <button
            type="button"
            onClick={() => setCustomFrom(subtractDays(todayBR(), 7))}
            className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-200"
          >
            Últimos 7 dias
          </button>
        </div>
      )}

      {/* Aviso: sem snapshot */}
      {!loading && mode !== 'hidden' && refDateLabel && !hasData && (
        <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-700">
          ⚠️ Sem snapshot disponível para {refDateLabel}.
          Use o botão <strong>&quot;Capturar Snapshot Diário&quot;</strong> no painel Admin → Classificação para iniciar o histórico.
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
