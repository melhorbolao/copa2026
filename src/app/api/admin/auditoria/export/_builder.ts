/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs'
import { toZonedTime } from 'date-fns-tz'
import { createAuthAdminClient } from '@/lib/supabase/server'
import { getPhaseSettings, getQualifiedSets, isParticipantEliminated } from '@/lib/phase-availability'
import { buildAvailableRounds } from '@/lib/production-mode'

const BRASILIA_TZ = 'America/Sao_Paulo'

// Ordem cronológica das chaves de prazo no bolão
const ROUND_ORDER: Record<string, number> = {
  group_r1:     0,
  bonus:        1,
  group_r2:     2,
  group_r3:     3,
  round_of_32:  4,
  round_of_16:  5,
  quarterfinal: 6,
  semifinal:    7,
  third_place:  8,
  final:        9,
}

const ROUND_LABELS: Record<string, string> = {
  group_r1:     'Rodada 1 — Fase de Grupos',
  group_r2:     'Rodada 2 — Fase de Grupos',
  group_r3:     'Rodada 3 — Fase de Grupos',
  bonus:        'Bônus (Classificados, G4 e Artilheiro)',
  round_of_32:  '16 Avos de Final',
  round_of_16:  'Oitavas de Final',
  quarterfinal: 'Quartas de Final',
  semifinal:    'Semifinais',
  third_place:  '3º Lugar',
  final:        'Final',
}

