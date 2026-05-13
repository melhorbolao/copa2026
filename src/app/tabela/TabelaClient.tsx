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

// ── Mode do Mata-Mata ────────────────────────────────────────────────────────
//
// "empty"             — chaveamento limpo: nenhum time nos slots do R32.
// "from-jogos"        — preenchido pelos palpites de PLACAR da fase de grupos
//                       (effectiveStandings derivado dos placares do usuário).
// "from-classificados"— preenchido pelos palpites de CLASSIFICAÇÃO (1º/2º de
//                       cada grupo) + os 8 terceiros palpitados.
type BracketMode = 'empty' | 'from-jogos' | 'from-classificados'

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

  // Recalcula terceiros e slots com os standings efetivos
  const thirds       = useMemo(() => rankThirds(effectiveStandings), [effectiveStandings])
  const thirdSlots   = useMemo(() => resolveThirdSlots(thirds), [thirds])
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
      thirds={thirds}
      thirdSlots={thirdSlots}
      localGroupBets={localGroupBets}
      localThirdBets={localThirdBets}
      userId={userId}
      g4Deadline={g4Deadline}
      hasTournamentBet={hasTournamentBet}
      userAllGroupsComplete={userAllGroupsComplete}
      userCompleteGroups={userCompleteGroups}
    />
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// MataMataView: 3 botões de origem + chaveamento visual
// ──────────────────────────────────────────────────────────────────────────────

interface MataMataProps {
  effectiveStandings:    CalcGroupStanding[]
  thirds:                ReturnType<typeof rankThirds>
  thirdSlots:            Record<string, string> | null
  localGroupBets:        Record<string, { first_place: string; second_place: string }>
  localThirdBets:        Record<string, { team: string }>
  userId:                string
  g4Deadline:            string
  hasTournamentBet:      boolean
  userAllGroupsComplete: boolean
  userCompleteGroups:    string[]
}

function MataMataView({
  effectiveStandings, thirds, thirdSlots,
  localGroupBets, localThirdBets,
  userId, g4Deadline, hasTournamentBet,
  userAllGroupsComplete, userCompleteGroups,
}: MataMataProps) {
  const modeKey = `bracket_mode_v1_${userId}`
  const [mode, setMode]       = useState<BracketMode>('empty')
  const [modeLoaded, setLoad] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(modeKey)
      if (raw === 'from-jogos' || raw === 'from-classificados' || raw === 'empty') {
        setMode(raw)
      }
    } catch { /* ignore */ }
    setLoad(true)
  }, [modeKey])

  useEffect(() => {
    if (!modeLoaded) return
    try { localStorage.setItem(modeKey, mode) } catch { /* ignore */ }
  }, [mode, modeKey, modeLoaded])

  // Habilitação dos 2 botões "Preencher"
  const canFromJogos = userAllGroupsComplete
  const canFromClassificados = useMemo(() => {
    const groupsFilled = Object.values(localGroupBets).filter(
      b => b.first_place && b.second_place,
    ).length
    const thirdsFilled = Object.values(localThirdBets).filter(b => b.team && b.team.length > 0).length
    return groupsFilled === 12 && thirdsFilled === 8
  }, [localGroupBets, localThirdBets])

  // Slots do R32 conforme o mode escolhido
  const completeGroupsSet = useMemo(() => new Set(userCompleteGroups), [userCompleteGroups])

  // Para o modo "from-classificados", os 8 grupos cujos terceiros avançam vêm
  // dos PALPITES do usuário (localThirdBets), não da ordenação por pontos.
  // Construímos um array ThirdTeam sintético com advances=true apenas nesses
  // 8 grupos, para que resolveThirdSlots aplique o Anexo C corretamente.
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
    if (mode === 'empty') {
      // Slots vazios: passa standings vazias e completeGroups vazio para forçar null em todos.
      return buildR32Teams([], [], null, undefined, new Set(), false)
    }
    if (mode === 'from-jogos') {
      // Usa effectiveStandings (palpites de placar) sem override de classificados.
      // thirds/thirdSlots derivam dos pontos calculados — Anexo C aplicado
      // sobre os 8 melhores terceiros por pontuação.
      return buildR32Teams(
        effectiveStandings, thirds, thirdSlots, undefined,
        completeGroupsSet, userAllGroupsComplete,
      )
    }
    // mode === 'from-classificados': monta override com 1º/2º palpitados,
    // e usa os terceiros sintéticos (apenas os 8 grupos palpitados avançam)
    // para que o Anexo C posicione corretamente cada terceiro nos slots do R32.
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
  }, [
    mode, effectiveStandings, thirds, thirdSlots,
    classificadosThirds, classificadosThirdSlots,
    localGroupBets, completeGroupsSet, userAllGroupsComplete,
  ])

  const handleClear = () => setMode('empty')
  const handleFromJogos = () => { if (canFromJogos) setMode('from-jogos') }
  const handleFromClassificados = () => { if (canFromClassificados) setMode('from-classificados') }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
        <span className="text-sm font-black uppercase tracking-widest text-white">
          🏆 Meu Mata-Mata
        </span>
        <span className="ml-auto text-[11px] font-medium text-white/60">
          {mode === 'empty'             && 'chaveamento vazio'}
          {mode === 'from-jogos'        && 'baseado nos palpites dos jogos'}
          {mode === 'from-classificados' && 'baseado nos palpites dos classificados'}
        </span>
      </div>

      <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-3">
        <p className="mb-2 text-xs text-gray-500">
          Escolha como preencher os 16 avos. Vencedores das fases seguintes (oitavas, quartas, semis, final) você marca clicando em cada confronto.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleFromJogos}
            disabled={!canFromJogos}
            title={canFromJogos
              ? 'Usa os 1º e 2º calculados pelos seus palpites de placar de cada jogo da fase de grupos'
              : 'Habilita quando todos os 72 jogos da fase de grupos tiverem palpite de placar'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'from-jogos'
                ? 'bg-azul-escuro text-white shadow-sm'
                : canFromJogos
                  ? 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
                  : 'cursor-not-allowed bg-gray-100 text-gray-300 ring-1 ring-gray-100'
            }`}
          >
            Preencher com base nos palpites dos jogos
          </button>
          <button
            onClick={handleFromClassificados}
            disabled={!canFromClassificados}
            title={canFromClassificados
              ? 'Usa os palpites de 1º/2º de cada grupo e os 8 terceiros'
              : 'Habilita quando os 12 grupos tiverem 1º/2º palpitados E os 8 terceiros estiverem definidos'}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'from-classificados'
                ? 'bg-azul-escuro text-white shadow-sm'
                : canFromClassificados
                  ? 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
                  : 'cursor-not-allowed bg-gray-100 text-gray-300 ring-1 ring-gray-100'
            }`}
          >
            Preencher com base nos palpites dos classificados
          </button>
          <button
            onClick={handleClear}
            title="Limpa todos os times e vencedores escolhidos no chaveamento"
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              mode === 'empty'
                ? 'bg-azul-escuro text-white shadow-sm'
                : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            Limpar
          </button>
        </div>
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
  )
}
