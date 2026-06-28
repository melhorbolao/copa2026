import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { formatBrasilia } from '@/utils/date'
import { Countdown } from '@/app/palpites/Countdown'
import { Suspense } from 'react'
import { ParticipantesFilter } from './ParticipantesFilter'
import { ParticipantesTable } from './ParticipantesTable'
import type { TableRow, StageData } from './ParticipantesTable'
import {
  getPhaseSettings, getQualifiedSets, canFillStage, isCutFromStage,
  isParticipantEliminated, STAGE_KEYS,
} from '@/lib/phase-availability'
import type { StageKey as PhaseStageKey } from '@/lib/phase-availability'
import { scoreTournamentBet } from '@/lib/scoring/engine'
import type { TournamentResults } from '@/lib/scoring/engine'

type MatchPhase = 'group' | 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'third_place' | 'final'
interface Match {
  id: string; phase: MatchPhase; round: number | null; betting_deadline: string
  score_home: number | null; score_away: number | null
  team_home: string; team_away: string; penalty_winner: string | null
}
interface Bet   { participant_id: string; match_id: string; updated_at: string; points: number | null }

function getStageKey(m: Match): string | null {
  if (m.phase === 'group') return m.round === 1 ? 'r1' : m.round === 2 ? 'r2' : m.round === 3 ? 'r3' : null
  const map: Partial<Record<MatchPhase, string>> = {
    round_of_32: 'r32', round_of_16: 'r16',
    quarterfinal: 'qf', semifinal: 'sf',
    third_place: 'final', final: 'final',
  }
  return map[m.phase] ?? null
}

function knockoutWinner(m: Pick<Match, 'team_home' | 'team_away' | 'score_home' | 'score_away' | 'penalty_winner'>): string | null {
  if (m.score_home == null || m.score_away == null) return null
  if (m.score_home > m.score_away) return m.team_home
  if (m.score_away > m.score_home) return m.team_away
  if (m.penalty_winner === 'H') return m.team_home
  if (m.penalty_winner === 'A') return m.team_away
  return null
}

function knockoutLoser(m: Pick<Match, 'team_home' | 'team_away' | 'score_home' | 'score_away' | 'penalty_winner'>): string | null {
  const w = knockoutWinner(m)
  if (!w) return null
  return w === m.team_home ? m.team_away : m.team_home
}

type StageKey = PhaseStageKey
const STAGE_LABELS: Record<StageKey, string> = {
  r1:'R1', r2:'R2', r3:'R3', r32:'16av', r16:'Oit', qf:'Qrt', sf:'Semi', final:'Final'
}

