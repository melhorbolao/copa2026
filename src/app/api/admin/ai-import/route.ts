// POST /api/admin/ai-import
// Admin-only. Lê os 4 arquivos Excel de palpites-IA/ e popula ai_models_performance.
// Suporta 3 variantes de formato:
//   Formato A — Claude.xlsx, grok.xlsx  : aba "Palpites", 3 linhas de header, col7/col8 = gols
//   Formato A* — chatgpt.xlsx           : igual ao A mas workbook.xml usa namespace x: e IDs GUID
//   Formato B — gemini.xlsx             : aba diferente, id-N nos jogos 25+, bonus:* para G4, col9 para terceiros

import { NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'

const MODEL_FILES = [
  { file: 'Claude.xlsx',   model_name: 'Claude Opus 4.7 Adaptativo (pago)', model_version: 'claude-opus-4-7',   sort_order: 1 },
  { file: 'gemini.xlsx',   model_name: 'Gemini Pro Estendido (pago)',        model_version: 'gemini-2.5-pro',    sort_order: 2 },
  { file: 'chatgpt.xlsx',  model_name: 'ChatGPT Plus Thinking (pago)',       model_version: 'gpt-4o',            sort_order: 3 },
  { file: 'grok.xlsx',     model_name: 'Grok Fast (gratuito)',               model_version: 'grok-3',            sort_order: 4 },
]

// ── Helpers de parse ──────────────────────────────────────────────────────────

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 30) return null
  return n
}

const EMPTY_VALS = new Set(['', '— time —', '-- time --', '-', '—', '– time –', 'Não'])
function parseStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return EMPTY_VALS.has(s) || s.length === 0 ? null : s
}

// ── Carregamento do workbook com fallback para xlsx não-padrão ────────────────
// chatgpt.xlsx foi gerado com workbook.xml usando namespace prefixado (x:) e
// IDs de relacionamento GUID — ExcelJS não consegue ler. Normalizamos o XML
// na memória antes de passar para o ExcelJS.

async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
    return wb
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip')
    const raw   = fs.readFileSync(filePath)
    const zip   = await JSZip.loadAsync(raw)

    // 1. Normaliza TODOS os XMLs que usam namespace prefixado x: (chatgpt.xlsx usa em workbook,
    //    sharedStrings, styles e worksheets — ExcelJS só aceita tags sem prefixo)
    for (const [name, entry] of Object.entries(zip.files) as [string, { async: (t: string) => Promise<string> }][]) {
      if (!name.endsWith('.xml')) continue
      let xml = (await entry.async('string')).replace(/^﻿/, '')
      if (!xml.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml')) continue
      // Remove prefixo x: dos nomes de elementos (<x:tag> → <tag>)
      xml = xml.replace(/(<\/?)x:/g, '$1')
      // Substitui declaração de namespace prefixada pela não-prefixada
      xml = xml.replace(
        /xmlns:x="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml[^"]*"/g,
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
      )
      zip.file(name, xml)
    }

    // 2. Normaliza workbook.xml.rels: converte IDs GUID → rId1, rId2 …
    const relsEntry = zip.file('xl/_rels/workbook.xml.rels')
    if (relsEntry) {
      let relsXml  = (await relsEntry.async('string')).replace(/^﻿/, '')
      const guidMap = new Map<string, string>()
      let counter   = 1
      relsXml = relsXml.replace(/Id="([^"]+)"/g, (_: string, id: string) => {
        if (!guidMap.has(id)) guidMap.set(id, `rId${counter++}`)
        return `Id="${guidMap.get(id)!}"`
      })
      zip.file('xl/_rels/workbook.xml.rels', relsXml)

      // 3. Atualiza referências de ID no workbook.xml
      const wbEntry2 = zip.file('xl/workbook.xml')
      if (wbEntry2 && guidMap.size > 0) {
        let wbXml = await wbEntry2.async('string')
        for (const [guid, rid] of guidMap) wbXml = wbXml.split(guid).join(rid)
        zip.file('xl/workbook.xml', wbXml)
      }
    }

    const fixedBuf = await zip.generateAsync({ type: 'nodebuffer' })
    const wb2 = new ExcelJS.Workbook()
    await (wb2.xlsx.load as (b: unknown) => Promise<unknown>)(fixedBuf)
    return wb2
  }
}

