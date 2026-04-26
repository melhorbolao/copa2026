/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'
import { toZonedTime } from 'date-fns-tz'

const BRASILIA_TZ = 'America/Sao_Paulo'
const GROUP_ORDER = ['A','B','C','D','E','F','G','H','I','J','K','L']

const C_GREEN    = 'FF004D1A'
const C_WHITE    = 'FFFFFFFF'
const C_GRAY_BG  = 'FFF3F4F6'
const C_TEXT     = 'FF111827'
const C_MUTED    = 'FFD1D5DB'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const admin = createAuthAdminClient() as any

  const [
    { data: matchesRaw },
    { data: participantsRaw },
    { data: betsRaw },
    { data: groupBetsRaw },
    { data: thirdBetsRaw },
    { data: tBetsRaw },
  ] = await Promise.all([
    admin.from('matches')
      .select('id, match_number, round, phase, group_name, team_home, team_away')
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
  const matches      = (matchesRaw ?? []) as any[]

  const betMap      = new Map<string, any>()
  for (const b of (betsRaw ?? []) as any[])
    betMap.set(`${b.participant_id}:${b.match_id}`, b)

  const grpBetMap = new Map<string, any>()
  for (const b of (groupBetsRaw ?? []) as any[])
    grpBetMap.set(`${b.participant_id}:${b.group_name}`, b)

  const thirdBetMap = new Map<string, any>()
  for (const b of (thirdBetsRaw ?? []) as any[])
    thirdBetMap.set(`${b.participant_id}:${b.group_name}`, b)

  const tBetMap = new Map<string, any>()
  for (const b of (tBetsRaw ?? []) as any[])
    tBetMap.set(b.participant_id, b)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Melhor Bolão'

  const totalCols = 2 + participants.length

  const ws = wb.addWorksheet('Palpites', {
    properties: { tabColor: { argb: 'FF009c3b' } },
    views: [{ state: 'frozen', ySplit: 2 }],
  })

  // Column widths
  ws.getColumn(1).width  = 40
  ws.getColumn(1).hidden = true
  ws.getColumn(2).width  = 38
  participants.forEach((_, i) => { ws.getColumn(3 + i).width = 14 })

  // Row 1: title
  ws.mergeCells(1, 1, 1, Math.max(totalCols, 3))
  const t1 = ws.getCell(1, 1)
  t1.value = 'Melhor Bolão · Copa 2026 — Todos os Palpites'
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
  setHdr(1, 'Chave')
  setHdr(2, 'Descrição')
  participants.forEach((p, i) => setHdr(3 + i, p.apelido))

  let rowIdx = 3

  const addSection = (label: string) => {
    ws.mergeCells(rowIdx, 1, rowIdx, Math.max(totalCols, 3))
    const cell = ws.getCell(rowIdx, 1)
    cell.value = label
    cell.font  = { bold: true, size: 10, color: { argb: 'FF1F2937' } }
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
    cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }
    ws.getRow(rowIdx).height = 15
    rowIdx++
  }

  const addDataRow = (key: string, desc: string, values: (string | null)[]) => {
    const row = ws.getRow(rowIdx++)
    row.height = 16

    const keyCell = row.getCell(1)
    keyCell.value = key
    keyCell.font  = { size: 9, color: { argb: '999CA3AF' } }
    keyCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_GRAY_BG } }

    const descCell = row.getCell(2)
    descCell.value = desc
    descCell.font  = { size: 10, color: { argb: C_TEXT } }
    descCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_WHITE } }
    descCell.alignment = { horizontal: 'left', vertical: 'middle' }
    descCell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }

    values.forEach((v, i) => {
      const cell = row.getCell(3 + i)
      cell.value = v || null
      cell.font  = { bold: !!v, size: 10, color: { argb: v ? C_GREEN : C_MUTED } }
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_WHITE } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } }
    })
  }

  // ── MATCHES ──────────────────────────────────────────────────
  const PHASE_LABEL: Record<string, string> = {
    group: 'FASE DE GRUPOS',
    round_of_32: 'FASE DE 32',
    round_of_16: 'OITAVAS DE FINAL',
    quarterfinal: 'QUARTAS DE FINAL',
    semifinal: 'SEMIFINAL',
    third_place: 'DISPUTA DE 3º LUGAR',
    final: 'FINAL',
  }

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
    const values = participants.map((p: any) => {
      const bet = betMap.get(`${p.id}:${m.id}`)
      return bet ? `${bet.score_home}-${bet.score_away}` : null
    })
    addDataRow(m.id, desc, values)
  }

  // ── GROUP BETS ────────────────────────────────────────────────
  addSection('BÔNUS: 1º CLASSIFICADO POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(
      `grp_bet_1:${g}`,
      `Grupo ${g} – 1º Lugar`,
      participants.map((p: any) => grpBetMap.get(`${p.id}:${g}`)?.first_place ?? null),
    )
  }

  addSection('BÔNUS: 2º CLASSIFICADO POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(
      `grp_bet_2:${g}`,
      `Grupo ${g} – 2º Lugar`,
      participants.map((p: any) => grpBetMap.get(`${p.id}:${g}`)?.second_place ?? null),
    )
  }

  // ── THIRD BETS ────────────────────────────────────────────────
  addSection('BÔNUS: 3ºS CLASSIFICADOS POR GRUPO')
  for (const g of GROUP_ORDER) {
    addDataRow(
      `grp_3rd:${g}`,
      `Grupo ${g} – 3º Lugar`,
      participants.map((p: any) => thirdBetMap.get(`${p.id}:${g}`)?.team ?? null),
    )
  }

  // ── G4 ────────────────────────────────────────────────────────
  addSection('BÔNUS: G4')
  for (const { key, label, field } of [
    { key: 'trn:champion',  label: 'Campeão',      field: 'champion'  },
    { key: 'trn:runner_up', label: 'Vice-Campeão', field: 'runner_up' },
    { key: 'trn:semi1',     label: '3º Lugar',     field: 'semi1'     },
    { key: 'trn:semi2',     label: '4º Lugar',     field: 'semi2'     },
  ]) {
    addDataRow(key, `G4 – ${label}`, participants.map((p: any) => tBetMap.get(p.id)?.[field] ?? null))
  }

  // ── SCORER ────────────────────────────────────────────────────
  addSection('BÔNUS: ARTILHEIRO')
  addDataRow(
    'trn:scorer',
    'Artilheiro',
    participants.map((p: any) => tBetMap.get(p.id)?.top_scorer ?? null),
  )

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())

  const brNow  = toZonedTime(new Date(), BRASILIA_TZ)
  const stamp  = `${String(brNow.getUTCMonth()+1).padStart(2,'0')}${String(brNow.getUTCDate()).padStart(2,'0')}${String(brNow.getUTCHours()).padStart(2,'0')}${String(brNow.getUTCMinutes()).padStart(2,'0')}`
  const fileName = `melhorbolao-copa2026-todos-palpites-${stamp}.xlsx`

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
