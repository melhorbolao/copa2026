'use client'

import { useEffect, useState } from 'react'
import { buildR32Teams } from '@/lib/bracket/engine'
import { BracketView } from './BracketView'
import type { CalcGroupStanding, ThirdTeam } from '@/lib/bracket/engine'

interface Props {
  standings:         CalcGroupStanding[]
  thirds:            ThirdTeam[]
  thirdSlots:        Record<string, string> | null
  // Palpites formais de 1º/2º do grupo (do banco) — como objeto serializável
  groupBetsOverride: Record<string, { first_place: string; second_place: string }>
  userId:            string
  g4Deadline:        string
  hasTournamentBet:  boolean
}

export function BracketSection({
  standings,
  thirds,
  thirdSlots,
  groupBetsOverride,
  userId,
  g4Deadline,
  hasTournamentBet,
}: Props) {
  // Calcula os slots iniciais sem override de localStorage (SSR-safe)
  const [r32Slots, setR32Slots] = useState(() =>
    buildR32Teams(
      standings,
      thirds,
      thirdSlots,
      new Map(Object.entries(groupBetsOverride)),
    )
  )

  useEffect(() => {
    // Mescla: palpites formais > ordem manual de empate > standings calculados
    const merged = new Map(Object.entries(groupBetsOverride))

    for (const standing of standings) {
      const { group, tiedTeams } = standing
      // Palpite formal tem prioridade — não sobrescreve
      if (merged.has(group)) continue
      // Sem empate: standings calculados já estão corretos
      if (tiedTeams.length === 0) continue

      // Lê ordem manual do localStorage
      const key = `tie_order_${userId}_${group}`
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const order: string[] = JSON.parse(raw)
        if (order.length >= 2) {
          merged.set(group, { first_place: order[0], second_place: order[1] })
        }
      } catch { /* ignore */ }
    }

    setR32Slots(buildR32Teams(standings, thirds, thirdSlots, merged))
  }, [standings, thirds, thirdSlots, groupBetsOverride, userId])

  return (
    <BracketView
      r32Slots={r32Slots}
      userId={userId}
      g4Deadline={g4Deadline}
      hasTournamentBet={hasTournamentBet}
    />
  )
}
