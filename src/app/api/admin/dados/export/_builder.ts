/* eslint-disable @typescript-eslint/no-explicit-any */
import ExcelJS from 'exceljs'
import { toZonedTime } from 'date-fns-tz'
import { createAuthAdminClient } from '@/lib/supabase/server'
import { isMatchBetsVisible, isBonusVisible, type VisibilitySettings } from '@/lib/production-mode'

const BRASILIA_TZ = 'America/Sao_Paulo'
const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const C_GREEN   = 'FF004D1A'
const C_WHITE   = 'FFFFFFFF'
const C_GRAY_BG = 'FFF3F4F6'
const C_TEXT    = 'FF111827'
const C_MUTED   = 'FFD1D5DB'

const PHASE_LABEL: Record<string, string> = {
  group:        'FASE DE GRUPOS',
  round_of_32:  '16 AVOS DE FINAL',
  round_of_16:  'OITAVAS DE FINAL',
  quarterfinal: 'QUARTAS DE FINAL',
  semifinal:    'SEMIFINAL',
  third_place:  '3º LUGAR',
  final:        'FINAL',
}

// Phases must never be mixed by datetime — group always before knockouts.
const PHASE_ORDER: Record<string, number> = {
  group: 0,
  round_of_32: 100,
  round_of_16: 200,
  quarterfinal: 300,
  semifinal: 400,
  third_place: 500,
  final: 600,
}

// Column indices
const COL_KEY  = 1   // hidden
const COL_DATE = 2   // Data/Hora
const COL_DESC = 3   // Descrição
const COL_PART = 4   // first participant

