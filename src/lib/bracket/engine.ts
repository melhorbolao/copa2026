/**
 * Motor de cálculo do chaveamento baseado nos palpites do usuário.
 *
 * Regras FIFA 2026:
 * - Classificação por grupo (Art. 13): Pts → H2H (Pts/DG/GP) → DG global → GP global → [manual]
 * - Melhores 8 terceiros (Art. 13): Pts → DG → GP → Vitórias → alfabético
 * - Chaveamento (Anexo C): 495 combinações possíveis de 8 terceiros
 */

import { findAnnexeC } from './annexe_c'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface TeamRow {
  team: string
  flag: string
  gp: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  gd: number
  pts: number
}

export interface CalcGroupStanding {
  group: string
  teams: TeamRow[]      // sorted: [0]=1st … [3]=4th
  tiedTeams: string[]   // nomes dos times ainda empatados após todos os critérios FIFA
}

export interface ThirdTeam extends TeamRow {
  group: string
  rank: number      // 1–12
  advances: boolean // true para os melhores 8
}

export interface MatchSlim {
  id: string
  group_name: string | null
  phase: string
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
}

export interface BetSlim {
  match_id: string
  score_home: number
  score_away: number
}

// Slot do R32 → descrição (para exibição)
export const R32_SLOT_LABELS: Record<string, string> = {
  '1A': 'M79 – 1º A',
  '1B': 'M85 – 1º B',
  '1D': 'M81 – 1º D',
  '1E': 'M74 – 1º E',
  '1G': 'M82 – 1º G',
  '1I': 'M77 – 1º I',
  '1K': 'M87 – 1º K',
  '1L': 'M80 – 1º L',
}

// R32 completo (16 partidas) conforme Art. 12.6
// "slot" pode ser "1X" (vencedor do grupo X), "2X" (2º do grupo X)
// ou "3rd:ABCDF" (melhor 3º dos grupos listados — resolvido pelo Anexo C)
export interface R32MatchDef {
  matchNum: string   // ex: "M73"
  slotA: string      // ex: "2A" | "1E" | "3rd:ABCDF"
  slotB: string
}

// Ordem de exibição do chaveamento (16avos), organizada em 4 blocos de 4.
// Bloco 1: 2A, 1F, 1E, 1I
// Bloco 2: 1H, 2K, 1G, 1D
// Bloco 3: 1C, 2E, 1A, 1L
// Bloco 4: 2D, 1J, 1B, 1K
export const R32_MATCHES: R32MatchDef[] = [
  // Bloco 1
  { matchNum: 'M73', slotA: '2A', slotB: '2B' },
  { matchNum: 'M75', slotA: '1F', slotB: '2C' },
  { matchNum: 'M74', slotA: '1E', slotB: '3rd:ABCDF' },
  { matchNum: 'M77', slotA: '1I', slotB: '3rd:CDFGH' },
  // Bloco 2
  { matchNum: 'M84', slotA: '1H', slotB: '2J' },
  { matchNum: 'M83', slotA: '2K', slotB: '2L' },
  { matchNum: 'M82', slotA: '1G', slotB: '3rd:AEHIJ' },
  { matchNum: 'M81', slotA: '1D', slotB: '3rd:BEFIJ' },
  // Bloco 3
  { matchNum: 'M76', slotA: '1C', slotB: '2F' },
  { matchNum: 'M78', slotA: '2E', slotB: '2I' },
  { matchNum: 'M79', slotA: '1A', slotB: '3rd:CEFHI' },
  { matchNum: 'M80', slotA: '1L', slotB: '3rd:EHIJK' },
  // Bloco 4
  { matchNum: 'M88', slotA: '2D', slotB: '2G' },
  { matchNum: 'M86', slotA: '1J', slotB: '2H' },
  { matchNum: 'M85', slotA: '1B', slotB: '3rd:EFGIJ' },
  { matchNum: 'M87', slotA: '1K', slotB: '3rd:DEIJL' },
]

// ── Motor de cálculo de grupos ────────────────────────────────────────────────

