'use client'

import { useState, useTransition } from 'react'
import { updatePageVisibility } from './actions'
import type { PageVisibilityRow } from '@/lib/page-visibility'

interface Props {
  rows: PageVisibilityRow[]
}

type RowState = Record<string, { show_for_admin: boolean; show_for_users: boolean }>

export function PageVisibilityClient({ rows }: Props) {
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [state, setState] = useState<RowState>(() =>
    Object.fromEntries(rows.map(r => [r.page_name, {
      show_for_admin: r.show_for_admin,
      show_for_users: r.show_for_users,
    }]))
  )

  function handleChange(
    pageName: string,
    field: 'show_for_admin' | 'show_for_users',
    value: boolean,
  ) {
    // Optimistic update
    setState(prev => ({
      ...prev,
      [pageName]: { ...prev[pageName], [field]: value },
    }))

    startTransition(async () => {
      const result = await updatePageVisibility(pageName, field, value)
      if (result.error) {
        // Rollback
        setState(prev => ({
          ...prev,
          [pageName]: { ...prev[pageName], [field]: !value },
        }))
        setErrors(prev => ({ ...prev, [`${pageName}-${field}`]: result.error! }))
      } else {
        setErrors(prev => {
          const next = { ...prev }
          delete next[`${pageName}-${field}`]
          return next
        })
      }
    })
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-left">
            <th className="px-4 py-3 font-semibold text-gray-700">Página</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Admin</th>
            <th className="px-4 py-3 text-center font-semibold text-gray-700">Usuários</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(row => {
            const cur = state[row.page_name] ?? { show_for_admin: row.show_for_admin, show_for_users: row.show_for_users }
            return (
              <tr key={row.page_name} className="hover:bg-gray-50 transition">
                <td className="px-4 py-3 font-medium text-gray-800">{row.label}</td>
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
