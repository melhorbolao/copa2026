'use client'

import { useEffect, useState } from 'react'
import { secondsUntil } from '@/utils/date'

interface CountdownProps {
  deadline: string | Date
  label?: string
  onExpire?: () => void
}

function formatTime(totalSeconds: number) {
  const days    = Math.floor(totalSeconds / 86400)
  const hours   = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}min`
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function Countdown({ deadline, label = 'Prazo:', onExpire }: CountdownProps) {
  const [seconds, setSeconds] = useState(() => secondsUntil(deadline))

  useEffect(() => {
    if (seconds <= 0) return

    const id = setInterval(() => {
      setSeconds((s) => {
        const next = s - 1
        if (next <= 0) {
          clearInterval(id)
          onExpire?.()
          return 0
        }
        return next
      })
    }, 1000)

    return () => clearInterval(id)
  }, [deadline, onExpire, seconds])

  const expired = seconds <= 0
  const urgent  = seconds <= 3600 && !expired  // último 1h

  if (expired) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
        <span>🔒</span>
        <span>Prazo encerrado — palpites bloqueados</span>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
        urgent
          ? 'bg-red-50 text-red-700'
          : 'bg-amarelo-50 text-amarelo-800'
      }`}
    >
      <span>⏱</span>
      <span>{label}</span>
      <span className={`font-mono font-bold ${urgent ? 'text-red-600' : 'text-amarelo-700'}`}>
        {formatTime(seconds)}
      </span>
    </div>
  )
}