function buildGroupTeams(
  group: string,
  matches: MatchSlim[],
  betMap: Map<string, BetSlim>,
): TeamRow[] {
  const groupMatches = matches.filter(
    m => m.phase === 'group' && m.group_name === group,
  )
  const map = new Map<string, TeamRow>()

  const ensure = (team: string, flag: string) => {
    if (!map.has(team)) {
      map.set(team, { team, flag, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 })
    }
  }

  for (const m of groupMatches) {
    if (!m.team_home || !m.team_away) continue
    ensure(m.team_home, m.flag_home ?? '')
    ensure(m.team_away, m.flag_away ?? '')

    const bet = betMap.get(m.id)
    if (!bet) continue  // sem palpite → partida não contabilizada

    const home = map.get(m.team_home)!
    const away = map.get(m.team_away)!
    const gh = bet.score_home
    const ga = bet.score_away

    home.gp++; away.gp++
    home.gf += gh; home.ga += ga
    away.gf += ga; away.ga += gh

    if (gh > ga) {
      home.w++; home.pts += 3; away.l++
    } else if (gh < ga) {
      away.w++; away.pts += 3; home.l++
    } else {
      home.d++; home.pts += 1
      away.d++; away.pts += 1
    }
  }

  for (const t of map.values()) t.gd = t.gf - t.ga
  return Array.from(map.values())
}

/**
 * Calcula o confronto direto (H2H) entre um subconjunto de times dentro do grupo.
 * Retorna um mapa de nome → { pts, gd, gf } considerando apenas as partidas entre eles.
 */
function computeH2H(
  teamNames: string[],
  groupMatches: MatchSlim[],
  betMap: Map<string, BetSlim>,
): Map<string, { pts: number; gd: number; gf: number }> {
  const subset = new Set(teamNames)
  const result = new Map(teamNames.map(t => [t, { pts: 0, gd: 0, gf: 0 }]))

  for (const m of groupMatches) {
    if (!subset.has(m.team_home) || !subset.has(m.team_away)) continue
    const bet = betMap.get(m.id)
    if (!bet) continue

    const gh = bet.score_home
    const ga = bet.score_away
    const home = result.get(m.team_home)!
    const away = result.get(m.team_away)!

    home.gf += gh; home.gd += gh - ga
    away.gf += ga; away.gd += ga - gh

    if (gh > ga)      { home.pts += 3 }
    else if (gh < ga) { away.pts += 3 }
    else              { home.pts += 1; away.pts += 1 }
  }

  return result
}

/**
 * Ordena um grupo aplicando o Art. 13 da FIFA (Copa 2026).
 *
 * Passo 1 — todos os times empatados em Pts:
 *   a) Pts H2H (partidas entre os times empatados)
 *   b) Saldo de gols H2H
 *   c) Gols marcados H2H
 *
 * Passo 2 — sub-conjunto ainda empatado após Passo 1:
 *   Recalcula a,b,c usando SOMENTE as partidas entre os times desse sub-conjunto.
 *   (Não reinicia o Passo 2 para sub-sub-conjuntos.)
 *
 * Passo 3 — ainda empatados após Passo 2:
 *   d) Saldo de gols (todos os jogos do grupo)
 *   e) Gols marcados (todos os jogos do grupo)
 *   → Persistindo: marcado em tiedTeams (requer desempate manual)
 */
function sortGroupFIFA(
  teams: TeamRow[],
  groupMatches: MatchSlim[],
  betMap: Map<string, BetSlim>,
): { sorted: TeamRow[]; tiedTeams: string[] } {
  const tiedSet = new Set<string>()

  // ── Passo 0: agrupa por Pts totais ──────────────────────────────
  const byPts = [...teams].sort((a, b) => b.pts - a.pts)
  const ptsClusters = splitClusters(byPts, (a, b) => a.pts === b.pts)

  const sorted: TeamRow[] = []
  for (const cluster of ptsClusters) {
    if (cluster.length === 1) { sorted.push(cluster[0]); continue }
    sorted.push(...resolveH2H(cluster, groupMatches, betMap, tiedSet, false))
  }

  return { sorted, tiedTeams: [...tiedSet] }
}

/** Divide array em sub-arrays de elementos consecutivos que satisfazem eqFn. */
function splitClusters<T>(arr: T[], eqFn: (a: T, b: T) => boolean): T[][] {
  if (arr.length === 0) return []
  const result: T[][] = []
  let cur = [arr[0]]
  for (let i = 1; i < arr.length; i++) {
    if (eqFn(arr[i - 1], arr[i])) cur.push(arr[i])
    else { result.push(cur); cur = [arr[i]] }
  }
  result.push(cur)
  return result
}

/**
 * Passo 1 (isStep2=false): H2H calculado para o cluster inteiro → sub-clusters ainda empatados entram no Passo 2.
 * Passo 2 (isStep2=true):  H2H recalculado somente com as partidas desse sub-cluster → ainda empatados vão para Passo 3.
 */
