'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { GroupCard } from './GroupCard'
import { ThirdsTable } from './ThirdsTable'
import { BracketView } from './BracketView'
import {
  rankThirds,
  resolveThirdSlots,
  buildR32Teams,
  findAnnexeCOption,
} from '@/lib/bracket/engine'
import type { CalcGroupStanding, ThirdTeam } from '@/lib/bracket/engine'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

export type TabelaView = 'classificacao' | 'mata-mata'

interface Props {
  view:                TabelaView
  standings:           CalcGroupStanding[]
  groupBetsOverride:   Record<string, { first_place: string; second_place: string }>
  thirdBetsOverride:   Record<string, { team: string }>
  userId:              string
  g4Deadline:          string
  hasTournamentBet:    boolean
  groupAllBetsFilled:  Record<string, boolean>
  // Quais grupos têm TODOS os jogos com palpite do usuário (guard do bracket).
  userCompleteGroups:  string[]
  userAllGroupsComplete: boolean
}

export function TabelaClient({
  view,
  standings,
  groupBetsOverride,
  thirdBetsOverride,
  userId,
  g4Deadline,
  hasTournamentBet,
  groupAllBetsFilled,
  userCompleteGroups,
  userAllGroupsComplete,
}: Props) {
  const [manualOrders, setManualOrders] = useState<Record<string, string[]>>({})
  const [mounted, setMounted] = useState(false)

  // Override local dos palpites — atualizado quando o usuário confirma "Atualizar palpites"
  const [localGroupBets, setLocalGroupBets] = useState(groupBetsOverride)
  const [localThirdBets, setLocalThirdBets] = useState(thirdBetsOverride)

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

  // Recalcula terceiros com os standings efetivos
  const thirds       = useMemo(() => rankThirds(effectiveStandings), [effectiveStandings])
  const annexCOption = useMemo(() => {
    const adv = thirds.filter(t => t.advances).map(t => t.group)
    return adv.length === 8 ? findAnnexeCOption(adv) : null
  }, [thirds])

  const advancingThirdGroups = useMemo(
    () => new Set(thirds.filter(t => t.advances).map(t => t.group)),
    [thirds],
  )

  const handleOrderChange = useCallback((group: string, order: string[]) => {
    setManualOrders(prev => ({ ...prev, [group]: order }))
  }, [])

  const handleOrderReset = useCallback((group: string) => {
    setManualOrders(prev => {
      const next = { ...prev }
      delete next[group]
      return next
    })
  }, [])

  const handleBetUpdate = useCallback((
    group: string,
    groupBet: { first_place: string; second_place: string } | null,
    thirdBet: { team: string } | null,
  ) => {
    if (groupBet) setLocalGroupBets(prev => ({ ...prev, [group]: groupBet }))
    if (thirdBet) setLocalThirdBets(prev => ({ ...prev, [group]: thirdBet }))
  }, [])

  const sortedStandings = useMemo(
    () => GROUP_ORDER.map(g => effectiveStandings.find(s => s.group === g)).filter(Boolean) as CalcGroupStanding[],
    [effectiveStandings],
  )

  if (view === 'classificacao') {
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
              allMatchesBet={groupAllBetsFilled[standing.group] ?? false}
              formalBet={localGroupBets[standing.group] ?? null}
              thirdPlaceBet={localThirdBets[standing.group] ?? null}
              manualOrder={mounted ? (manualOrders[standing.group] ?? null) : null}
              onOrderChange={order => handleOrderChange(standing.group, order)}
              onOrderReset={() => handleOrderReset(standing.group)}
              onBetUpdate={(gb, tb) => handleBetUpdate(standing.group, gb, tb)}
            />
          ))}
        </div>

        {/* Melhores terceiros */}
        {thirds.length > 0 && (
          <div className="mb-2">
            <ThirdsTable thirds={thirds} annexCOption={annexCOption} />
          </div>
        )}
      </>
    )
  }

  return (
    <MataMataView
      effectiveStandings={effectiveStandings}
      localGroupBets={localGroupBets}
      localThirdBets={localThirdBets}
      userId={userId}
      g4Deadline={g4Deadline}
      hasTournamentBet={hasTournamentBet}
    />
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// MataMataView: chaveamento somente leitura, baseado nos palpites de classificados
// ──────────────────────────────────────────────────────────────────────────────

interface MataMataProps {
  effectiveStandings: CalcGroupStanding[]
  localGroupBets:     Record<string, { first_place: string; second_place: string }>
  localThirdBets:     Record<string, { team: string }>
  userId:             string
  g4Deadline:         string
  hasTournamentBet:   boolean
}

function MataMataView({
  effectiveStandings,
  localGroupBets, localThirdBets,
  userId, g4Deadline, hasTournamentBet,
}: MataMataProps) {
  // Deriva o bracket dos palpites de classificados do usuário (somente leitura).
  const findFlag = useCallback((group: string, teamName: string): string => {
    const s = effectiveStandings.find(st => st.group === group)
    return s?.teams.find(t => t.team === teamName)?.flag ?? ''
  }, [effectiveStandings])

  const classificadosThirds = useMemo<ThirdTeam[]>(() => {
    return GROUP_ORDER.map((g, idx) => {
      const bet = localThirdBets[g]
      const team = bet?.team ?? ''
      return {
        team,
        flag: team ? findFlag(g, team) : '',
        gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
        group: g, rank: idx + 1,
        advances: !!team,
      }
    })
  }, [localThirdBets, findFlag])

  const classificadosThirdSlots = useMemo(
    () => resolveThirdSlots(classificadosThirds),
    [classificadosThirds],
  )

  const r32Slots = useMemo(() => {
    const merged = new Map<string, { first_place: string; second_place: string }>()
    for (const standing of effectiveStandings) {
      const formal = localGroupBets[standing.group]
      if (formal?.first_place && formal?.second_place) {
        merged.set(standing.group, formal)
      }
    }
    return buildR32Teams(
      effectiveStandings, classificadosThirds, classificadosThirdSlots, merged,
      new Set(GROUP_ORDER), true,
    )
  }, [effectiveStandings, classificadosThirds, classificadosThirdSlots, localGroupBets])

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="px-4 py-3" style={{ backgroundColor: '#002776' }}>
        <span className="text-sm font-black uppercase tracking-widest text-white">
          🏆 Meu Mata-Mata
        </span>
      </div>

      <div className="p-4">
        <BracketView
          r32Slots={r32Slots}
          userId={userId}
          g4Deadline={g4Deadline}
          hasTournamentBet={hasTournamentBet}
          readOnly
        />
      </div>
    </div>
  )
}
