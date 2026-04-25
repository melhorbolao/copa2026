'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

export function GroupFilter() {
  const router = useRouter()
  const sp     = useSearchParams()
  const active = sp.get('grupo') ?? ''

  const set = (g: string) => {
    const params = new URLSearchParams(sp.toString())
    if (g) params.set('grupo', g)
    else   params.delete('grupo')
    router.replace(`/palpites?${params.toString()}`)
  }

  const btn = (label: string, value: string) => {
    const isActive = active === value
    return (
      <button
        key={value}
        onClick={() => set(value)}
        className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
          isActive
            ? 'bg-verde-600 text-white shadow-sm'
            : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {btn('Todos', '')}
      {GROUPS.map(g => btn(`Gr. ${g}`, g))}
    </div>
  )
}