// ── Tipos de resultado ────────────────────────────────────────────────────────

type Palpites = {
  matches:          Record<string, { score_home: number; score_away: number }>
  group_bets:       Record<string, { first_place: string; second_place: string }>
  third_place_bets: Record<string, string>
  tournament_bet:   { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string } | null
}

function buildPalpites(
  matches:          Record<string, { score_home: number; score_away: number }>,
  group_bets:       Record<string, { first_place: string; second_place: string }>,
  third_place_bets: Record<string, string>,
  trn:              Record<string, string>,
): Palpites {
  return {
    matches,
    group_bets,
    third_place_bets,
    tournament_bet: Object.keys(trn).length > 0
      ? { champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '', ...trn }
      : null,
  }
}

// ── Parsers por formato ───────────────────────────────────────────────────────

// Formato A: Claude.xlsx, grok.xlsx, chatgpt.xlsx
// - Aba "Palpites"
// - Linhas 1-3: header/instrução/colunas
// - col1 = key (UUID | grp_bet:X | grp_3rd:X | trn:*)
// - col7 = valor A (gols home / 1º lugar / time / campeão…)
// - col8 = valor B (gols away / 2º lugar)
function parseFormatA(ws: ExcelJS.Worksheet): Palpites {
  const matches: Palpites['matches']     = {}
  const groupBets: Palpites['group_bets'] = {}
  const thirds: Palpites['third_place_bets'] = {}
  const trn: Record<string, string>      = {}

  const trnKeyMap: Record<string, string> = {
    champion: 'champion', runner_up: 'runner_up',
    semi1: 'semi1', semi2: 'semi2', scorer: 'top_scorer',
  }

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 3) return
    const key  = row.getCell(1).value?.toString().trim() ?? ''
    const valA = row.getCell(7).value
    const valB = row.getCell(8).value
    if (!key || key === 'Chave') return

    if (!key.includes(':')) {
      const h = parseNum(valA); const a = parseNum(valB)
      if (h !== null && a !== null) matches[key] = { score_home: h, score_away: a }
    } else if (key.startsWith('grp_bet:')) {
      const g = key.slice(8)
      const f = parseStr(valA); const s = parseStr(valB)
      if (f && s) groupBets[g] = { first_place: f, second_place: s }
    } else if (key.startsWith('grp_3rd:')) {
      const g = key.slice(8); const t = parseStr(valA)
      if (t) thirds[g] = t
    } else if (key.startsWith('trn:')) {
      const field = key.slice(4); const val = parseStr(valA)
      const db    = trnKeyMap[field]
      if (db && val) trn[db] = val
    }
  })

  return buildPalpites(matches, groupBets, thirds, trn)
}

