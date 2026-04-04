interface Props {
  filled: number
  total: number
  round: number
}

export function RoundProgress({ filled, total, round }: Props) {
  if (!total) return null

  const pct      = Math.min(100, Math.round((filled / total) * 100))
  const complete = pct === 100

  const r    = 17
  const circ = 2 * Math.PI * r          // ≈ 106.8
  const dash = circ - (pct / 100) * circ

  const stroke = complete ? '#009c3b' : pct > 0 ? '#f59e0b' : '#d1d5db'

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative w-11 h-11">
        <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
          {/* trilha */}
          <circle cx="22" cy="22" r={r} fill="none" stroke="#f3f4f6" strokeWidth="4.5" />
          {/* progresso */}
          <circle
            cx="22" cy="22" r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="4.5"
            strokeDasharray={circ}
            strokeDashoffset={dash}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {complete
            ? <span className="text-sm font-black text-verde-600">✓</span>
            : <span className="text-[11px] font-black text-gray-700 tabular-nums">{pct}%</span>
          }
        </div>
      </div>
      <span className={`text-[10px] font-semibold whitespace-nowrap leading-tight ${
        complete ? 'text-verde-600' : 'text-gray-400'
      }`}>
        {complete ? `R${round} completa!` : `Rodada ${round}`}
      </span>
    </div>
  )
}