export default async function ControlePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; pagamento?: string; palpite?: string; padrinho?: string }>
}) {
  const { filter = '', pagamento = '', palpite = '', padrinho = '' } = await searchParams
  const palpiteArr = palpite ? palpite.split(',').filter(Boolean) : []
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let isAdmin = false
  let userRole = 'user'
  if (user) {
    const { data: p } = await supabase.from('users').select('is_admin, role').eq('id', user.id).single()
    isAdmin = p?.is_admin ?? false
    userRole = p?.role ?? 'user'
  }
  await requirePageAccess('participantes', userRole)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  // PostgREST aplica max-rows no servidor (padrão 1000) mesmo com service_role.
  // .limit(N) no cliente é ignorado quando max-rows < N. Paginamos manualmente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAll(table: string, select: string): Promise<any[]> {
    const PAGE = 1000
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let from = 0
    for (;;) {
      const { data, error } = await admin.from(table).select(select).range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE) break
      from += PAGE
    }
    return rows
  }

  const [
    { data: participants },
    { data: matches },
    allBets,
    { data: trnBets },
    groupBets,
    thirdBets,
    phaseSettings,
    qualified,
    userParticipants,
    { data: artillarySettings },
    { data: scoringRulesData },
    { data: scorerMappingData },
  ] = await Promise.all([
    supabase.from('participants')
      .select('id, apelido, paid')
      .order('apelido', { ascending: true }),
    supabase.from('matches').select('id, phase, round, betting_deadline, score_home, score_away, team_home, team_away, penalty_winner'),
    fetchAll('bets', 'participant_id, match_id, updated_at, points') as Promise<Bet[]>,
    admin.from('tournament_bets').select('participant_id, champion, runner_up, semi1, semi2, top_scorer, points').limit(10000),
    fetchAll('group_bets', 'participant_id, group_name, points'),
    fetchAll('third_place_bets', 'participant_id, group_name, points'),
    getPhaseSettings(),
    getQualifiedSets(),
    fetchAll('user_participants', 'participant_id, users(padrinho)') as Promise<{ participant_id: string; users: { padrinho: string | null } | null }[]>,
    admin.from('tournament_settings').select('key, value').in('key', ['artillary_points_active', 'official_top_scorer']) as Promise<{ data: { key: string; value: string }[] | null }>,
    admin.from('scoring_rules').select('key, points') as Promise<{ data: { key: string; points: number }[] | null }>,
    (admin as any).from('top_scorer_mapping').select('raw_name, standardized_name').then((r: any) => r, () => ({ data: [] })) as Promise<{ data: { raw_name: string; standardized_name: string }[] }>,
  ])

  // Pontos de jogos, grupos e terceiros (valores armazenados, em sincronia com o scoring engine)
  const betPtsMap   = new Map<string, number>()
  const groupPtsMap = new Map<string, number>()
  const thirdPtsMap = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const b of allBets) betPtsMap.set(b.participant_id, (betPtsMap.get(b.participant_id) ?? 0) + (b.points ?? 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (groupBets as any[])) groupPtsMap.set(g.participant_id, (groupPtsMap.get(g.participant_id) ?? 0) + ((g.points ?? 0) as number))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const t of (thirdBets as any[])) thirdPtsMap.set(t.participant_id, (thirdPtsMap.get(t.participant_id) ?? 0) + ((t.points ?? 0) as number))

  // Pontos G4 calculados ao vivo — idêntico ao ClassificacaoMBClient para evitar divergência de posições
  const artillaryActive = artillarySettings?.find(r => r.key === 'artillary_points_active')?.value === 'true'
  const scorerMapping: Record<string, string> = Object.fromEntries(
    (scorerMappingData ?? []).map(r => [r.raw_name.toLowerCase().trim(), r.standardized_name])
  )

  const completedKO = (matches ?? [] as Match[]).filter(m =>
    (['quarterfinal', 'semifinal', 'third_place', 'final'] as MatchPhase[]).includes(m.phase) &&
    m.score_home !== null
  )
  const semifinalists = completedKO.filter(m => m.phase === 'quarterfinal').map(m => knockoutWinner(m)).filter(Boolean) as string[]
  const finalists     = completedKO.filter(m => m.phase === 'semifinal').map(m => knockoutWinner(m)).filter(Boolean) as string[]
  const finMatch      = completedKO.find(m => m.phase === 'final')
  const tpMatch       = completedKO.find(m => m.phase === 'third_place')
  const champion      = finMatch ? knockoutWinner(finMatch) : null
  const runnerUp      = finMatch ? knockoutLoser(finMatch)  : null
  const third         = tpMatch  ? knockoutWinner(tpMatch)  : null
  const fourth        = tpMatch  ? knockoutLoser(tpMatch)   : null

  let liveOfficialScorers: string[] = []
  if (artillaryActive) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: topScorersData } = await (admin as any).from('top_scorers').select('player_name, goals_count').order('goals_count', { ascending: false })
      if (topScorersData && topScorersData.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const maxGoals = (topScorersData[0] as any).goals_count as number
        if (maxGoals > 0) {
          liveOfficialScorers = (topScorersData as { player_name: string; goals_count: number }[])
            .filter(s => s.goals_count === maxGoals)
            .map(s => s.player_name)
        }
      }
    } catch { /* tabela não populada */ }
  }

  const rulesMap: Record<string, number> = Object.fromEntries((scoringRulesData ?? []).map(r => [r.key, r.points]))
  const zebraThreshold = rulesMap['percentual_zebra'] ?? 15
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chamBetsTotal    = (trnBets ?? []).filter((b: any) => b.champion).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chamBetsWithPick = (trnBets ?? []).filter((b: any) => b.champion && b.champion === champion).length
  const isZebraChampion  = champion !== null && chamBetsTotal > 0 &&
    (chamBetsWithPick / chamBetsTotal) * 100 <= zebraThreshold

  const tournamentResults: TournamentResults = {
    semifinalists, finalists,
    champion: champion ?? null, runnerUp: runnerUp ?? null,
    third: third ?? null, fourth: fourth ?? null,
    officialScorers: liveOfficialScorers,
  }

  const livePtsG4Map = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tb of (trnBets ?? []) as any[]) {
    livePtsG4Map.set(tb.participant_id, scoreTournamentBet(
      {
        champion:   tb.champion   ?? '',
        runner_up:  tb.runner_up  ?? '',
        semi1:      tb.semi1      ?? '',
        semi2:      tb.semi2      ?? '',
        top_scorer: artillaryActive ? (tb.top_scorer ?? '') : '',
      },
      tournamentResults, rulesMap, isZebraChampion, scorerMapping,
    ))
  }

  const livePts = (pid: string) =>
    (betPtsMap.get(pid) ?? 0) +
    (groupPtsMap.get(pid) ?? 0) +
    (thirdPtsMap.get(pid) ?? 0) +
    (livePtsG4Map.get(pid) ?? 0)

  // Ranking padrão (com saltos em empates) — igual ao ClassificacaoMBClient.
  const allParticipantIds = (participants ?? []).map(p => p.id)
  const rankingSorted = [...allParticipantIds].sort((a, b) => livePts(b) - livePts(a))
  const rankMap = new Map<string, number>()
  for (let i = 0; i < rankingSorted.length; i++) {
    const pid = rankingSorted[i]
    const rank = i === 0 ? 1
      : livePts(pid) === livePts(rankingSorted[i - 1])
        ? rankMap.get(rankingSorted[i - 1])!
        : i + 1
    rankMap.set(pid, rank)
  }

  // Mapa de padrinho por participante (apenas admin)
  const padrinhoByPid = new Map<string, string | null>()
  for (const up of userParticipants) {
    if (!padrinhoByPid.has(up.participant_id)) {
      padrinhoByPid.set(up.participant_id, up.users?.padrinho ?? null)
    }
  }
  const padrinhoOptions = [...new Set(
    [...padrinhoByPid.values()].filter((v): v is string => v !== null && v.trim() !== '')
  )].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))

  // Valida duplicidade G4 por participante
  function getG4Errors(bet: { champion?: string|null; runner_up?: string|null; semi1?: string|null; semi2?: string|null }): string[] {
    const labels: [string, string|null|undefined][] = [
      ['Campeão', bet.champion], ['Vice', bet.runner_up],
      ['3º Semi', bet.semi1],    ['4º Semi', bet.semi2],
    ]
    const seen = new Map<string, string>()
    const errors: string[] = []
    for (const [label, v] of labels) {
      if (!v) continue
      if (seen.has(v)) errors.push(`${v} em ${seen.get(v)} e ${label}`)
      else seen.set(v, label)
    }
    return errors
  }

  const g4ErrorMap = new Map<string, string[]>()
  for (const t of (trnBets ?? [])) {
    const errs = getG4Errors(t)
    if (errs.length > 0) g4ErrorMap.set(t.participant_id, errs)
  }
  const hasAnyError = g4ErrorMap.size > 0

  // Totais de partidas e prazos por etapa
  const stageTotals:    Record<StageKey, number> = { r1:0,r2:0,r3:0,r32:0,r16:0,qf:0,sf:0,final:0 }
  const stageDeadlines: Record<StageKey, string> = { r1:'',r2:'',r3:'',r32:'',r16:'',qf:'',sf:'',final:'' }
  const matchStage = new Map<string, StageKey>()
  for (const m of (matches ?? []) as Match[]) {
    const k = getStageKey(m) as StageKey | null
    if (!k) continue
    stageTotals[k]++
    matchStage.set(m.id, k)
    if (!stageDeadlines[k]) stageDeadlines[k] = m.betting_deadline
  }
  // R1 inclui bônus pré-torneio: G4+artilheiro (5) + classificados por grupo (12) + terceiros (8)
  const R1_BONUS = 5 + 12 + 8   // 25 campos adicionais
  stageTotals['r1'] += R1_BONUS

  // Pré-processa bônus por participante para R1
  const trnBetCount   = new Map<string, number>()
  const trnBetMissing = new Map<string, string[]>()
  for (const t of (trnBets ?? [])) {
    const filled = [t.champion, t.runner_up, t.semi1, t.semi2, t.top_scorer].filter(Boolean).length
    trnBetCount.set(t.participant_id, filled)
    const missing: string[] = []
    if (!t.champion)   missing.push('campeão')
    if (!t.runner_up)  missing.push('vice')
    if (!t.semi1)      missing.push('terceiro')
    if (!t.semi2)      missing.push('quarto')
    if (!t.top_scorer) missing.push('artilheiro')
    trnBetMissing.set(t.participant_id, missing)
  }

  const groupBetCount = new Map<string, number>()
  for (const g of (groupBets ?? [])) {
    groupBetCount.set(g.participant_id, (groupBetCount.get(g.participant_id) ?? 0) + 1)
  }

  const thirdBetCount = new Map<string, number>()
  for (const t of (thirdBets ?? [])) {
    thirdBetCount.set(t.participant_id, (thirdBetCount.get(t.participant_id) ?? 0) + 1)
  }

  // Palpites e último salvamento por participante por etapa
  const betCount   = new Map<string, Record<StageKey, number>>()
  const lastSavedMap = new Map<string, Record<StageKey, string>>()

  for (const b of (allBets ?? []) as Bet[]) {
    const k = matchStage.get(b.match_id)
    if (!k) continue

    if (!betCount.has(b.participant_id))    betCount.set(b.participant_id,    { r1:0,r2:0,r3:0,r32:0,r16:0,qf:0,sf:0,final:0 })
    if (!lastSavedMap.has(b.participant_id)) lastSavedMap.set(b.participant_id, { r1:'',r2:'',r3:'',r32:'',r16:'',qf:'',sf:'',final:'' })

    betCount.get(b.participant_id)![k]++

    const prev = lastSavedMap.get(b.participant_id)![k]
    if (!prev || b.updated_at > prev) lastSavedMap.get(b.participant_id)![k] = b.updated_at
  }

  // Soma bônus de R1 por participante
  for (const p of (participants ?? [])) {
    const pid = p.id
    if (!betCount.has(pid)) betCount.set(pid, { r1:0,r2:0,r3:0,r32:0,r16:0,qf:0,sf:0,final:0 })
    const counts = betCount.get(pid)!
    counts.r1 += trnBetCount.get(pid) ?? 0
    counts.r1 += Math.min(groupBetCount.get(pid) ?? 0, 12)
    counts.r1 += Math.min(thirdBetCount.get(pid) ?? 0, 8)
  }


  const calcPct = (participantId: string, k: StageKey) => {
    const total = stageTotals[k]
    if (!total) return -1
    return Math.round((betCount.get(participantId)?.[k] ?? 0) / total * 100)
  }

  const PT_CARD = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito']
  const ptJoin = (parts: string[]) =>
    parts.length <= 1 ? (parts[0] ?? '') :
    parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1]

  const getMissingTooltip = (pid: string, k: StageKey): string | null => {
    const filled = betCount.get(pid)?.[k] ?? 0
    const total  = stageTotals[k]
    if (total === 0 || filled === 0 || filled >= total) return null
    const parts: string[] = []
    if (k === 'r1') {
      const trnFilled   = trnBetCount.get(pid) ?? 0
      const grpFilled   = Math.min(groupBetCount.get(pid) ?? 0, 12)
      const thirdFilled = Math.min(thirdBetCount.get(pid) ?? 0, 8)
      const matchFilled = Math.max(0, filled - trnFilled - grpFilled - thirdFilled)
      const missingMatches = (total - R1_BONUS) - matchFilled
      if (missingMatches > 0)
        parts.push(`${missingMatches} ${missingMatches === 1 ? 'jogo' : 'jogos'}`)
      parts.push(...(trnBetMissing.get(pid) ?? ['campeão', 'vice', 'terceiro', 'quarto', 'artilheiro']))
      const missingGrp = 12 - grpFilled
      if (missingGrp > 0)
        parts.push(`${missingGrp} ${missingGrp === 1 ? 'classificado' : 'classificados'}`)
      const missingThird = 8 - thirdFilled
      if (missingThird > 0)
        parts.push(`${PT_CARD[missingThird] ?? missingThird} ${missingThird === 1 ? 'terceiro colocado' : 'terceiros colocados'}`)
    } else {
      const missing = total - filled
      parts.push(`${missing} ${missing === 1 ? 'jogo' : 'jogos'}`)
    }
    return parts.length > 0 ? ptJoin(parts) : null
  }

  const getLastSaved = (participantId: string, k: StageKey): string | null => {
    const ts = lastSavedMap.get(participantId)?.[k]
    if (!ts) return null
    return formatBrasilia(ts, "dd/MM HH:mm")
  }

  // Próximo prazo
  const DEADLINE_LABELS: Record<string, string> = {
    group_1: 'Rodada 1', group_2: 'Rodada 2', group_3: 'Rodada 3',
    round_of_32: '16 avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas',
    semifinal: 'Semifinal', third_place: 'Final', final: 'Final',
  }
  const nowTs = new Date()
  const nextMatch = (matches ?? [] as Match[])
    .filter(m => new Date(m.betting_deadline) > nowTs)
    .sort((a, b) => new Date(a.betting_deadline).getTime() - new Date(b.betting_deadline).getTime())[0]
  const nextDeadline = nextMatch ? {
    iso: nextMatch.betting_deadline,
    label: nextMatch.phase === 'group'
      ? (DEADLINE_LABELS[`group_${nextMatch.round}`] ?? 'Rodada')
      : (DEADLINE_LABELS[nextMatch.phase] ?? 'Próxima etapa'),
  } : null

  // Determina a próxima etapa (para filtro de palpites incompletos)
  const nextStageKey: StageKey | null = nextMatch ? (getStageKey(nextMatch) as StageKey | null) : null
  const nextStageLabel: string | null = nextStageKey ? STAGE_LABELS[nextStageKey] : null

  const allSorted = [...(participants ?? [])].sort((a, b) =>
    a.apelido.localeCompare(b.apelido, 'pt-BR', { sensitivity: 'base' })
  )

  const eliminatedSet = new Set<string>(
    allSorted
      .filter(p => isParticipantEliminated(p.id, phaseSettings, qualified))
      .map(p => p.id),
  )
  const hasAnyEliminated = eliminatedSet.size > 0

  // Estado de uma célula (participante, etapa) na tabela
  type CellStatus = { kind: 'unavailable' | 'cut' | 'open'; pct: number }
  const cellStatus = (pid: string, k: StageKey): CellStatus => {
    const v = calcPct(pid, k)
    if (v === -1) return { kind: 'unavailable', pct: -1 }
    if (!canFillStage(k, pid, phaseSettings, qualified)) {
      if (isCutFromStage(k, pid, phaseSettings, qualified)) return { kind: 'cut', pct: v }
      return { kind: 'unavailable', pct: v }
    }
    return { kind: 'open', pct: v }
  }

  // Serializa dados de cada participante para o componente cliente
  const allRows: TableRow[] = allSorted.map(p => ({
    id:        p.id,
    apelido:   p.apelido,
    paid:      p.paid,
    eliminated: eliminatedSet.has(p.id),
    g4Errors:  g4ErrorMap.get(p.id) ?? null,
    padrinho:  padrinhoByPid.get(p.id) ?? null,
    rank:      rankMap.get(p.id) ?? null,
    stages: STAGE_KEYS.map(k => {
      const status = cellStatus(p.id, k)
      return {
        kind:       status.kind,
        pct:        status.pct,
        lastSaved:  getLastSaved(p.id, k),
        missingTip: getMissingTooltip(p.id, k),
      } satisfies StageData
    }),
  }))

  const stageMeta = STAGE_KEYS.map(k => ({
    label:    STAGE_LABELS[k],
    deadline: stageDeadlines[k] ? formatBrasilia(stageDeadlines[k], 'dd/MM HH:mm') : null,
  }))

  const nextStageIdx = nextStageKey ? STAGE_KEYS.indexOf(nextStageKey) : null

  // Subtotais de preenchimento para os chips de filtro
  // Conta apenas participantes com stage 'open' (ativos e habilitados na fase).
  // Exclui cortados e não-disponíveis — não faz sentido contar quem não pode palpitar.
  const fillCounts = nextStageIdx !== null ? (() => {
    let zerado = 0, parcial = 0, completo = 0
    for (const r of allRows) {
      const stage = r.stages[nextStageIdx!]
      if (stage.kind !== 'open') continue
      if (stage.pct === 0)        zerado++
      else if (stage.pct === 100) completo++
      else                        parcial++
    }
    return { zerado, parcial, completo }
  })() : null

  return (
    <>
      <Navbar />

      {hasAnyError && (
        <div className="sticky z-40 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium" style={{ top: 'var(--sticky-top)' }}>
          ⚠️ Existem erros de lógica nos palpites de alguns participantes. Verifique a lista abaixo.
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-black text-gray-900">Participantes</h1>
          {nextDeadline && (
            <Countdown deadline={nextDeadline.iso} label={nextDeadline.label} />
          )}
        </div>

        <div className="mb-4">
          <Suspense fallback={null}>
            <ParticipantesFilter
              nextStageLabel={nextStageLabel}
              hasAnyEliminated={hasAnyEliminated}
              fillCounts={fillCounts}
              isAdmin={isAdmin}
              padrinhos={padrinhoOptions}
            />
          </Suspense>
        </div>

        <ParticipantesTable
          rows={allRows}
          activeFilter={filter}
          paymentFilter={pagamento}
          fillFilter={palpiteArr}
          padrinhoFilter={padrinho}
          hasAnyEliminated={hasAnyEliminated}
          nextStageIdx={nextStageIdx}
          stageMeta={stageMeta}
          stageTotals={STAGE_KEYS.map(k => stageTotals[k])}
          hasAnyError={hasAnyError}
        />
      </div>
    </>
  )
}
