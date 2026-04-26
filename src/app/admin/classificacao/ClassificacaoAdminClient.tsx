'use client'

import { useState, useTransition } from 'react'
import { updateClassifColVisibility } from './actions'

interface ColDef {
  key: string
  label: string
  description: string
  enabled: boolean
}

export function ClassificacaoAdminClient({ cols }: { cols: ColDef[] }) {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(cols.map(c => [c.key, c.enabled]))
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  const toggle = (key: string) => {
    const next = !state[key]
    setState(prev => ({ ...prev, [key]: next }))
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
    startTransition(async () => {
      const res = await updateClassifColVisibility(key, next)
      if (res.error) {
        setState(prev => ({ ...prev, [key]: !next }))
        setErrors(prev => ({ ...prev, [key]: res.error! }))
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
      {cols.map(col => (
        <div key={col.key} className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-800">{col.label}</p>
            <p className="mt-0.5 text-xs text-gray-400">{col.description}</p>
            {errors[col.key] && (
              <p className="mt-1 text-xs text-red-500">{errors[col.key]}</p>
            )}
          </div>
          <button
            onClick={() => toggle(col.key)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              state[col.key] ? 'bg-verde-600' : 'bg-gray-200'
            }`}
            role="switch"
            aria-checked={state[col.key]}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                state[col.key] ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  )
}