function resolveH2H(
  cluster: TeamRow[],
  groupMatches: MatchSlim[],
  betMap: Map<string, BetSlim>,
  tiedSet: Set<string>,
  isStep2: boolean,
): TeamRow[] {
  // H2H apenas entre os times deste cluster (critérios a, b, c)
  const h2h = computeH2H(cluster.map(t => t.team), groupMatches, betMap)

  const ordered = [...cluster].sort((a, b) => {
    const ha = h2h.get(a.team)!, hb = h2h.get(b.team)!
    if (hb.pts !== ha.pts) return hb.pts - ha.pts  // a) Pts H2H
    if (hb.gd  !== ha.gd)  return hb.gd  - ha.gd  // b) Saldo H2H
    if (hb.gf  !== ha.gf)  return hb.gf  - ha.gf  // c) Gols H2H
    return 0
  })

  // Sub-clusters ainda empatados em a, b e c
  const subClusters = splitClusters(ordered, (a, b) => {
    const ha = h2h.get(a.team)!, hb = h2h.get(b.team)!
    return ha.pts === hb.pts && ha.gd === hb.gd && ha.gf === hb.gf
  })

  const result: TeamRow[] = []
  for (const sub of subClusters) {
    if (sub.length === 1) {
      result.push(sub[0])
    } else if (!isStep2) {
      // Passo 2: recalcula H2H somente entre os times do sub-cluster
      result.push(...resolveH2H(sub, groupMatches, betMap, tiedSet, true))
    } else {
      // Passo 3: saldo global (d) e gols global (e)
      result.push(...resolveByOverall(sub, tiedSet))
    }
  }
  return result
}

/** Passo 3: d) saldo global, e) gols global. Times ainda empatados → tiedSet. */
function resolveByOverall(teams: TeamRow[], tiedSet: Set<string>): TeamRow[] {
  const sorted = [...teams].sort((a, b) => {
    if (b.gd !== a.gd) return b.gd - a.gd  // d) Saldo global
    if (b.gf !== a.gf) return b.gf - a.gf  // e) Gols global
    return 0
  })
  const remaining = splitClusters(sorted, (a, b) => a.gd === b.gd && a.gf === b.gf)
  for (const grp of remaining) {
    if (grp.length > 1) grp.forEach(t => tiedSet.add(t.team))
  }
  return sorted
}

/** Calcula a classificação de todos os grupos a partir dos palpites do usuário. */
export function calcGroupStandings(
  matches: MatchSlim[],
  betMap: Map<string, BetSlim>,
): CalcGroupStanding[] {
  const groups = [
    ...new Set(
      matches
        .filter(m => m.phase === 'group' && m.group_name)
        .map(m => m.group_name!),
    ),
  ].sort()

  return groups.map(group => {
    const groupMatches = matches.filter(m => m.phase === 'group' && m.group_name === group)
    const teams = buildGroupTeams(group, matches, betMap)
    const { sorted, tiedTeams } = sortGroupFIFA(teams, groupMatches, betMap)
    return { group, teams: sorted, tiedTeams }
  })
}

// ── Melhores 8 terceiros (Art. 13) ───────────────────────────────────────────

/**
 * Classifica os terceiros colocados dos 12 grupos conforme Art. 13 da FIFA.
 * Critérios: Pts → DG → GP → Vitórias → Alfabético
 * (Conduta/cartões e ranking FIFA omitidos — dados não disponíveis nos palpites)
 * Os 8 melhores avançam para as oitavas.
 */
export function rankThirds(standings: CalcGroupStanding[]): ThirdTeam[] {
  const thirds: ThirdTeam[] = standings
    .filter(s => s.teams.length >= 3)
    .map(s => ({ ...s.teams[2], group: s.group, rank: 0, advances: false }))

  thirds.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    if (b.gd  !== a.gd)  return b.gd  - a.gd
    if (b.gf  !== a.gf)  return b.gf  - a.gf
    if (b.w   !== a.w)   return b.w   - a.w
    return a.team.localeCompare(b.team)
  })

  thirds.forEach((t, i) => {
    t.rank = i + 1
    t.advances = i < 8
  })

  return thirds
}

// ── Resolução do Anexo C ─────────────────────────────────────────────────────

/**
 * Dado os 8 grupos cujos terceiros avançam, retorna o mapeamento
 * slot R32 → time (ex: { "1A": "3E", "1B": "3J", ... }).
 *
 * Retorna null se a combinação não for encontrada (não deveria acontecer
 * com dados válidos).
 */
export function resolveThirdSlots(
  thirds: ThirdTeam[],
): Record<string, string> | null {
  const advancingGroups = thirds.filter(t => t.advances).map(t => t.group)
  if (advancingGroups.length !== 8) return null
  return findAnnexeC(advancingGroups)
}

