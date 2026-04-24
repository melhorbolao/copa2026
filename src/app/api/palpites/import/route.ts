import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'

export async function POST(req: NextRequest) {
  const supabase      = await createClient()
  const adminSupabase = createAuthAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const participantId = await getActiveParticipantId(supabase, user.id)

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 })

  // Limite de tamanho: 5 MB
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Arquivo muito grande. Máximo 5 MB.' }, { status: 400 })
  }

  const arrayBuf = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (wb.xlsx.load as (b: unknown) => Promise<unknown>)(arrayBuf)
  } catch {
    return NextResponse.json({ error: 'Arquivo inválido. Envie um .xlsx exportado pelo sistema.' }, { status: 400 })
  }

  const ws = wb.getWorksheet('Palpites')
  if (!ws) return NextResponse.json({ error: 'Planilha "Palpites" não encontrada.' }, { status: 400 })

  const now = new Date()

  // Busca times válidos (para validação) + prazos das partidas
  const { data: allMatches } = await supabase
    .from('matches')
    .select('id, team_home, team_away, betting_deadline, round, phase, score_home, score_away')

  const validTeams = new Set<string>(
    (allMatches ?? []).flatMap(m => [m.team_home, m.team_away]).filter(t => t && t !== 'TBD')
  )

  const matches = (allMatches ?? []).filter(m => m.phase === 'group')

  const matchDeadlineMap = new Map((matches ?? []).map(m => [m.id as string, m.betting_deadline as string]))
  const bonusDeadlineStr = (matches ?? []).find(m => m.round === 1)?.betting_deadline ?? ''
  const bonusLocked      = bonusDeadlineStr ? now >= new Date(bonusDeadlineStr) : false

  // Acumuladores
  let updatedMatches = 0
  let updatedBonus   = 0
  let skipped        = 0

  const matchUpserts: { participant_id: string; match_id: string; score_home: number; score_away: number }[] = []
  const groupBetMap:  Record<string, { first_place?: string; second_place?: string }> = {}
  const thirdBetMap:  Record<string, string> = {}
  const trnFields:    Record<string, string> = {}

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 3) return

    const key    = row.getCell(1).value?.toString().trim() ?? ''
    const valA   = row.getCell(7).value
    const valB   = row.getCell(8).value

    if (!key || key === 'Chave') return

    // ── Jogo ──────────────────────────────────────────────────────
    if (!key.includes(':')) {
      const matchId  = key
      const deadline = matchDeadlineMap.get(matchId)
      if (!deadline) return
      if (now >= new Date(deadline)) { skipped++; return }

      const scoreHome = parseNum(valA)
      const scoreAway = parseNum(valB)
      if (scoreHome === null || scoreAway === null) return

      matchUpserts.push({ participant_id: participantId, match_id: matchId, score_home: scoreHome, score_away: scoreAway })
      updatedMatches++
      return
    }

    // ── Bônus — bloqueia todos se prazo vencido ───────────────────
    if (bonusLocked) { skipped++; return }

    // ── Classificados por grupo (1º e 2º) ─────────────────────────
    if (key.startsWith('grp_bet:')) {
      const g      = key.replace('grp_bet:', '')
      const first  = parseStr(valA)
      const second = parseStr(valB)
      if (!first && !second) return
      if (first  && !validTeams.has(first))  { skipped++; return }
      if (second && !validTeams.has(second)) { skipped++; return }
      if (!groupBetMap[g]) groupBetMap[g] = {}
      if (first)  groupBetMap[g].first_place  = first
      if (second) groupBetMap[g].second_place = second
      updatedBonus++
      return
    }

    // ── Terceiros classificados ───────────────────────────────────
    if (key.startsWith('grp_3rd:')) {
      const g    = key.replace('grp_3rd:', '')
      const team = parseStr(valA)
      if (!team) return
      if (!validTeams.has(team)) { skipped++; return }
      thirdBetMap[g] = team
      updatedBonus++
      return
    }

    // ── G4 e artilheiro ───────────────────────────────────────────
    if (key.startsWith('trn:')) {
      const field = key.replace('trn:', '')
      const val   = parseStr(valA)
      if (!val) return
      const isTeamField = ['champion', 'runner_up', 'semi1', 'semi2'].includes(field)
      if (isTeamField && !validTeams.has(val)) { skipped++; return }
      trnFields[field] = val
      updatedBonus++
      return
    }
  })

  // Persiste jogos
  if (matchUpserts.length > 0) {
    const { error } = await adminSupabase.from('bets').upsert(matchUpserts, { onConflict: 'participant_id,match_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Persiste group_bets
  if (Object.keys(groupBetMap).length > 0) {
    const rows = Object.entries(groupBetMap)
      .filter(([, v]) => v.first_place && v.second_place)
      .map(([g, v]) => ({
        participant_id: participantId, group_name: g,
        first_place:  v.first_place  as string,
        second_place: v.second_place as string,
      }))
    const { error } = await adminSupabase.from('group_bets').upsert(rows, { onConflict: 'participant_id,group_name' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Persiste third_place_bets
  if (Object.keys(thirdBetMap).length > 0) {
    const rows = Object.entries(thirdBetMap).map(([g, team]) => ({
      participant_id: participantId, group_name: g, team,
    }))
    const { error } = await adminSupabase.from('third_place_bets').upsert(rows, { onConflict: 'participant_id,group_name' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Persiste tournament_bets
  const trnMap: Record<string, string> = { semi1: 'semi1', semi2: 'semi2', champion: 'champion', runner_up: 'runner_up', scorer: 'top_scorer' }
  const trnUpdate: Record<string, string> = {}
  for (const [k, dbField] of Object.entries(trnMap)) {
    if (trnFields[k]) trnUpdate[dbField] = trnFields[k]
  }

  const warnings: string[] = []

  // Valida limite de 8 terceiros classificados
  const thirdEntries = Object.entries(thirdBetMap)
  if (thirdEntries.length > 8) {
    const excess = thirdEntries.length - 8
    warnings.push(`${excess} terceiro(s) classificado(s) excedente(s) ignorado(s) (máximo 8)`)
    for (const [g] of thirdEntries.slice(8)) delete thirdBetMap[g]
  }

  // Valida e remove duplicidades no G4
  const g4Labels: Record<string, string> = { champion: 'Campeão', runner_up: 'Vice', semi1: '3º Semi', semi2: '4º Semi' }
  const g4ValueToFields = new Map<string, string[]>()
  for (const field of Object.keys(g4Labels)) {
    const v = trnUpdate[field]
    if (!v) continue
    if (!g4ValueToFields.has(v)) g4ValueToFields.set(v, [])
    g4ValueToFields.get(v)!.push(field)
  }
  for (const [team, fields] of g4ValueToFields) {
    if (fields.length > 1) {
      const labelList = fields.map(f => g4Labels[f]).join(' e ')
      warnings.push(`${team} repetido em ${labelList} — campos apagados, corrija manualmente na tela`)
      for (const f of fields) delete trnUpdate[f]
    }
  }

  if (Object.keys(trnUpdate).length > 0) {
    const { data: existing } = await supabase.from('tournament_bets').select('id').eq('participant_id', participantId).maybeSingle()
    if (existing) {
      await adminSupabase.from('tournament_bets').update(trnUpdate).eq('participant_id', participantId)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await adminSupabase.from('tournament_bets').insert({ participant_id: participantId, ...trnUpdate } as any)
    }
  }

  return NextResponse.json({ updated: updatedMatches, bonus: updatedBonus, skipped, warnings })
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 30) return null
  return n
}

// Valores que representam "vazio" nas células do Excel
const EMPTY_PLACEHOLDERS = new Set(['', '— time —', '-- time --', '-', '—', '– time –'])

function parseStr(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (EMPTY_PLACEHOLDERS.has(s)) return null
  return s.length > 0 ? s : null
}
