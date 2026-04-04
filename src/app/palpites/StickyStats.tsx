interface Props {
  totalBets: number
  totalMatches: number
  activeRoundBets: number
  activeRoundTotal: number
  activeRound: number | null
  totalGroupBets: number
  thirdCount: number
  bonusCount: number
}

export function StickyStats({
  totalBets, totalMatches,
  activeRoundBets, activeRoundTotal, activeRound,
  totalGroupBets, thirdCount, bonusCount,
}: Props) {
  const roundPct  = activeRoundTotal > 0
    ? Math.min(100, Math.round((activeRoundBets / activeRoundTotal) * 100))
    : 0
  const complete  = roundPct === 100
  const barColor  = complete ? '#009c3b' : roundPct > 0 ? '#f59e0b' : '#374151'

  return (
    <div className="sticky top-14 z-40 border-b border-white/10 bg-gray-950/90 backdrop-blur-md">
      {/* ── Stats row ─────────────────────────────────────────── */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-1 overflow-x-auto px-4 py-2 scrollbar-thin">

        <StatItem
          icon="⚽"
          label="Jogos"
          value={totalBets}
          total={totalMatches}
        />

        <Divider />

        {activeRound !== null ? (
          <StatItem
            icon={`R${activeRound}`}
            label=""
            value={activeRoundBets}
            total={activeRoundTotal}
            highlight
            iconClass="rounded bg-amarelo-400/20 px-1 text-amarelo-300 font-black text-[10px]"
          />
        ) : (
          <StatItem icon="R" label="Rodada" value={0} total={0} />
        )}

        <Divider />

        <StatItem
          icon="👥"
          label="Grupos"
          value={totalGroupBets}
          total={12}
        />

        <Divider />

        <StatItem
          icon="🥉"
          label="Terceiros"
          value={thirdCount}
          total={8}
        />

        <Divider />

        <StatItem
          icon="🏆"
          label="Bônus"
          value={bonusCount}
          total={5}
        />
      </div>

      {/* ── Barra de progresso da rodada ──────────────────────── */}
      <div className="h-[3px] w-full bg-white/5">
        {activeRoundTotal > 0 && (
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${roundPct}%`, backgroundColor: barColor }}
          />
        )}
      </div>
    </div>
  )
}

function StatItem({
  icon, label, value, total, highlight = false, iconClass,
}: {
  icon: string
  label: string
  value: number
  total: number
  highlight?: boolean
  iconClass?: string
}) {
  const done = total > 0 && value === total
  return (
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
      <span className={iconClass ?? 'text-gray-400 text-xs'}>{icon}</span>
      <span className={`tabular-nums font-black text-sm ${
        done ? 'text-verde-400' : highlight ? 'text-amarelo-300' : 'text-white'
      }`}>
        {value}
      </span>
      <span className="text-xs text-gray-500">/{total}</span>
      {label && (
        <span className="hidden text-xs text-gray-500 sm:inline">{label}</span>
      )}
    </div>
  )
}

function Divider() {
  return <span className="text-gray-700 select-none">|</span>
}