function fmtDate(ts: string | Date | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function fmtDateShort(ts: string | null | undefined): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

export async function buildAuditBuffer(): Promise<{ buffer: Buffer; fileName: string }> {
  const admin = createAuthAdminClient() as any

  // PostgREST aplica max-rows=1000 mesmo com service_role.
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

  // Busca todos os dados em paralelo para evitar N+1
  const [
    { data: participantsRaw },
    { data: matchesRaw },
    betsRaw,
    groupBetsRaw,
    thirdBetsRaw,
    { data: tBetsRaw },
    predLogsResult,
    { data: settingsRaw },
    phaseSettings,
    qualified,
  ] = await Promise.all([
    admin.from('participants')
      .select('id, apelido, created_at')
      .order('apelido', { ascending: true }),

    admin.from('matches')
      .select('id, phase, round, group_name, betting_deadline, match_datetime')
      .order('match_datetime', { ascending: true }),

    fetchAll('bets', 'participant_id, match_id, updated_at'),

    fetchAll('group_bets', 'participant_id'),

    fetchAll('third_place_bets', 'participant_id'),

    admin.from('tournament_bets')
      .select('participant_id'),

    // prediction_logs pode não existir se a migration ainda não foi executada.
    // Pagina — cresce com participantes × deadlines. Retorna null se a tabela não existir.
    (async (): Promise<any[] | null> => {
      const PAGE = 1000
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = []
      let from = 0
      for (;;) {
        const { data, error } = await admin.from('prediction_logs')
          .select('participant_id, deadline_key, last_updated_at, completed_at')
          .range(from, from + PAGE - 1)
        if (error) return null
        if (!data || data.length === 0) break
        rows.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      return rows
    })(),

    admin.from('tournament_settings')
      .select('key, value')
      .in('key', ['available_rounds']),

    getPhaseSettings(),
    getQualifiedSets(),
  ])

  const participants = (participantsRaw ?? []) as any[]
  const matches      = (matchesRaw ?? []) as any[]
  const bets         = (betsRaw ?? []) as any[]
  const groupBets    = (groupBetsRaw ?? []) as any[]
  const thirdBets    = (thirdBetsRaw ?? []) as any[]
  const tBets        = (tBetsRaw ?? []) as any[]

  const hasPredLogs = predLogsResult !== null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const predLogs    = (predLogsResult ?? []) as any[]

  // available_rounds da configuração do admin
  const settingsMap: Record<string, string> = {}
  for (const row of (settingsRaw ?? []) as any[]) settingsMap[row.key] = row.value
  let availableRoundKeys: string[] = []
  try { availableRoundKeys = JSON.parse(settingsMap['available_rounds'] ?? '[]') } catch { /* empty */ }

  // Determina a "rodada atual" para a coluna de Status
  const availableRounds = buildAvailableRounds(matches)
  let currentRoundKey: string | null = null

  if (availableRoundKeys.length > 0) {
    const sorted = [...availableRoundKeys].sort(
      (a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99),
    )
    currentRoundKey = sorted[sorted.length - 1]
  } else {
    // Fallback: última rodada com prazo expirado
    const now = new Date()
    const expired = availableRounds.filter(r => r.deadline && new Date(r.deadline) <= now)
    currentRoundKey = expired.length > 0 ? expired[expired.length - 1].key : (availableRounds[0]?.key ?? null)
  }

  // Mapa match_id → { phase, round }
  const matchInfoMap = new Map<string, { phase: string; round: number | null }>()
  for (const m of matches) matchInfoMap.set(m.id as string, { phase: m.phase, round: m.round })

  // Conta partidas por deadline_key (total esperado de palpites por rodada)
  const matchCountByKey = new Map<string, number>()
  for (const m of matches) {
    const key = m.phase === 'group' ? `group_r${m.round}` : (m.phase as string)
    matchCountByKey.set(key, (matchCountByKey.get(key) ?? 0) + 1)
  }
  const totalGroups = new Set(
    matches.filter((m: any) => m.phase === 'group' && m.group_name).map((m: any) => m.group_name as string),
  ).size
  // Bônus: group_bets (1 por grupo) + third_place_bets (1 por grupo) + tournament_bet (1)
  matchCountByKey.set('bonus', totalGroups + totalGroups + 1)

  // Palpites por participante×rodada: count e last updated_at (fallback sem prediction_logs)
  const betCountByKey       = new Map<string, number>()
  const lastUpdatedByKey    = new Map<string, Date>()
  for (const b of bets) {
    const info = matchInfoMap.get(b.match_id as string)
    if (!info) continue
    const dKey   = info.phase === 'group' ? `group_r${info.round}` : info.phase
    const mapKey = `${b.participant_id}:${dKey}`
    betCountByKey.set(mapKey, (betCountByKey.get(mapKey) ?? 0) + 1)
    const ua = new Date(b.updated_at as string)
    const ex = lastUpdatedByKey.get(mapKey)
    if (!ex || ua > ex) lastUpdatedByKey.set(mapKey, ua)
  }

  // Contagem bônus por participante
  const bonusCountByPid = new Map<string, number>()
  for (const b of groupBets) bonusCountByPid.set(b.participant_id, (bonusCountByPid.get(b.participant_id) ?? 0) + 1)
  for (const b of thirdBets) bonusCountByPid.set(b.participant_id, (bonusCountByPid.get(b.participant_id) ?? 0) + 1)
  for (const b of tBets)     bonusCountByPid.set(b.participant_id, (bonusCountByPid.get(b.participant_id) ?? 0) + 1)

  // Mapa prediction_logs: `${pid}:${key}` → { last_updated_at, completed_at }
  const predLogMap = new Map<string, { last_updated_at: string; completed_at: string | null }>()
  for (const pl of predLogs) {
    predLogMap.set(`${pl.participant_id}:${pl.deadline_key}`, {
      last_updated_at: pl.last_updated_at as string,
      completed_at:    pl.completed_at   as string | null,
    })
  }

  // Rodadas a exibir no relatório (todas que possuem partidas, na ordem cronológica)
  const reportRounds = [...matchCountByKey.keys()]
    .filter(k => matchCountByKey.get(k)! > 0)
    .sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))
    .map(key => ({ key, label: ROUND_LABELS[key] ?? key }))

  const currentRoundTotal = currentRoundKey ? (matchCountByKey.get(currentRoundKey) ?? 0) : 0
  const currentRoundLabel = currentRoundKey ? (ROUND_LABELS[currentRoundKey] ?? currentRoundKey) : ''

  // ── Build Excel ───────────────────────────────────────────────

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Melhor Bolão'

  const FIXED_COLS   = 3
  const DYN_PER_RND  = 2
  const totalCols    = FIXED_COLS + reportRounds.length * DYN_PER_RND

  const ws = wb.addWorksheet('Auditoria Palpites', {
    properties: { tabColor: { argb: 'FF1E3A8A' } },
    views: [{ state: 'frozen', xSplit: FIXED_COLS, ySplit: 2 }],
  })

  // ── Larguras das colunas ──────────────────────────────────────
  ws.getColumn(1).width = 28   // Participante
  ws.getColumn(2).width = 18   // Data Cadastro
  ws.getColumn(3).width = 22   // Status Rodada Atual
  for (let i = 0; i < reportRounds.length; i++) {
    ws.getColumn(FIXED_COLS + 1 + i * DYN_PER_RND).width = 22  // Última alteração
    ws.getColumn(FIXED_COLS + 2 + i * DYN_PER_RND).width = 22  // Conclusão
  }

  // Cores
  const C_HDR_BG  = 'FF1E3A8A'   // azul escuro — cabeçalhos fixos
  const C_HDR_FG  = 'FFFFFFFF'
  const C_DYN_BG  = 'FFE0E7FF'   // azul claro — cabeçalhos dinâmicos
  const C_DYN_FG  = 'FF1E3A8A'
  const C_ODD     = 'FFFFFFFF'
  const C_EVEN    = 'FFF8F9FB'
  const C_DYN_ODD  = 'FFF5F7FF'
  const C_DYN_EVEN = 'FFECEFFD'

  // ── Linha 1: título ───────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols)
  const titleCell = ws.getCell(1, 1)
  titleCell.value     = `Melhor Bolão · Copa 2026 — Relatório de Auditoria de Palpites`
  titleCell.font      = { bold: true, size: 13, color: { argb: C_HDR_FG } }
  titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HDR_BG } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 24

  // ── Linha 2: cabeçalhos ───────────────────────────────────────
  const hRow = ws.getRow(2)
  hRow.height = 36

  const setHdr = (col: number, value: string, dyn = false) => {
    const cell = hRow.getCell(col)
    cell.value     = value
    cell.font      = { bold: true, size: 8.5, color: { argb: dyn ? C_DYN_FG : C_HDR_FG } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: dyn ? C_DYN_BG : C_HDR_BG } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border    = { right: { style: 'thin', color: { argb: dyn ? C_DYN_FG : C_HDR_FG } } }
  }

  setHdr(1, 'Participante')
  setHdr(2, 'Data de\nCadastro')
  setHdr(3, `Status\nRodada Atual${currentRoundLabel ? `\n(${currentRoundLabel})` : ''}`)

  for (let i = 0; i < reportRounds.length; i++) {
    const rnd  = reportRounds[i]
    const col1 = FIXED_COLS + 1 + i * DYN_PER_RND
    const col2 = FIXED_COLS + 2 + i * DYN_PER_RND
    setHdr(col1, `Última alteração\nPalpites Prazo\n${rnd.label}`, true)
    setHdr(col2, `Conclusão\nPalpites Prazo\n${rnd.label}`, true)
  }

  // ── Linhas de dados ───────────────────────────────────────────
  for (let ri = 0; ri < participants.length; ri++) {
    const p      = participants[ri]
    const isEven = ri % 2 === 1
    const baseBg = isEven ? C_EVEN : C_ODD
    const dynBg  = isEven ? C_DYN_EVEN : C_DYN_ODD

    // Determina status na rodada atual
    let statusText  = '—'
    let statusBg    = baseBg
    let statusFg    = 'FF6B7280'
    let statusBold  = false

    if (currentRoundKey && currentRoundTotal > 0) {
      const eliminated = isParticipantEliminated(p.id as string, phaseSettings, qualified)

      if (eliminated) {
        statusText = 'Eliminado'
        statusBg   = 'FFFCE8E8'
        statusFg   = 'FF991B1B'
      } else {
        const filled = currentRoundKey === 'bonus'
          ? (bonusCountByPid.get(p.id as string) ?? 0)
          : (betCountByKey.get(`${p.id}:${currentRoundKey}`) ?? 0)

        if (filled === 0) {
          statusText = 'Não iniciado'
          statusBg   = baseBg
          statusFg   = 'FF9CA3AF'
        } else if (filled >= currentRoundTotal) {
          statusText = 'Completo'
          statusBg   = 'FFE8F5E9'
          statusFg   = 'FF166534'
          statusBold = true
        } else {
          statusText = 'Em andamento'
          statusBg   = 'FFFEF3C7'
          statusFg   = 'FF92400E'
        }
      }
    }

    const row = ws.getRow(3 + ri)
    row.height = 16

    const border: Partial<ExcelJS.Borders> = {
      bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      right:  { style: 'hair', color: { argb: 'FFE5E7EB' } },
    }

    // Col 1: Participante
    const c1 = row.getCell(1)
    c1.value     = p.apelido
    c1.font      = { bold: false, size: 10, color: { argb: 'FF111827' } }
    c1.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } }
    c1.alignment = { horizontal: 'left', vertical: 'middle' }
    c1.border    = border

    // Col 2: Data Cadastro
    const c2 = row.getCell(2)
    c2.value     = fmtDateShort(p.created_at as string)
    c2.font      = { size: 9, color: { argb: 'FF6B7280' } }
    c2.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } }
    c2.alignment = { horizontal: 'center', vertical: 'middle' }
    c2.border    = border

    // Col 3: Status Rodada Atual
    const c3 = row.getCell(3)
    c3.value     = statusText
    c3.font      = { bold: statusBold, size: 9.5, color: { argb: statusFg } }
    c3.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusBg } }
    c3.alignment = { horizontal: 'center', vertical: 'middle' }
    c3.border    = border

    // Colunas dinâmicas por prazo
    for (let ci = 0; ci < reportRounds.length; ci++) {
      const rnd  = reportRounds[ci]
      const col1 = FIXED_COLS + 1 + ci * DYN_PER_RND
      const col2 = FIXED_COLS + 2 + ci * DYN_PER_RND
      const logKey = `${p.id}:${rnd.key}`

      let lastUpdStr = ''
      let completedStr = ''

      if (hasPredLogs) {
        const log = predLogMap.get(logKey)
        if (log) {
          lastUpdStr   = fmtDate(log.last_updated_at)
          completedStr = fmtDate(log.completed_at)
        }
      } else {
        // Fallback sem prediction_logs: usa bets.updated_at para rodadas de partidas
        if (rnd.key !== 'bonus') {
          const lu = lastUpdatedByKey.get(logKey)
          if (lu) lastUpdStr = fmtDate(lu.toISOString())
        }
      }

      const isComplete = !!completedStr

      const cd1 = row.getCell(col1)
      cd1.value     = lastUpdStr || null
      cd1.font      = { size: 9, color: { argb: lastUpdStr ? 'FF374151' : 'FFD1D5DB' } }
      cd1.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: dynBg } }
      cd1.alignment = { horizontal: 'center', vertical: 'middle' }
      cd1.border    = border

      const cd2 = row.getCell(col2)
      cd2.value     = completedStr || null
      cd2.font      = { bold: isComplete, size: 9, color: { argb: isComplete ? 'FF166534' : 'FFD1D5DB' } }
      cd2.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: isComplete ? (isEven ? 'FFE0F2E7' : 'FFE8F5E9') : dynBg } }
      cd2.alignment = { horizontal: 'center', vertical: 'middle' }
      cd2.border    = border
    }
  }

  // ── Gera buffer e nome do arquivo ─────────────────────────────
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  const brNow  = toZonedTime(new Date(), BRASILIA_TZ)
  const stamp  = [
    String(brNow.getUTCMonth() + 1).padStart(2, '0'),
    String(brNow.getUTCDate()).padStart(2, '0'),
    String(brNow.getUTCHours()).padStart(2, '0'),
    String(brNow.getUTCMinutes()).padStart(2, '0'),
  ].join('')
  const fileName = `melhorbolao-copa2026-auditoria-${stamp}.xlsx`

  return { buffer, fileName }
}
