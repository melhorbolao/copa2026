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
  teams: TeamRow[]  // sorted: [0]=1st … [3]=4th
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

export const R32_MATCHES: R32MatchDef[] = [
  { matchNum: 'M73', slotA: '2A', slotB: '2B' },
  { matchNum: 'M74', slotA: '1E', slotB: '3rd:ABCDF' },
  { matchNum: 'M75', slotA: '1F', slotB: '2C' },
  { matchNum: 'M76', slotA: '1C', slotB: '2F' },
  { matchNum: 'M77', slotA: '1I', slotB: '3rd:CDFGH' },
  { matchNum: 'M78', slotA: '2E', slotB: '2I' },
  { matchNum: 'M79', slotA: '1A', slotB: '3rd:CEFHI' },
  { matchNum: 'M80', slotA: '1L', slotB: '3rd:EHIJK' },
  { matchNum: 'M81', slotA: '1D', slotB: '3rd:BEFIJ' },
  { matchNum: 'M82', slotA: '1G', slotB: '3rd:AEHIJ' },
  { matchNum: 'M83', slotA: '2K', slotB: '2L' },
  { matchNum: 'M84', slotA: '1H', slotB: '2J' },
  { matchNum: 'M85', slotA: '1B', slotB: '3rd:EFGIJ' },
  { matchNum: 'M86', slotA: '1J', slotB: '2H' },
  { matchNum: 'M87', slotA: '1K', slotB: '3rd:DEIJL' },
  { matchNum: 'M88', slotA: '2D', slotB: '2G' },
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
    ensure(m.team_home, m.flag_home)
    ensure(m.team_away, m.flag_away)

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
 * Ordena times de um grupo pelos critérios do Art. 13 (simplificado):
 * 1. Pts; 2. DG; 3. GP; 4. Alfabético (confronto direto omitido — requer mais dados)
 */
function sortGroup(teams: TeamRow[]): TeamRow[] {
  return [...teams].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    if (b.gd  !== a.gd)  return b.gd  - a.gd
    if (b.gf  !== a.gf)  return b.gf  - a.gf
    return a.team.localeCompare(b.team)
  })
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

  return groups.map(group => ({
    group,
    teams: sortGroup(buildGroupTeams(group, matches, betMap)),
  }))
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
