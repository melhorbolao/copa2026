'use client'

import { useState, useRef, useTransition } from 'react'
import { upsertTopScorerMapping, deleteTopScorerMapping, updateScorerElimination } from './actions'

interface Row {
  rawName: string
  standardizedName: string
  isEliminated: boolean
  status: 'idle' | 'saving' | 'saved' | 'error'
  error: string
}

interface Props {
  rawNames: string[]
  initialMappings: Record<string, string>
  initialEliminations: Record<string, boolean>
}

export function ArtilheirosClient({ rawNames, initialMappings, initialEliminations }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    rawNames.map(raw => ({
      rawName: raw,
      standardizedName: initialMappings[raw] ?? '',
      isEliminated: initialEliminations[raw] ?? false,
      status: 'idle' as const,
      error: '',
    }))
  )
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [, startTransition] = useTransition()

  const setRow = (rawName: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r.rawName === rawName ? { ...r, ...patch } : r))

  const scheduleSave = (rawName: string, value: string) => {
    clearTimeout(timers.current[rawName])
    setRow(rawName, { standardizedName: value, status: 'idle', error: '' })
    if (!value.trim()) return
    timers.current[rawName] = setTimeout(() => {
      setRow(rawName, { status: 'saving' })
      startTransition(async () => {
        const r = await upsertTopScorerMapping(rawName, value)
        setRow(rawName, r.error
          ? { status: 'error', error: r.error }
          : { status: 'saved', error: '' }
        )
      })
    }, 800)
  }

  const handleDelete = (rawName: string) => {
    clearTimeout(timers.current[rawName])
    setRow(rawName, { standardizedName: '', status: 'saving', error: '' })
    startTransition(async () => {
      const r = await deleteTopScorerMapping(rawName)
      setRow(rawName, r.error
        ? { status: 'error', error: r.error }
        : { status: 'idle', error: '' }
      )
    })
  }

  const handleElimination = (rawName: string, isEliminated: boolean) => {
    setRow(rawName, { isEliminated })
    startTransition(async () => {
      const r = await updateScorerElimination(rawName, isEliminated)
      if (r.error) setRow(rawName, { isEliminated: !isEliminated, error: r.error })
    })
  }

  if (rawNames.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
        Nenhum participante preencheu o campo de artilheiro ainda.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <th className="px-4 py-2.5 text-left">De (nome digitado)</th>
            <th className="px-4 py-2.5 text-left">Para (nome padronizado)</th>
            <th className="px-4 py-2.5 text-center w-24">Eliminado</th>
            <th className="px-4 py-2.5 text-left w-20">Status</th>
            <th className="px-4 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.rawName} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
              <td className="px-4 py-2.5 font-mono text-sm text-gray-700">{row.rawName}</td>
              <td className="px-4 py-2.5">
                <input
                  type="text"
                  value={row.standardizedName}
                  onChange={e => scheduleSave(row.rawName, e.target.value)}
                  placeholder="Digite o nome oficial…"
                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-verde-400 focus:outline-none"
                />
                {row.error && <p className="mt-0.5 text-xs text-red-500">{row.error}</p>}
              </td>
              <td className="px-4 py-2.5 text-center">
                {row.standardizedName ? (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.isEliminated}
                      onChange={e => handleElimination(row.rawName, e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 accent-red-500 cursor-pointer"
                    />
                    {row.isEliminated && (
                      <span className="text-xs font-medium text-red-500">Sim</span>
                    )}
                  </label>
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs">
                {row.status === 'saving' && <span className="text-gray-400">Salvando…</span>}
                {row.status === 'saved'  && <span className="text-verde-600 font-semibold">✓ Salvo</span>}
                {row.status === 'error'  && <span className="text-red-500">Erro</span>}
              </td>
              <td className="px-4 py-2.5">
                {row.standardizedName && (
                  <button
                    onClick={() => handleDelete(row.rawName)}
                    title="Remover mapeamento"
                    className="text-gray-300 hover:text-red-400 transition"
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
