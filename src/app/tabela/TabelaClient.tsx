'use client'

import { useState, useEffect, useMemo } from 'react'
import { GroupCard } from './GroupCard'
import { ThirdsTable } from './ThirdsTable'
import { BracketView } from './BracketView'
import {
  rankThirds,
  resolveThirdSlots,
  buildR32Teams,
} from '@/lib/bracket/engine'
import type { CalcGroupStanding } from '@/lib/bracket/engine'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

interface Props {
  standings:         CalcGroupStanding[]
  groupBetsOverride: Record<string, { first_place: string; second_place: string }>
  userId:            string
  g4Deadline:        string
  hasTournamentBet:  boolean
}

export function TabelaClient({
  standings,
  groupBetsOverride,
  userId,
  g4Deadline,
  hasTournamentBet,
}: Props) {
  const [manualOrders, setManualOrders] = useState<Record<string, string[]>>({})
  const [mounted, setMounted] = useState(false)

  // Carrega todas as ordens manuais do localStorage num único efeito
  useEffect(() => {
    const loaded: Record<string, string[]> = {}
    for (const standing of standings) {
      const key = `tie_order_${userId}_${standing.group}`
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const order: string[] = JSON.parse(raw)
          if (order.length === standing.teams.length) {
            loaded[standing.group] = order
          }
        }
      } catch { /* ignore */ }
    }
    setManualOrders(loaded)
    setMounted(true)
  }, [userId, standings])

  // Aplica as ordens manuais para obter standings efetivos
  const effectiveStandings = useMemo<CalcGroupStanding[]>(() => {
    return standings.map(standing => {
      const order = manualOrders[standing.group]
      if (!order) return standing
      const teamMap = new Map(standing.teams.map(t => [t.team, t]))
      const reordered = order.map(n => teamMap.get(n)).filter(Boolean) as typeof standing.teams
      if (reordered.length !== standing.teams.length) return standing
      // Após aplicar ordem manual, o empate é resolvido pelo usuário
      return { ...standing, teams: reordered, tiedTeams: [] }
    })
  }, [standings, manualOrders])

  // Recalcula terceiros e slots com os standings efetivos
  const thirds     = useMemo(() => rankThirds(effectiveStandings), [effectiveStandings])
  const thirdSlots = useMemo(() => resolveThirdSlots(thirds), [thirds])

  // Monta o override completo: palpite formal > ordem efetiva
  const r32Slots = useMemo(() => {
    const merged = new Map<string, { first_place: string; second_place: string }>()
    for (const standing of effectiveStandings) {
      const formal = groupBetsOverride[standing.group]
      const first  = formal?.first_place  || standing.teams[0]?.team || ''
      const second = formal?.second_place || standing.teams[1]?.team || ''
      merged.set(standing.group, { first_place: first, second_place: second })
    }
    return buildR32Teams(effectiveStandings, thirds, thirdSlots, merged)
  }, [effectiveStandings, thirds, thirdSlots, groupBetsOverride])

  const advancingThirdGroups = useMemo(
    () => new Set(thirds.filter(t => t.advances).map(t => t.group)),
    [thirds],
  )

  const handleOrderChange = (group: string, order: string[]) => {
    setManualOrders(prev => ({ ...prev, [group]: order }))
  }

  const handleOrderReset = (group: string) => {
    setManualOrders(prev => {
      const next = { ...prev }
      delete next[group]
      return next
    })
  }

  const sortedStandings = GROUP_ORDER
    .map(g => effectiveStandings.find(s => s.group === g))
    .filter(Boolean) as CalcGroupStanding[]

  return (
    <>
      {/* Grade de grupos — 2 colunas em telas médias */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 mb-8">
        {sortedStandings.map(standing => (
          <GroupCard
            key={standing.group}
            standing={standing}
            advancingGroups={advancingThirdGroups}
            userId={userId}
            originalTiedTeams={
              standings.find(s => s.group === standing.group)?.tiedTeams ?? []
            }
            manualOrder={mounted ? (manualOrders[standing.group] ?? null) : null}
            onOrderChange={order => handleOrderChange(standing.group, order)}
            onOrderReset={() => handleOrderReset(standing.group)}
          />
        ))}
      </div>

      {/* Melhores terceiros */}
      {thirds.length > 0 && (
        <div className="mb-8">
          <ThirdsTable thirds={thirds} />
        </div>
      )}

      {/* Chaveamento visual */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
          <span className="text-sm font-black uppercase tracking-widest text-white">
            🏆 Chaveamento — Mata-Mata — USO OPCIONAL
          </span>
          <span className="ml-auto text-[11px] font-medium text-white/60">
            baseado nos seus palpites
          </span>
        </div>
        <div className="p-4">
          <BracketView
            r32Slots={r32Slots}
            userId={userId}
            g4Deadline={g4Deadline}
            hasTournamentBet={hasTournamentBet}
          />
        </div>
      </div>
    </>
  )
}
