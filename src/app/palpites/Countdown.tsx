'use client'

import { useEffect, useState } from 'react'

interface Props {
  deadline: string   // ISO string
  label: string      // ex: "Rodada 1"
}

function calc(deadline: string) {
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return null
  const d = Math.floor(diff / 86_400_000)
  const h = Math.floor((diff % 86_400_000) / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1_000)
  return { d, h, m, s }
}

export function Countdown({ deadline, label }: Props) {
  const [time, setTime] = useState(() => calc(deadline))

  useEffect(() => {
    const id = setInterval(() => setTime(calc(deadline)), 60_000)
    return () => clearInterval(id)
  }, [deadline])

  if (!time) return null

  return (
    <div className="flex items-center gap-2 rounded-xl border border-amarelo-300 bg-amarelo-50 px-3 py-2">
      <span className="text-xs font-semibold text-amarelo-800 whitespace-nowrap">
        ⏱ Prazo {label}
      </span>
      <div className="flex items-center gap-1 font-mono text-sm font-black text-amarelo-900">
        {time.d > 0 && (
          <>
            <Unit value={time.d} label="d" />
            <Sep />
          </>
        )}
        <Unit value={time.h} label="h" />
        <Sep />
        <Unit value={time.m} label="m" />
      </div>
    </div>
  )
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="tabular-nums">{String(value).padStart(2, '0')}</span>
      <span className="text-[10px] font-semibold text-amarelo-700">{label}</span>
    </span>
  )
}

function Sep() {
  return <span className="text-amarelo-500 opacity-60">:</span>
}