// Formato B: gemini.xlsx
// - Aba "Palpites - Melhor Bolão 2026 V3"
// - Linha 1: cabeçalhos (sem linhas de título)
// - col1 = key (UUID para jogos 1-24, id-N para jogos 25-72)
// - col7 = valor A (gols / "Sim"/"Não" para terceiros / time para bonus:*)
// - col8 = valor B (gols)
// - col9 = time para grp_3rd quando col7="Sim"
// - Sem grp_bet:X
// - G4: chaves bonus:1st/2nd/3rd/4th/top_scorer
function parseFormatB(ws: ExcelJS.Worksheet, matchNumToId: Map<number, string>): Palpites {
  const matches: Palpites['matches']     = {}
  const groupBets: Palpites['group_bets'] = {}
  const thirds: Palpites['third_place_bets'] = {}
  const trn: Record<string, string>      = {}

  const bonusKeyMap: Record<string, string> = {
    '1st': 'champion', '2nd': 'runner_up',
    '3rd': 'semi1',    '4th': 'semi2',
    'top_scorer': 'top_scorer',
  }

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 1) return
    const key  = row.getCell(1).value?.toString().trim() ?? ''
    const valA = row.getCell(7).value  // gols A / Sim-Não / time bônus
    const valB = row.getCell(8).value  // gols B
    const valI = row.getCell(9).value  // nome do time para grp_3rd
    if (!key || key === 'Chave') return

    if (!key.includes(':')) {
      // Jogos: UUID direto ou id-N → resolve pelo número do jogo
      let matchId = key
      const m = key.match(/^id-(\d+)$/)
      if (m) {
        const uuid = matchNumToId.get(parseInt(m[1]))
        if (!uuid) return
        matchId = uuid
      }
      const h = parseNum(valA); const a = parseNum(valB)
      if (h !== null && a !== null) matches[matchId] = { score_home: h, score_away: a }
    } else if (key.startsWith('grp_3rd:')) {
      // terceiros: col7="Sim" indica que esse 3º avança; col9 = time
      const g       = key.slice(8)
      const advances = parseStr(valA) // "Sim" ou null/"Não"
      const team    = parseStr(valI)
      if (advances === 'Sim' && team) thirds[g] = team
    } else if (key.startsWith('bonus:')) {
      const field = key.slice(6)
      const val   = parseStr(valA)
      const db    = bonusKeyMap[field]
      if (db && val) trn[db] = val
    }
    // gemini não tem grp_bet:X — sem palpite de 1º/2º por grupo
  })

  return buildPalpites(matches, groupBets, thirds, trn)
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function parseExcelFile(filePath: string, matchNumToId: Map<number, string>): Promise<Palpites> {
  const wb = await loadWorkbook(filePath)

  // Encontra a aba: "Palpites" (formato A) ou qualquer aba começando com "Palpites" (formato B)
  const ws = wb.getWorksheet('Palpites')
            ?? wb.worksheets.find(w => !w.name.startsWith('_') && w.name.toLowerCase().startsWith('palpites'))

  if (!ws) throw new Error('Planilha "Palpites" não encontrada')

  const isFormatB = ws.name !== 'Palpites'
  return isFormatB ? parseFormatB(ws, matchNumToId) : parseFormatA(ws)
}

// ── Handler HTTP ──────────────────────────────────────────────────────────────

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })

  const admin = createAuthAdminClient()

  // Mapeia número do jogo → UUID (necessário para ids do tipo "id-N" do gemini)
  const { data: matchesData } = await supabase.from('matches').select('id, match_number')
  const matchNumToId = new Map<number, string>(
    (matchesData ?? []).map(m => [m.match_number as number, m.id as string]),
  )

  const results = []

  for (const model of MODEL_FILES) {
    const filePath = path.join(process.cwd(), 'palpites-IA', model.file)

    if (!fs.existsSync(filePath)) {
      results.push({ model: model.model_name, status: 'arquivo_nao_encontrado' })
      continue
    }

    try {
      const palpites = await parseExcelFile(filePath, matchNumToId)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('ai_models_performance').upsert({
        model_name:    model.model_name,
        model_version: model.model_version,
        sort_order:    model.sort_order,
        palpites,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'model_name' })

      results.push({
        model:   model.model_name,
        status:  'ok',
        matches: Object.keys(palpites.matches).length,
        groups:  Object.keys(palpites.group_bets).length,
        thirds:  Object.keys(palpites.third_place_bets).length,
        hasTrn:  !!palpites.tournament_bet,
      })
    } catch (err) {
      results.push({ model: model.model_name, status: 'erro', error: String(err) })
    }
  }

  return NextResponse.json({ ok: true, results })
}
