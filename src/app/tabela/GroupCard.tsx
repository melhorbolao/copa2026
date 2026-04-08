'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import type { CalcGroupStanding, TeamRow } from '@/lib/bracket/engine'

interface Props {
  standing: CalcGroupStanding
  advancingGroups: Set<string>
  userId: string
}

const POS_COLORS = [
  'bg-verde-600 text-white',
  'bg-azul-escuro text-white',
  'bg-amber-400 text-amber-900',
  'bg-gray-200 text-gray-600',
]

export function GroupCard({ standing, advancingGroups, userId }: Props) {
  const storageKey = `tie_order_${userId}_${standing.group}`
  const hasTie = standing.tiedTeams.length > 0

  const [manualOrder, setManualOrder] = useState<string[] | null>(null)
  const [mounted,     setMounted]     = useState(false)
  const [dragOver,    setDragOver]    = useState<number | null>(null)
  const dragIdx = useRef<number | null>(null)

  useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setManualOrder(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [storageKey])

  // Aplica a ordem manual se existir; caso contrário usa a ordem calculada
  const displayTeams = useMemo<TeamRow[]>(() => {
    if (!mounted || !manualOrder) return standing.teams
    const teamMap = new Map(standing.teams.map(t => [t.team, t]))
    const ordered = manualOrder.map(n => teamMap.get(n)).filter(Boolean) as TeamRow[]
    // Garante que todos os times aparecem (caso o standing tenha mudado)
    if (ordered.length !== standing.teams.length) return standing.teams
    return ordered
  }, [standing.teams, manualOrder, mounted])

  const saveOrder = (teams: TeamRow[]) => {
    const order = teams.map(t => t.team)
    setManualOrder(order)
    try { localStorage.setItem(storageKey, JSON.stringify(order)) } catch { /* ignore */ }
  }

  const resetOrder = () => {
    setManualOrder(null)
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }

  // Drag handlers — só ativos quando há empate
  const handleDragStart = (i: number) => { dragIdx.current = i }
  const handleDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const handleDragEnd   = () => { dragIdx.current = null; setDragOver(null) }

  const handleDrop = (i: number) => {
    if (dragIdx.current === null || dragIdx.current === i) {
      dragIdx.current = null; setDragOver(null); return
    }
    const next = [...displayTeams]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    saveOrder(next)
    dragIdx.current = null
    setDragOver(null)
  }

  const isManuallyOrdered = mounted && manualOrder !== null
  const isTied   = (team: TeamRow) => standing.tiedTeams.includes(team.team)
  const third     = displayTeams[2]
  const thirdAdv  = third && advancingGroups.has(standing.group)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: '#002776' }}>
        <span className="text-sm font-black uppercase tracking-widest text-white">
          Grupo {standing.group}
        </span>
        {hasTie && !isManuallyOrdered && (
          <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-900">
            ⚠️ Empate — arraste para definir
          </span>
        )}
        {isManuallyOrdered && (
          <button
            onClick={resetOrder}
            className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/30"
          >
            ↺ Resetar ordem
          </button>
        )}
      </div>

      {/* Aviso de empate */}
      {hasTie && !isManuallyOrdered && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>Empate nos critérios 1–6 da FIFA</strong> entre{' '}
          {[...standing.tiedTeams].join(' e ')}.{' '}
          Arraste as linhas para definir manualmente (simula Ranking FIFA ou Cartões).
        </div>
      )}

      {/* Tabela */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-gray-400">
            {hasTie && <th className="w-4 px-1 py-1.5" />}
            <th className="w-6 px-2 py-1.5 text-center font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Seleção</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">J</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">V</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">E</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">D</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GP</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GC</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">SG</th>
            <th className="w-8 px-2 py-1.5 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {displayTeams.map((team, i) => {
            const isThirdAdv = i === 2 && thirdAdv
            const tied       = isTied(team)
            const draggable  = hasTie // qualquer linha é arrastável quando há empate

            return (
              <tr
                key={team.team}
                draggable={draggable}
                onDragStart={draggable ? () => handleDragStart(i) : undefined}
                onDragOver={draggable  ? e => handleDragOver(e, i) : undefined}
                onDrop={draggable      ? () => handleDrop(i) : undefined}
                onDragEnd={draggable   ? handleDragEnd : undefined}
                className={[
                  'border-t border-gray-100 transition',
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40',
                  dragOver === i  ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : '',
                  draggable       ? 'cursor-grab active:cursor-grabbing select-none' : '',
                ].join(' ')}
              >
                {/* Handle de drag */}
                {hasTie && (
                  <td className="px-1 py-2 text-center text-gray-300">
                    {tied ? '⠿' : <span className="opacity-30">⠿</span>}
                  </td>
                )}

                {/* Posição */}
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                      tied && !isManuallyOrdered
                        ? 'bg-amber-400 text-amber-900'
                        : i === 2
                          ? (isThirdAdv ? 'bg-amber-400 text-amber-900' : 'bg-gray-200 text-gray-600')
                          : POS_COLORS[i]
                    }`}
                  >
                    {tied && !isManuallyOrdered ? '?' : i + 1}
                  </span>
                </td>

                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <Flag code={team.flag} size="sm" />
                    <span className={`font-medium ${i < 2 ? 'text-gray-900' : 'text-gray-600'}`}>
                      {team.team}
                    </span>
                  </div>
                </td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gp}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.w}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.d}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.l}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gf}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.ga}</td>
                <td className={`px-1 py-2 text-center font-medium ${team.gd > 0 ? 'text-verde-600' : team.gd < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  {team.gd > 0 ? `+${team.gd}` : team.gd}
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`font-black ${i < 2 || isThirdAdv ? 'text-gray-900' : 'text-gray-500'}`}>
                    {team.pts}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50 px-3 py-2">
        <LegendItem color="bg-verde-600"    label="Classificado (1º)" />
        <LegendItem color="bg-azul-escuro"  label="Classificado (2º)" />
        {thirdAdv && <LegendItem color="bg-amber-400" label="Melhor 3º" />}
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}
