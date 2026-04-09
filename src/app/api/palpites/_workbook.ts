/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs'
type AnySupabase = any

// Colunas
const COL_KEY    = 1
const COL_VAL_A  = 7
const COL_VAL_B  = 8
const COL_TEAM_B = 9
const COL_CITY   = 10
const COL_PRAZO  = 11
const COL_STATUS = 12
const TOTAL_COLS = 12

// Cores
const C_GREEN     = 'FF004D1A'
const C_YELLOW    = 'FFFDE68A'
const C_LOCKED_BG = 'FFF3F4F6'
const C_LOCKED_FG = 'FF9CA3AF'
const C_WHITE     = 'FFFFFFFF'
const C_TEXT      = 'FF111827'
const C_RED_BG    = 'FFFEE2E2'
const C_RED_FG    = 'FFDC2626'
const C_RED_VIVID = 'FFFF0000'

const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

// Converte Date UTC para horário de Brasília (UTC-3) para exibição correta no Excel
function toBR(d: Date): Date { return new Date(d.getTime() - 3 * 60 * 60 * 1000) }

const colToLetter = (n: number): string => {
  let s = ''
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) }
  return s
}

function genPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function makeFileName(apelido: string): string {
  const now = new Date()
  // Selo no horário de Brasília (UTC-3)
  const brNow = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const mm   = String(brNow.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(brNow.getUTCDate()).padStart(2, '0')
  const hh   = String(brNow.getUTCHours()).padStart(2, '0')
  const min  = String(brNow.getUTCMinutes()).padStart(2, '0')
  const selo = `${mm}${dd}${hh}${min}`
  const slug = apelido
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `melhorbolao-copa2026-${slug}-${selo}.xlsx`
}

export async function buildPalpitesBuffer(
  supabase: AnySupabase,
  participantId: string,
  opts?: { blank?: boolean },
): Promise<{ buffer: Buffer; displayName: string; fileName: string }> {
  const [{ data: matches }, { data: profile }] = await Promise.all([
    supabase.from('matches')
      .select('id, match_number, round, group_name, match_datetime, betting_deadline, team_home, team_away, city')
      .eq('phase', 'group')
      .order('match_datetime', { ascending: true }),
    supabase.from('participants').select('apelido').eq('id', participantId).single(),
  ])

  const [bets, groupBets, thirdBets, tBet] = opts?.blank
    ? [null, null, null, null]
    : await Promise.all([
        supabase.from('bets').select('match_id, score_home, score_away').eq('participant_id', participantId).then((r: any) => r.data),
        supabase.from('group_bets').select('group_name, first_place, second_place').eq('participant_id', participantId).then((r: any) => r.data),
        supabase.from('third_place_bets').select('group_name, team').eq('participant_id', participantId).then((r: any) => r.data),
        supabase.from('tournament_bets').select('champion, runner_up, semi1, semi2, top_scorer').eq('participant_id', participantId).maybeSingle().then((r: any) => r.data),
      ])

  const betMap      = new Map((bets      ?? []).map((b: any) => [b.match_id,   b]))
  const groupBetMap = new Map((groupBets ?? []).map((b: any) => [b.group_name, b]))
  const thirdBetMap = new Map((thirdBets ?? []).map((b: any) => [b.group_name, b]))
  const now         = new Date()
  const apelido     = (profile as any)?.apelido || 'participante'
  const displayName = apelido
  const fileName    = makeFileName(apelido)

  const matchList = (matches ?? []) as any[]

  const bonusDeadlineStr = matchList.find((m: any) => m.round === 1)?.betting_deadline ?? ''
  const bonusLocked      = bonusDeadlineStr ? now >= new Date(bonusDeadlineStr) : false
  const bonusDeadline    = bonusDeadlineStr ? new Date(bonusDeadlineStr) : null

  const allTeams = [...new Set(matchList.flatMap((m: any) => [m.team_home, m.team_away]).filter((t: any) => t && t !== 'TBD'))].sort() as string[]

  const teamsByGroup: Record<string, string[]> = {}
  for (const m of matchList) {
    if (!m.group_name) continue
    const g = m.group_name as string
    if (!teamsByGroup[g]) teamsByGroup[g] = []
    for (const t of [m.team_home, m.team_away]) {
      if (t && t !== 'TBD' && !teamsByGroup[g].includes(t)) teamsByGroup[g].push(t)
    }
  }

  const sheetPassword = genPassword()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Melhor Bolão'

  // Planilha de times (oculta)
  const wsTeams = wb.addWorksheet('_Times', { state: 'veryHidden' })
  allTeams.forEach((t, i) => wsTeams.getCell(i + 1, 1).value = t)
  const groupCol = Object.fromEntries(GROUP_ORDER.map((g, i) => [g, i + 2]))
  GROUP_ORDER.forEach((g, gi) => {
    const col = gi + 2
    ;(teamsByGroup[g] ?? []).forEach((t, ti) => wsTeams.getCell(ti + 1, col).value = t)
  })

  const ws = wb.addWorksheet('Palpites', {
    properties: { tabColor: { argb: 'FF009c3b' } },
    views: [{ state: 'frozen', ySplit: 3 }],
  })

  ws.getColumn(COL_KEY).width    = 16
  ws.getColumn(COL_KEY).hidden   = true
  ws.getColumn(2).width          = 14
  ws.getColumn(3).width          = 10
  ws.getColumn(4).width          = 8
  ws.getColumn(5).width          = 18
  ws.getColumn(6).width          = 22
  ws.getColumn(COL_VAL_A).width  = 18
  ws.getColumn(COL_VAL_B).width  = 18
  ws.getColumn(COL_TEAM_B).width = 22
  ws.getColumn(COL_CITY).width   = 18
  ws.getColumn(COL_PRAZO).width  = 18
  ws.getColumn(COL_STATUS).width = 14

  ws.mergeCells(1, 1, 1, TOTAL_COLS)
  const t1 = ws.getCell(1, 1)
  t1.value = `Melhor Bolão · Copa 2026 — Palpites de ${displayName}`
  t1.font  = { bold: true, size: 13, color: { argb: C_WHITE } }
  t1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GREEN } }
  t1.alignment = { horizontal: 'center', vertical: 'middle' }
  t1.protection = { locked: true }
  ws.getRow(1).height = 22

  ws.mergeCells(2, 1, 2, TOTAL_COLS)
  const t2 = ws.getCell(2, 1)
  t2.value = 'Preencha apenas as células amarelas. Células cinzas estão bloqueadas (prazo encerrado).'
  t2.font  = { bold: true, size: 12, color: { argb: C_TEXT } }
  t2.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_YELLOW } }
  t2.alignment = { horizontal: 'center', vertical: 'middle' }
  t2.protection = { locked: true }
  ws.getRow(2).height = 22

  const hdr = ['Chave','Jogo','Etapa','Grupo','Data/Hora','Seleção A','Gols A','Gols B','Seleção B','Cidade','Prazo','Status']
  const hRow = ws.getRow(3)
  hRow.height = 18
  hdr.forEach((h, i) => {
    const cell = hRow.getCell(i + 1)
    cell.value = h
    cell.font  = { bold: true, color: { argb: C_WHITE }, size: 10 }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GREEN } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF4ADE80' } } }
    cell.protection = { locked: true }
  })

  let rowIdx = 4
  const SHRINK_COLS = new Set([COL_VAL_A, COL_VAL_B])

  const addSection = (label: string) => {
    ws.mergeCells(rowIdx, 1, rowIdx, TOTAL_COLS)
    const cell = ws.getCell(rowIdx, 1)
    cell.value = label
    cell.font  = { bold: true, size: 10, color: { argb: 'FF1F2937' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    cell.protection = { locked: true }
    ws.getRow(rowIdx).height = 15
    rowIdx++
  }

  const baseCell = (row: ExcelJS.Row, col: number, value: unknown, locked: boolean, opts?: {
    align?: ExcelJS.Alignment['horizontal']; numFmt?: string; bold?: boolean
  }) => {
    const cell = row.getCell(col)
    cell.value = value as ExcelJS.CellValue
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: locked ? C_LOCKED_BG : C_WHITE } }
    cell.font  = { size: 10, bold: opts?.bold, color: { argb: locked ? C_LOCKED_FG : C_TEXT } }
    cell.alignment = { vertical: 'middle', horizontal: opts?.align ?? 'left', shrinkToFit: SHRINK_COLS.has(col) }
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } }
    if (opts?.numFmt) cell.numFmt = opts.numFmt
    cell.protection = { locked: true }
    return cell
  }

  const editCell = (row: ExcelJS.Row, col: number, value: unknown, locked: boolean, type: 'number' | 'team' | 'text', group?: string) => {
    const cell = row.getCell(col)
    cell.value = (value !== undefined && value !== null) ? value as ExcelJS.CellValue : null
    cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: SHRINK_COLS.has(col) }
    cell.font = { bold: true, size: 11, color: { argb: locked ? C_LOCKED_FG : C_GREEN } }
    cell.border = {
      top:    { style: 'thin', color: { argb: locked ? 'FFD1D5DB' : 'FF86EFAC' } },
      bottom: { style: 'thin', color: { argb: locked ? 'FFD1D5DB' : 'FF86EFAC' } },
      left:   { style: 'thin', color: { argb: locked ? 'FFD1D5DB' : 'FF86EFAC' } },
      right:  { style: 'thin', color: { argb: locked ? 'FFD1D5DB' : 'FF86EFAC' } },
    }
    if (locked) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_LOCKED_BG } }
      cell.protection = { locked: true }
    } else {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_YELLOW } }
      cell.protection = { locked: false }
      if (type === 'number') {
        cell.dataValidation = {
          type: 'whole', operator: 'between', formulae: [0, 30],
          showErrorMessage: true, errorStyle: 'stop',
          errorTitle: 'Valor inválido', error: 'Digite um número inteiro entre 0 e 30.',
        }
      } else if (type === 'team') {
        const colLetter = group && groupCol[group] ? colToLetter(groupCol[group]) : 'A'
        const rowCount  = group && teamsByGroup[group] ? teamsByGroup[group].length : allTeams.length
        cell.dataValidation = {
          type: 'list', allowBlank: true,
          formulae: [`_Times!$${colLetter}$1:$${colLetter}$${rowCount}`],
          showErrorMessage: true, errorStyle: 'stop',
          errorTitle: 'Seleção inválida',
          error: 'Escolha uma seleção oficial da lista. Entradas manuais não são aceitas.',
        }
      }
    }
    return cell
  }

  const grpBetRowNums: number[] = []
  let thirdStartRow = 0
  let thirdEndRow   = 0
  const g4RowNums: number[] = []

  const bonusDeadlineDisplay = toBR(bonusDeadline ?? new Date())
  const bonusStatus = bonusLocked ? '🔒 Bloqueado' : '✏️ Editável'

  // SEÇÃO 1: JOGOS
  let currentRound = 0
  for (const m of matchList) {
    const deadline = new Date(m.betting_deadline)
    const locked   = now >= deadline
    const bet      = betMap.get(m.id)

    if (m.round !== currentRound) {
      currentRound = m.round
      addSection(`RODADA ${m.round}`)
    }

    const row = ws.getRow(rowIdx++)
    row.height = 18
    baseCell(row, COL_KEY,    m.id,           true,   { align: 'center' })
    baseCell(row, 2,          m.match_number, locked, { align: 'center' })
    baseCell(row, 3,          `R${m.round}`,  locked, { align: 'center' })
    baseCell(row, 4,          m.group_name,   locked, { align: 'center' })
    baseCell(row, 5,          toBR(new Date(m.match_datetime)), locked, { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
    baseCell(row, 6,          m.team_home,    locked, { align: 'right' })
    editCell(row, COL_VAL_A,  (bet as any)?.score_home ?? null, locked, 'number')
    editCell(row, COL_VAL_B,  (bet as any)?.score_away ?? null, locked, 'number')
    baseCell(row, COL_TEAM_B, m.team_away,    locked, { align: 'left' })
    baseCell(row, COL_CITY,   m.city ?? '',   locked, { align: 'center' })
    baseCell(row, COL_PRAZO,  toBR(deadline), true,   { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
    baseCell(row, COL_STATUS, locked ? '🔒 Bloqueado' : '✏️ Editável', true, { align: 'center' })
  }

  // SEÇÃO 2: CLASSIFICADOS POR GRUPO
  addSection('BÔNUS: CLASSIFICADOS POR GRUPO (1º e 2º lugar)')
  const gbHdr = ws.getRow(rowIdx++)
  gbHdr.height = 14
  baseCell(gbHdr, COL_KEY, '', true, {})
  const lbl = gbHdr.getCell(2); lbl.value = 'Grupo'; lbl.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } }; lbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; lbl.protection = { locked: true }
  for (let c = 3; c <= 6; c++) { const cc = gbHdr.getCell(c); cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; cc.protection = { locked: true } }
  const h7 = gbHdr.getCell(COL_VAL_A); h7.value = '1º Lugar'; h7.font = { bold: true, size: 9, color: { argb: 'FF065F46' } }; h7.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; h7.alignment = { horizontal: 'center' }; h7.protection = { locked: true }
  const h8 = gbHdr.getCell(COL_VAL_B); h8.value = '2º Lugar'; h8.font = { bold: true, size: 9, color: { argb: 'FF065F46' } }; h8.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; h8.alignment = { horizontal: 'center' }; h8.protection = { locked: true }
  for (let c = COL_TEAM_B; c <= TOTAL_COLS; c++) { const cc = gbHdr.getCell(c); cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; cc.protection = { locked: true } }

  for (const g of GROUP_ORDER) {
    const gb     = groupBetMap.get(g) as any
    const rowNum = rowIdx
    const row    = ws.getRow(rowIdx++)
    row.height   = 18
    grpBetRowNums.push(rowNum)
    baseCell(row, COL_KEY,    `grp_bet:${g}`,  true,        { align: 'center' })
    baseCell(row, 2,          `Grupo ${g}`,    bonusLocked, { align: 'center', bold: true })
    for (let c = 3; c <= 6; c++) baseCell(row, c, '', bonusLocked, {})
    editCell(row, COL_VAL_A,  gb?.first_place  ?? null, bonusLocked, 'team', g)
    editCell(row, COL_VAL_B,  gb?.second_place ?? null, bonusLocked, 'team', g)
    baseCell(row, COL_TEAM_B, '', bonusLocked, {})
    baseCell(row, COL_CITY,   '', bonusLocked, {})
    baseCell(row, COL_PRAZO,  bonusDeadlineDisplay, true, { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
    baseCell(row, COL_STATUS, bonusStatus, true, { align: 'center' })
  }

  // SEÇÃO 3: TERCEIROS CLASSIFICADOS
  addSection('BÔNUS: TERCEIROS CLASSIFICADOS (escolha exatamente 8 dos 12 grupos)')
  const t3Hdr = ws.getRow(rowIdx++)
  t3Hdr.height = 14
  baseCell(t3Hdr, COL_KEY, '', true, {})
  const t3lb = t3Hdr.getCell(2); t3lb.value = 'Grupo'; t3lb.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } }; t3lb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; t3lb.protection = { locked: true }
  for (let c = 3; c <= 6; c++) { const cc = t3Hdr.getCell(c); cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; cc.protection = { locked: true } }
  const t3h7 = t3Hdr.getCell(COL_VAL_A); t3h7.value = '3º Lugar'; t3h7.font = { bold: true, size: 9, color: { argb: 'FF065F46' } }; t3h7.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; t3h7.alignment = { horizontal: 'center' }; t3h7.protection = { locked: true }
  for (let c = COL_VAL_B; c <= TOTAL_COLS; c++) { const cc = t3Hdr.getCell(c); cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; cc.protection = { locked: true } }

  for (const g of GROUP_ORDER) {
    const tb     = thirdBetMap.get(g) as any
    const rowNum = rowIdx
    if (thirdStartRow === 0) thirdStartRow = rowNum
    thirdEndRow  = rowNum
    const row    = ws.getRow(rowIdx++)
    row.height   = 18
    baseCell(row, COL_KEY,    `grp_3rd:${g}`, true,        { align: 'center' })
    baseCell(row, 2,          `Grupo ${g}`,   bonusLocked, { align: 'center', bold: true })
    for (let c = 3; c <= 6; c++) baseCell(row, c, '', bonusLocked, {})
    editCell(row, COL_VAL_A,  tb?.team ?? null, bonusLocked, 'team', g)
    baseCell(row, COL_VAL_B,  '', bonusLocked, {})
    baseCell(row, COL_TEAM_B, '', bonusLocked, {})
    baseCell(row, COL_CITY,   '', bonusLocked, {})
    baseCell(row, COL_PRAZO,  bonusDeadlineDisplay, true, { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
    baseCell(row, COL_STATUS, bonusStatus, true, { align: 'center' })
  }

  if (thirdStartRow > 0 && !bonusLocked) {
    const warnRowNum = rowIdx++
    const wRow = ws.getRow(warnRowNum)
    wRow.height = 16
    ws.mergeCells(warnRowNum, COL_KEY, warnRowNum, 6)
    const wLabel = wRow.getCell(COL_KEY)
    wLabel.value = '→ Preencha exatamente 8 grupos acima. Fundo vermelho = excedeu o limite.'
    wLabel.font  = { italic: true, size: 9, color: { argb: 'FF6B7280' } }
    wLabel.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }
    wLabel.protection = { locked: true }
    for (let c = COL_VAL_A; c <= TOTAL_COLS - 1; c++) {
      const cc = wRow.getCell(c); cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; cc.protection = { locked: true }
    }
    const gL = colToLetter(COL_VAL_A)
    const warnCell = wRow.getCell(COL_STATUS)
    warnCell.value = { formula: `IF(COUNTA($${gL}$${thirdStartRow}:$${gL}$${thirdEndRow})>8,"⚠️ ERRO: Máx 8 (atual: "&COUNTA($${gL}$${thirdStartRow}:$${gL}$${thirdEndRow})&")","✓ "&COUNTA($${gL}$${thirdStartRow}:$${gL}$${thirdEndRow})&"/8 grupos")` }
    warnCell.font      = { bold: true, size: 9, color: { argb: 'FF374151' } }
    warnCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }
    warnCell.alignment = { horizontal: 'center', vertical: 'middle' }
    warnCell.protection = { locked: true }
  }

  // SEÇÃO 4: G4 E ARTILHEIRO
  addSection('BÔNUS: G4 (todos devem ser diferentes)')
  const trnRows = [
    { key: 'trn:champion',  label: 'Campeão',      value: (tBet as any)?.champion   ?? null },
    { key: 'trn:runner_up', label: 'Vice-Campeão', value: (tBet as any)?.runner_up  ?? null },
    { key: 'trn:semi1',     label: '3º Lugar',     value: (tBet as any)?.semi1      ?? null },
    { key: 'trn:semi2',     label: '4º Lugar',     value: (tBet as any)?.semi2      ?? null },
  ]
  for (const t of trnRows) {
    const rowNum = rowIdx
    const row    = ws.getRow(rowIdx++)
    row.height   = 18
    g4RowNums.push(rowNum)
    baseCell(row, COL_KEY,   t.key,   true,        { align: 'center' })
    baseCell(row, 2,         t.label, bonusLocked, { bold: true })
    for (let c = 3; c <= 6; c++) baseCell(row, c, '', bonusLocked, {})
    editCell(row, COL_VAL_A, t.value, bonusLocked, 'team')
    for (let c = COL_VAL_B; c <= TOTAL_COLS - 2; c++) baseCell(row, c, '', bonusLocked, {})
    baseCell(row, COL_PRAZO,  bonusDeadlineDisplay, true, { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
    baseCell(row, COL_STATUS, bonusStatus, true, { align: 'center' })
  }

  addSection('BÔNUS: ARTILHEIRO')
  const scorerRow = ws.getRow(rowIdx++)
  scorerRow.height = 18
  baseCell(scorerRow, COL_KEY,   'trn:scorer', true,        { align: 'center' })
  baseCell(scorerRow, 2,         'Artilheiro', bonusLocked, { bold: true })
  for (let c = 3; c <= 6; c++) baseCell(scorerRow, c, '', bonusLocked, {})
  editCell(scorerRow, COL_VAL_A, (tBet as any)?.top_scorer ?? null, bonusLocked, 'text')
  for (let c = COL_VAL_B; c <= TOTAL_COLS - 2; c++) baseCell(scorerRow, c, '', bonusLocked, {})
  baseCell(scorerRow, COL_PRAZO,  bonusDeadlineDisplay, true, { align: 'center', numFmt: 'dd/MM/yy HH:mm' })
  baseCell(scorerRow, COL_STATUS, bonusStatus, true, { align: 'center' })

  // FORMATAÇÃO CONDICIONAL
  if (!bonusLocked) {
    const gL = colToLetter(COL_VAL_A)
    const hL = colToLetter(COL_VAL_B)

    for (const rowNum of grpBetRowNums) {
      ws.addConditionalFormatting({
        ref: `${gL}${rowNum}:${hL}${rowNum}`,
        rules: [{ type: 'expression', formulae: [`AND($${gL}$${rowNum}<>"", $${gL}$${rowNum}=$${hL}$${rowNum})`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C_RED_BG } }, font: { color: { argb: C_RED_FG }, bold: true } }, priority: 1 }],
      })
    }

    if (thirdStartRow > 0) {
      const thirdRange = `${gL}${thirdStartRow}:${gL}${thirdEndRow}`
      ws.addConditionalFormatting({ ref: thirdRange, rules: [{ type: 'expression', formulae: [`COUNTA($${gL}$${thirdStartRow}:$${gL}$${thirdEndRow})>8`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C_RED_VIVID } }, font: { color: { argb: C_WHITE }, bold: true } }, priority: 1 }] })
      ws.addConditionalFormatting({ ref: thirdRange, rules: [{ type: 'expression', formulae: [`AND(${gL}${thirdStartRow}<>"", COUNTIF($${gL}$${thirdStartRow}:$${gL}$${thirdEndRow}, ${gL}${thirdStartRow})>1)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C_RED_BG } }, font: { color: { argb: C_RED_FG }, bold: true } }, priority: 2 }] })
    }

    if (g4RowNums.length === 4) {
      ws.addConditionalFormatting({ ref: `${gL}${g4RowNums[0]}:${gL}${g4RowNums[3]}`, rules: [{ type: 'expression', formulae: [`AND(${gL}${g4RowNums[0]}<>"", COUNTIF($${gL}$${g4RowNums[0]}:$${gL}$${g4RowNums[3]}, ${gL}${g4RowNums[0]})>1)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: C_RED_BG } }, font: { color: { argb: C_RED_FG }, bold: true } }, priority: 1 }] })
    }
  }

  await ws.protect(sheetPassword, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertColumns: false, insertRows: false,
    deleteColumns: false, deleteRows: false,
    sort: false, autoFilter: false,
  })

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, displayName, fileName }
}
