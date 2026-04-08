/**
 * Motor de cálculo do chaveamento baseado nos palpites do usuário.
 *
 * Regras FIFA 2026:
 * - Classificação por grupo (Art. 13): Pts → DG → GP → confronto direto → alfabético
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
  teams: TeamRow[]       // sorted: [0]=1st … [3]=4th
  tiedTeams: Set<string> // nomes dos times ainda empatados após todos os critérios FIFA
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
// Bloco 2: 2K, 1H, 1D, 1G
// Bloco 3: 1C, 2E, 1A, 1L
// Bloco 4: 1J, 2D, 1B, 1K
export const R32_MATCHES: R32MatchDef[] = [
  // Bloco 1
  { matchNum: 'M73', slotA: '2A', slotB: '2B' },
  { matchNum: 'M75', slotA: '1F', slotB: '2C' },
  { matchNum: 'M74', slotA: '1E', slotB: '3rd:ABCDF' },
  { matchNum: 'M77', slotA: '1I', slotB: '3rd:CDFGH' },
  // Bloco 2
  { matchNum: 'M83', slotA: '2K', slotB: '2L' },
  { matchNum: 'M84', slotA: '1H', slotB: '2J' },
  { matchNum: 'M81', slotA: '1D', slotB: '3rd:BEFIJ' },
  { matchNum: 'M82', slotA: '1G', slotB: '3rd:AEHIJ' },
  // Bloco 3
  { matchNum: 'M76', slotA: '1C', slotB: '2F' },
  { matchNum: 'M78', slotA: '2E', slotB: '2I' },
  { matchNum: 'M79', slotA: '1A', slotB: '3rd:CEFHI' },
  { matchNum: 'M80', slotA: '1L', slotB: '3rd:EHIJK' },
  // Bloco 4
  { matchNum: 'M86', slotA: '1J', slotB: '2H' },
  { matchNum: 'M88', slotA: '2D', slotB: '2G' },
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
 * Ordena um grupo aplicando os 6 critérios da FIFA (Art. 13 – Copa 2026):
 *   1. Pts (todos os jogos)
 *   2. Saldo de gols (todos)
 *   3. Gols marcados (todos)
 *   → Para cada cluster ainda empatado:
 *   4. Pts H2H
 *   5. Saldo de gols H2H
 *   6. Gols marcados H2H
 *   → Se persistir: retorna no tiedTeams (requer override manual)
 */
function sortGroupFIFA(
  teams: TeamRow[],
  groupMatches: MatchSlim[],
  betMap: Map<string, BetSlim>,
): { sorted: TeamRow[]; tiedTeams: Set<string> } {
  // ── Passo 1: ordenação global (critérios 1-3) ─────────────────
  const byGlobal = [...teams].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    if (b.gd  !== a.gd)  return b.gd  - a.gd
    if (b.gf  !== a.gf)  return b.gf  - a.gf
    return 0
  })

  // ── Passo 2: agrupa clusters com mesmo (Pts, GD, GF) ─────────
  const clusters: TeamRow[][] = []
  let cur: TeamRow[] = [byGlobal[0]]
  for (let i = 1; i < byGlobal.length; i++) {
    const p = byGlobal[i - 1], c = byGlobal[i]
    if (p.pts === c.pts && p.gd === c.gd && p.gf === c.gf) {
      cur.push(c)
    } else {
      clusters.push(cur)
      cur = [c]
    }
  }
  clusters.push(cur)

  // ── Passo 3: resolve cada cluster com H2H (critérios 4-6) ────
  const tiedTeams = new Set<string>()
  const sorted: TeamRow[] = []

  for (const cluster of clusters) {
    if (cluster.length === 1) { sorted.push(cluster[0]); continue }

    const h2h = computeH2H(cluster.map(t => t.team), groupMatches, betMap)

    const h2hSorted = [...cluster].sort((a, b) => {
      const ha = h2h.get(a.team)!, hb = h2h.get(b.team)!
      if (hb.pts !== ha.pts) return hb.pts - ha.pts
      if (hb.gd  !== ha.gd)  return hb.gd  - ha.gd
      if (hb.gf  !== ha.gf)  return hb.gf  - ha.gf
      return 0
    })

    // Detecta sub-clusters que continuam empatados após H2H
    let subCur: TeamRow[] = [h2hSorted[0]]
    for (let i = 1; i < h2hSorted.length; i++) {
      const hp = h2h.get(h2hSorted[i - 1].team)!
      const hc = h2h.get(h2hSorted[i].team)!
      if (hp.pts === hc.pts && hp.gd === hc.gd && hp.gf === hc.gf) {
        subCur.push(h2hSorted[i])
      } else {
        if (subCur.length > 1) subCur.forEach(t => tiedTeams.add(t.team))
        sorted.push(...subCur)
        subCur = [h2hSorted[i]]
      }
    }
    if (subCur.length > 1) subCur.forEach(t => tiedTeams.add(t.team))
    sorted.push(...subCur)
  }

  return { sorted, tiedTeams }
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
      // Respeita ranking manual do usuário se disponível
      if (groupBetsOverride?.has(group)) {
        const name = groupBetsOverride.get(group)!.second_place
        return { team: name, flag: findFlag(name) }
      }
      const t = standMap.get(group)?.teams[1]
      return t ? { team: t.team, flag: t.flag } : null
    }
    if (slot.startsWith('3rd:') && thirdSlots) {
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