export async function buildTabelaMBBuffer(
  settings: VisibilitySettings,
): Promise<{ buffer: Buffer; fileName: string }> {
  const admin = createAuthAdminClient() as any
  const now   = new Date()

  const [
    { data: matchesRaw },
    { data: participantsRaw },
    { data: betsRaw },
    { data: groupBetsRaw },
    { data: thirdBetsRaw },
    { data: tBetsRaw },
  ] = await Promise.all([
    admin.from('matches')
      .select('id, match_number, round, phase, group_name, team_home, team_away, betting_deadline, match_datetime')
      .order('match_datetime', { ascending: true }),
    admin.from('participants')
      .select('id, apelido')
      .order('apelido', { ascending: true }),
    admin.from('bets')
      .select('participant_id, match_id, score_home, score_away'),
    admin.from('group_bets')
      .select('participant_id, group_name, first_place, second_place'),
    admin.from('third_place_bets')
      .select('participant_id, group_name, team'),
    admin.from('tournament_bets')
      .select('participant_id, champion, runner_up, semi1, semi2, top_scorer'),
  ])

  const participants = (participantsRaw ?? []) as any[]

  // Sort by phase order → round → match_datetime so phases are never interleaved.
  const matches = ([...(matchesRaw ?? [])] as any[]).sort((a, b) => {
    const pa = PHASE_ORDER[a.phase] ?? 999
    const pb = PHASE_ORDER[b.phase] ?? 999
    if (pa !== pb) return pa - pb
    if ((a.round ?? 0) !== (b.round ?? 0)) return (a.round ?? 0) - (b.round ?? 0)
    return new Date(a.match_datetime).getTime() - new Date(b.match_datetime).getTime()
  })

  // Compute bonus deadline (round 1 of group phase)
  const bonusDeadlineStr = matches.find(m => m.phase === 'group' && m.round === 1)?.betting_deadline ?? null
  const bonusViz = isBonusVisible(bonusDeadlineStr, now, settings)

  // Build visible match IDs
  const visibleMatchIds = new Set<string>(
    matches
      .filter(m => isMatchBetsVisible(m.phase, m.round, m.betting_deadline, now, settings))
      .map(m => m.id as string),
  )

  // Filter bets
  const filteredBets      = (betsRaw ?? []).filter((b: any) => visibleMatchIds.has(b.match_id))
  const filteredGroupBets = bonusViz ? (groupBetsRaw ?? []) : []
  const filteredThirdBets = bonusViz ? (thirdBetsRaw ?? []) : []
  const filteredTBets     = bonusViz ? (tBetsRaw ?? []) : []

  // Build lookup maps
  const betMap = new Map<string, any>()
  for (const b of filteredBets as any[]) betMap.set(`${b.participant_id}:${b.match_id}`, b)

  const grpBetMap = new Map<string, any>()
  for (const b of filteredGroupBets as any[]) grpBetMap.set(`${b.participant_id}:${b.group_name}`, b)

  const thirdBetMap = new Map<string, any>()
  for (const b of filteredThirdBets as any[]) thirdBetMap.set(`${b.participant_id}:${b.group_name}`, b)

  const tBetMap = new Map<string, any>()
  for (const b of filteredTBets as any[]) tBetMap.set(b.participant_id, b)

  // Build Excel
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Melhor Bolão'

  // Layout: COL_KEY(hidden) | COL_DATE | COL_DESC | COL_PART … COL_PART+n
  const totalCols = Math.max(COL_PART - 1 + participants.length, COL_PART)

  const ws = wb.addWorksheet('Palpites', {
    properties: { tabColor: { argb: 'FF009c3b' } },
    views: [{ state: 'frozen', ySplit: 2 }],
  })

  ws.getColumn(COL_KEY).width  = 40
  ws.getColumn(COL_KEY).hidden = true
  ws.getColumn(COL_DATE).width = 13   // "dd/MM HH:mm"
  ws.getColumn(COL_DESC).width = 36
  participants.forEach((_, i) => { ws.getColumn(COL_PART + i).width = 14 })

  // Row 1: title
  ws.mergeCells(1, 1, 1, totalCols)
  const t1 = ws.getCell(1, 1)
  t1.value = `Melhor Bolão · Copa 2026 — Todos os Palpites${settings.productionMode ? ' (Modo Produção)' : ''}`
  t1.font  = { bold: true, size: 13, color: { argb: C_WHITE } }
  t1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GREEN } }
  t1.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 22

  // Row 2: headers
  const hRow = ws.getRow(2)
  hRow.height = 18
  const setHdr = (col: number, value: string) => {
    const cell = hRow.getCell(col)
    cell.value = value
    cell.font  = { bold: true, size: 10, color: { argb: C_WHITE } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GREEN } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  }
  setHdr(COL_KEY,  'Chave')
  setHdr(COL_DATE, 'Data/Hora')
  setHdr(COL_DESC, 'Descrição')
  participants.forEach((p: any, i) => setHdr(COL_PART + i, p.apelido))

  let rowIdx = 3

  const addSection = (label: string) => {
    ws.mergeCells(rowIdx, 1, rowIdx, totalCols)
    const cell = ws.getCell(rowIdx, 1)
    cell.value = label
    cell.font  = { bold: true, size: 10, color: { argb: 'FF1F2937' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    ws.getRow(rowIdx).height = 15
    rowIdx++
  }

  const addDataRow = (key: string, datetime: Date | null, desc: string, values: (string | null)[]) => {
    const row = ws.getRow(rowIdx++)
    row.height = 16

    const keyCell = row.getCell(COL_KEY)
    keyCell.value = key
    keyCell.font  = { size: 9, color: { argb: '999CA3AF' } }
    keyCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRAY_BG } }

    const dateCell = row.getCell(COL_DATE)
    if (datetime) {
      dateCell.value  = toZonedTime(datetime, BRASILIA_TZ)
      dateCell.numFmt = 'dd/MM HH:mm'
    }
    dateCell.font  = { size: 9, color: { argb: 'FF6B7280' } }
    dateCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRAY_BG } }
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' }
    dateCell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }

    const descCell = row.getCell(COL_DESC)
    descCell.value = desc
    descCell.font  = { size: 10, color: { argb: C_TEXT } }
    descCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_WHITE } }
    descCell.alignment = { horizontal: 'left', vertical: 'middle' }
    descCell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }

    values.forEach((v, i) => {
      const cell = row.getCell(COL_PART + i)
      cell.value = v || null
      cell.font  = { bold: !!v, size: 10, color: { argb: v ? C_GREEN : C_MUTED } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_WHITE } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }
    })
  }

  // ── MATCHES ──────────────────────────────────────────────────
  let currentSection = ''
  for (const m of matches) {
    const sectionKey = m.phase === 'group' ? `group_r${m.round}` : m.phase
    if (sectionKey !== currentSection) {
      currentSection = sectionKey
      const label = m.phase === 'group'
        ? `RODADA ${m.round} (FASE DE GRUPOS)`
        : (PHASE_LABEL[m.phase] ?? m.phase.toUpperCase())
      addSection(label)
    }
    const desc = `J${m.match_number} ${m.team_home ?? '?'} vs ${m.team_away ?? '?'}${m.group_name ? ` (Grp ${m.group_name})` : ''}`
    const dt   = m.match_datetime ? new Date(m.match_datetime) : null
    const values = participants.map((p: any) => {
      const bet = betMap.get(`${p.id}:${m.id}`)
      return bet ? `${bet.score_home}-${bet.score_away}` : null
    })
    addDataRow(m.id, dt, desc, values)
  }

  // ── GROUP BETS ────────────────────────────────────────────────
  addSection('BÔNUS: 1º CLASSIFICADO POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(`grp_bet_1:${g}`, null, `Grupo ${g} – 1º Lugar`,
      participants.map((p: any) => grpBetMap.get(`${p.id}:${g}`)?.first_place ?? null))
  }
  addSection('BÔNUS: 2º CLASSIFICADO POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(`grp_bet_2:${g}`, null, `Grupo ${g} – 2º Lugar`,
      participants.map((p: any) => grpBetMap.get(`${p.id}:${g}`)?.second_place ?? null))
  }

  // ── THIRD BETS ────────────────────────────────────────────────
  addSection('BÔNUS: 3ºS CLASSIFICADOS POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(`grp_3rd:${g}`, null, `Grupo ${g} – 3º Lugar`,
      participants.map((p: any) => thirdBetMap.get(`${p.id}:${g}`)?.team ?? null))
  }

  // ── G4 ────────────────────────────────────────────────────────
  addSection('BÔNUS: G4')
  for (const { key, label, field } of [
    { key: 'trn:champion',  label: 'Campeão',      field: 'champion'  },
    { key: 'trn:runner_up', label: 'Vice-Campeão', field: 'runner_up' },
    { key: 'trn:semi1',     label: '3º Lugar',     field: 'semi1'     },
    { key: 'trn:semi2',     label: '4º Lugar',     field: 'semi2'     },
  ]) {
    addDataRow(key, null, `G4 – ${label}`, participants.map((p: any) => tBetMap.get(p.id)?.[field] ?? null))
  }

  // ── SCORER ────────────────────────────────────────────────────
  addSection('BÔNUS: ARTILHEIRO')
  addDataRow('trn:scorer', null, 'Artilheiro',
    participants.map((p: any) => tBetMap.get(p.id)?.top_scorer ?? null))

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  const brNow  = toZonedTime(new Date(), BRASILIA_TZ)
  const stamp  = `${String(brNow.getUTCMonth()+1).padStart(2,'0')}${String(brNow.getUTCDate()).padStart(2,'0')}${String(brNow.getUTCHours()).padStart(2,'0')}${String(brNow.getUTCMinutes()).padStart(2,'0')}`
  const suffix = settings.productionMode ? '-producao' : ''
  const fileName = `melhorbolao-copa2026-todos-palpites${suffix}-${stamp}.xlsx`

  return { buffer, fileName }
}