/**
 * Dado o slot de terceiro para uma partida do R32 (ex: "3rd:ABCDF"),
 * resolve qual terceiro joga baseado no Anexo C.
 *
 * @param slotDef   ex: "3rd:ABCDF"  (grupos candidatos)
 * @param thirdSlots  resultado de resolveThirdSlots (ex: { "1A": "3E", ... })
 * @param matchNum    ex: "M74" (para saber qual slot usar)
 */
/** Formata o label de exibição de um slot: "1A" → "(1A)", "3rd:XYZ" → "(3X)" */
function slotDisplayLabel(
  slot: string,
  matchNum: string,
  thirdSlots: Record<string, string> | null,
): string {
  if (slot.startsWith('1') || slot.startsWith('2')) return `(${slot})`
  if (slot.startsWith('3rd:') && thirdSlots) {
    const ref = resolveR32ThirdSlot(matchNum, thirdSlots)
    if (ref) return `(3${ref[1]})`
  }
  return '(3º)'
}

/**
 * Resolve cada um dos 16 slots do R32 em { team, flag, label } a partir das classificações calculadas.
 *
 * groupBetsOverride: mapa de grupo → { first_place, second_place } com os picks manuais do usuário.
 * Quando presente, o ranking manual prevalece sobre os standings calculados pelos placares.
 */
export function buildR32Teams(
  standings: CalcGroupStanding[],
  thirds: ThirdTeam[],
  thirdSlots: Record<string, string> | null,
  groupBetsOverride?: Map<string, { first_place: string; second_place: string }>,
  completeGroups?: Set<string>,
  allGroupsComplete?: boolean,
): { matchNum: string; teamA: { team: string; flag: string } | null; teamB: { team: string; flag: string } | null; labelA: string; labelB: string }[] {
  const standMap = new Map(standings.map(s => [s.group, s]))
  const thirdMap = new Map(thirds.filter(t => t.advances).map(t => [t.group, t]))

  /** Busca a flag de um time pelo nome nas standings */
  const findFlag = (teamName: string): string => {
    for (const s of standings) {
      const t = s.teams.find(t => t.team === teamName)
      if (t) return t.flag
    }
    return ''
  }

  const resolveSlot = (slot: string, matchNum: string): { team: string; flag: string } | null => {
    if (slot.startsWith('1')) {
      const group = slot[1]
      // Só preenche quando todos os jogos do grupo estiverem completos
      if (completeGroups && !completeGroups.has(group)) return null
      // Respeita ranking manual do usuário se disponível
      if (groupBetsOverride?.has(group)) {
        const name = groupBetsOverride.get(group)!.first_place
        return { team: name, flag: findFlag(name) }
      }
      const t = standMap.get(group)?.teams[0]
      return t ? { team: t.team, flag: t.flag } : null
    }
    if (slot.startsWith('2')) {
      const group = slot[1]
      // Só preenche quando todos os jogos do grupo estiverem completos
      if (completeGroups && !completeGroups.has(group)) return null
      // Respeita ranking manual do usuário se disponível
      if (groupBetsOverride?.has(group)) {
        const name = groupBetsOverride.get(group)!.second_place
        return { team: name, flag: findFlag(name) }
      }
      const t = standMap.get(group)?.teams[1]
      return t ? { team: t.team, flag: t.flag } : null
    }
    if (slot.startsWith('3rd:') && thirdSlots) {
      // Só preenche 3ºs quando TODOS os jogos da fase de grupos estiverem completos
      if (completeGroups && !allGroupsComplete) return null
      const ref = resolveR32ThirdSlot(matchNum, thirdSlots) // e.g. "3E"
      if (!ref) return null
      const t = thirdMap.get(ref[1])
      return t ? { team: t.team, flag: t.flag } : null
    }
    return null
  }

  return R32_MATCHES.map(m => ({
    matchNum: m.matchNum,
    teamA:  resolveSlot(m.slotA, m.matchNum),
    teamB:  resolveSlot(m.slotB, m.matchNum),
    labelA: slotDisplayLabel(m.slotA, m.matchNum, thirdSlots),
    labelB: slotDisplayLabel(m.slotB, m.matchNum, thirdSlots),
  }))
}

