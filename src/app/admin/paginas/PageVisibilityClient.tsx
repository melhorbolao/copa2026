'use client'

import { useState, useTransition, useRef } from 'react'
import { updatePageVisibility, updatePageLabel, updatePageOrders } from './actions'
import type { PageVisibilityRow } from '@/lib/page-visibility'

interface Props {
  rows: PageVisibilityRow[]
}

type RowState = Record<string, { show_for_admin: boolean; show_for_users: boolean; label: string }>

export function PageVisibilityClient({ rows }: Props) {
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ordered, setOrdered] = useState<PageVisibilityRow[]>(rows)
  const [state, setState] = useState<RowState>(() =>
    Object.fromEntries(rows.map(r => [r.page_name, {
      show_for_admin: r.show_for_admin,
      show_for_users: r.show_for_users,
      label: r.label,
    }]))
  )
  const labelTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleLabelChange(pageName: string, value: string) {
    setState(prev => ({ ...prev, [pageName]: { ...prev[pageName], label: value } }))
    clearTimeout(labelTimers.current[pageName])
    labelTimers.current[pageName] = setTimeout(() => {
      startTransition(async () => {
        const result = await updatePageLabel(pageName, value)
        if (result.error) {
          setErrors(prev => ({ ...prev, [`${pageName}-label`]: result.error! }))
        } else {
          setErrors(prev => { const next = { ...prev }; delete next[`${pageName}-label`]; return next })
        }
      })
    }, 600)
  }

  function handleChange(
    pageName: string,
    field: 'show_for_admin' | 'show_for_users',
    value: boolean,
  ) {
    setState(prev => ({ ...prev, [pageName]: { ...prev[pageName], [field]: value } }))
    startTransition(async () => {
      const result = await updatePageVisibility(pageName, field, value)
      if (result.error) {
        setState(prev => ({ ...prev, [pageName]: { ...prev[pageName], [field]: !value } }))
        setErrors(prev => ({ ...prev, [`${pageName}-${field}`]: result.error! }))
      } else {
        setErrors(prev => { const next = { ...prev }; delete next[`${pageName}-${field}`]; return next })
      }
    })
  }

  function onDragStart(index: number) {
    dragIndex.current = index
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setDragOver(index)
  }

  function onDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault()
    const from = dragIndex.current
    if (from === null || from === dropIndex) { setDragOver(null); return }

    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(dropIndex, 0, moved)
    setOrdered(next)
    setDragOver(null)
    dragIndex.current = null

    startTransition(async () => {
      const orders = next.map((r, i) => ({ page_name: r.page_name, sort_order: i + 1 }))
      const result = await updatePageOrders(orders)
      if (result.error) {
        setOrdered(ordered) // rollback
        setErrors(prev => ({ ...prev, order: result.error! }))
      } else {
        setErrors(prev => { const next = { ...prev }; delete next.order; return next })
      }
    })
  }

  function onDragEnd() {
    setDragOver(null)
    dragIndex.current = null
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      {errors.order && (
        <p className="px-4 py-2 text-xs text-red-500">{errors.order}</p>
      )}
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th className="px-3 py-3 w-8"></th>
            <th className="px-4 py-3 font-semibold text-gray-700">Página</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Admin</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Usuários</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ordered.map((row, index) => {
            const cur = state[row.page_name] ?? {
              show_for_admin: row.show_for_admin,
              show_for_users: row.show_for_users,
              label: row.label,
            }
            const isOver = dragOver === index
            return (
              <tr
                key={row.page_name}
                draggable
                onDragStart={() => onDragStart(index)}
                onDragOver={e => onDragOver(e, index)}
                onDrop={e => onDrop(e, index)}
                onDragEnd={onDragEnd}
                className={`transition ${isOver ? 'bg-verde-50 border-t-2 border-t-verde-400' : 'hover:bg-gray-50'}`}
              >
                <td className="px-3 py-3 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-center">
                  ⠿
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={cur.label}
                    onChange={e => handleLabelChange(row.page_name, e.target.value)}
                    className="rounded border border-gray-200 px-2 py-1 text-sm font-medium text-gray-800 focus:border-verde-400 focus:outline-none w-full max-w-[160px]"
                  />
                  {errors[`${row.page_name}-label`] && (
                    <p className="mt-0.5 text-xs text-red-500">{errors[`${row.page_name}-label`]}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <Checkbox
                    checked={cur.show_for_admin}
                    disabled={pending}
                    onChange={v => handleChange(row.page_name, 'show_for_admin', v)}
                    error={errors[`${row.page_name}-show_for_admin`]}
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <Checkbox
                    checked={cur.show_for_users}
                    disabled={pending}
                    onChange={v => handleChange(row.page_name, 'show_for_users', v)}
                    error={errors[`${row.page_name}-show_for_users`]}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {pending && (
        <p className="px-4 py-2 text-xs text-gray-400">Salvando…</p>
      )}
    </div>
  )
}

function Checkbox({
  checked,
  disabled,
  onChange,
  error,
}: {
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
  error?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-verde-600 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
