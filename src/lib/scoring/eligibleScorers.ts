// Um artilheiro eliminado só sai das opções se, além de eliminado, sua contagem de
// gols já for menor que a do atual líder — eliminado empatado na liderança continua
// podendo ser o artilheiro oficial da Copa.

interface ScorerMappingRow {
  standardized_name: string | null
  is_eliminated?: boolean | null
}

interface TopScorerRow {
  player_name: string
  goals_count: number | null
}

export function computeBlockedScorers(
  mappingRows: ScorerMappingRow[],
  topScorerRows: TopScorerRow[],
): Set<string> {
  const goalsByName: Record<string, number> = {}
  for (const s of topScorerRows) {
    const key = s.player_name.toLowerCase().trim()
    goalsByName[key] = Math.max(goalsByName[key] ?? 0, s.goals_count ?? 0)
  }
  const maxGoals = Object.values(goalsByName).reduce((m, g) => Math.max(m, g), 0)

  const eliminated = new Set<string>()
  for (const m of mappingRows) {
    if (m.is_eliminated && m.standardized_name) {
      eliminated.add(m.standardized_name.trim().toLowerCase())
    }
  }

  const blocked = new Set<string>()
  for (const name of eliminated) {
    if ((goalsByName[name] ?? 0) < maxGoals) blocked.add(name)
  }
  return blocked
}