export function resolveR32ThirdSlot(
  matchNum: string,
  thirdSlots: Record<string, string> | null,
): string | null {
  if (!thirdSlots) return null
  // Mapeia match number para slot
  const matchToSlot: Record<string, string> = {
    'M74': '1E',
    'M77': '1I',
    'M79': '1A',
    'M80': '1L',
    'M81': '1D',
    'M82': '1G',
    'M85': '1B',
    'M87': '1K',
  }
  const slot = matchToSlot[matchNum]
  if (!slot) return null
  return thirdSlots[slot] ?? null  // ex: "3E" (terceiro do grupo E)
}

// ── Knockout team override map ────────────────────────────────────────────────

export type KnockoutTeamOverride = {
  team_home: string; flag_home: string
  team_away: string; flag_away: string
}

type KnockoutSlot = { teamA: { team: string; flag: string } | null; teamB: { team: string; flag: string } | null }
type KnockoutMatch = {
  id: string; phase: string; match_number: number
  team_home: string; flag_home: string
  team_away: string; flag_away: string
  score_home: number | null; score_away: number | null
  penalty_winner: string | null
}

/**
 * Builds a map from match_id → resolved teams for all knockout matches,
 * using official group standings (r32Slots) and actual knockout match scores.
 */
export function buildKnockoutTeamMap(
  r32Slots: KnockoutSlot[],
  knockoutMatches: KnockoutMatch[],
): Map<string, KnockoutTeamOverride> {
  const map = new Map<string, KnockoutTeamOverride>()
  const byPhase = (phase: string) =>
    knockoutMatches.filter(m => m.phase === phase).sort((a, b) => a.match_number - b.match_number)

  const flagMap = new Map<string, string>()
  for (const m of knockoutMatches) {
    if (m.team_home && m.flag_home) flagMap.set(m.team_home, m.flag_home)
    if (m.team_away && m.flag_away) flagMap.set(m.team_away, m.flag_away)
  }
  for (const s of r32Slots) {
    if (s.teamA) flagMap.set(s.teamA.team, s.teamA.flag)
    if (s.teamB) flagMap.set(s.teamB.team, s.teamB.flag)
  }
  const flag = (t: string | null) => (t ? (flagMap.get(t) ?? '') : '')

  const winner = (m: KnockoutMatch | undefined, a: string | null, b: string | null): string | null => {
    if (!m || m.score_home === null || m.score_away === null) return null
    if (m.score_home > m.score_away) return a
    if (m.score_away > m.score_home) return b
    return m.penalty_winner ?? null
  }

  const set = (m: KnockoutMatch, a: string | null, b: string | null) => {
    if (!a && !b) return
    map.set(m.id, {
      team_home: a ?? m.team_home, flag_home: flag(a) || m.flag_home,
      team_away: b ?? m.team_away, flag_away: flag(b) || m.flag_away,
    })
  }

  // R32
  const r32DB = new Map(knockoutMatches.filter(m => m.phase === 'round_of_32').map(m => [m.match_number, m]))
  const r32W: (string | null)[] = r32Slots.map((s, i) => {
    const num = parseInt(R32_MATCHES[i]?.matchNum.slice(1) ?? '0', 10)
    const db  = r32DB.get(num)
    if (db) set(db, s.teamA?.team ?? null, s.teamB?.team ?? null)
    return winner(db, s.teamA?.team ?? null, s.teamB?.team ?? null)
  })

  // R16
  const r16DB = byPhase('round_of_16')
  const r16W: (string | null)[] = r16DB.map((m, i) => {
    const a = r32W[i * 2] ?? null, b = r32W[i * 2 + 1] ?? null
    set(m, a, b); return winner(m, a, b)
  })

  // QF
  const qfDB = byPhase('quarterfinal')
  const qfW: (string | null)[] = qfDB.map((m, i) => {
    const a = r16W[i * 2] ?? null, b = r16W[i * 2 + 1] ?? null
    set(m, a, b); return winner(m, a, b)
  })

  // SF
  const sfDB = byPhase('semifinal')
  const sfW: (string | null)[] = sfDB.map((m, i) => {
    const a = qfW[i * 2] ?? null, b = qfW[i * 2 + 1] ?? null
    set(m, a, b); return winner(m, a, b)
  })

  // Final
  const finalM = knockoutMatches.find(m => m.phase === 'final')
  if (finalM) set(finalM, sfW[0] ?? null, sfW[1] ?? null)

  // 3º Lugar
  const thirdM = knockoutMatches.find(m => m.phase === 'third_place')
  if (thirdM) {
    const loser = (i: number) => {
      const w = sfW[i]; if (!w) return null
      const a = qfW[i * 2] ?? null, b = qfW[i * 2 + 1] ?? null
      return w === a ? b : a
    }
    set(thirdM, loser(0), loser(1))
  }

  return map
}
