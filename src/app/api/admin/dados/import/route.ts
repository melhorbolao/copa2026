/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: adminProfile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!adminProfile?.is_admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  // ── Params ────────────────────────────────────────────────────
  const form       = await req.formData()
  const file       = form.get('file') as File | null
  const mode       = (form.get('mode') as string | null) ?? 'check'        // 'check' | 'execute'
  const resolution = (form.get('resolution') as string | null) ?? 'overwrite' // 'overwrite' | 'skip'

  if (!file)
    return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
  if (file.size > 20 * 1024 * 1024)
    return NextResponse.json({ error: 'Arquivo muito grande. Máximo 20 MB.' }, { status: 400 })

  // ── Parse Excel ───────────────────────────────────────────────
  const arrayBuf = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  try {
    await (wb.xlsx.load as (b: unknown) => Promise<unknown>)(arrayBuf)
  } catch {
    return NextResponse.json({ error: 'Arquivo inválido. Envie um .xlsx exportado pelo sistema.' }, { status: 400 })
  }

  const ws = wb.getWorksheet('Palpites')
  if (!ws) return NextResponse.json({ error: 'Planilha "Palpites" não encontrada.' }, { status: 400 })

  // ── Load reference data ───────────────────────────────────────
  const admin = createAuthAdminClient() as any

  const [{ data: allParticipants }, { data: allMatches }] = await Promise.all([
    admin.from('participants').select('id, apelido'),
    admin.from('matches').select('id, team_home, team_away'),
  ])

  const matchIdSet = new Set((allMatches ?? []).map((m: any) => m.id as string))
  const validTeams = new Set<string>(
    (allMatches ?? []).flatMap((m: any) => [m.team_home, m.team_away]).filter((t: any) => t && t !== 'TBD')
  )

  // Build apelido → participant_id map (case-insensitive)
  const apelidoMap = new Map<string, string>()
  for (const p of (allParticipants ?? []) as any[])
    apelidoMap.set((p.apelido as string).toLowerCase().trim(), p.id as string)

  // ── Detect participant columns from header row (row 2) ────────
  // Col 1 = Chave, Col 2 = Descrição, Col 3+ = participant apelidos
  const headerRow = ws.getRow(2)
  const colToParticipant = new Map<number, { apelido: string; id: string }>()

  headerRow.eachCell((cell, col) => {
    if (col <= 2) return
    const label = cell.value?.toString().trim() ?? ''
    if (!label) return
    const pid = apelidoMap.get(label.toLowerCase())
    if (pid) colToParticipant.set(col, { apelido: label, id: pid })
  })

  if (colToParticipant.size === 0)
    return NextResponse.json({ error: 'Nenhum participante reconhecido nos cabeçalhos da planilha.' }, { status: 400 })

  const participantCols = [...colToParticipant.entries()] // [col, { apelido, id }]

  // ── Collect bets per participant ──────────────────────────────
  type MatchUpsert  = { match_id: string; score_home: number; score_away: number }
  type GroupBetData = { first_place?: string; second_place?: string }

  const perParticipant = new Map<string, {
    apelido:    string
    matches:    Map<string, MatchUpsert>
    grpBet1:    Map<string, string>    // group → 1st
    grpBet2:    Map<string, string>    // group → 2nd
    thirdBets:  Map<string, string>    // group → team
    trn:        Record<string, string> // champion|runner_up|semi1|semi2|scorer
  }>()

  for (const [, { apelido, id }] of participantCols) {
    perParticipant.set(id, {
      apelido,
      matches:   new Map(),
      grpBet1:   new Map(),
      grpBet2:   new Map(),
      thirdBets: new Map(),
      trn:       {},
    })
  }

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 2) return

    const key = row.getCell(1).value?.toString().trim() ?? ''
    if (!key || key === 'Chave') return

    for (const [col, { id: pid }] of participantCols) {
      const raw = row.getCell(col).value
      const pd  = perParticipant.get(pid)!

      if (!key.includes(':')) {
        // Match bet: value = "X-Y"
        if (!matchIdSet.has(key)) continue
        const str = raw?.toString().trim() ?? ''
        const m   = str.match(/^(\d+)-(\d+)$/)
        if (!m) continue
        const h = parseInt(m[1], 10)
        const a = parseInt(m[2], 10)
        if (h < 0 || h > 30 || a < 0 || a > 30) continue
        pd.matches.set(key, { match_id: key, score_home: h, score_away: a })
        continue
      }

      const str = raw?.toString().trim() ?? ''

      if (key.startsWith('grp_bet_1:')) {
        const g = key.slice('grp_bet_1:'.length)
        if (str && validTeams.has(str)) pd.grpBet1.set(g, str)
        continue
      }
      if (key.startsWith('grp_bet_2:')) {
        const g = key.slice('grp_bet_2:'.length)
        if (str && validTeams.has(str)) pd.grpBet2.set(g, str)
        continue
      }
      if (key.startsWith('grp_3rd:')) {
        const g = key.slice('grp_3rd:'.length)
        if (str && validTeams.has(str)) pd.thirdBets.set(g, str)
        continue
      }
      if (key.startsWith('trn:')) {
        const field = key.slice('trn:'.length)
        if (!str) continue
        const isTeam = ['champion', 'runner_up', 'semi1', 'semi2'].includes(field)
        if (isTeam && !validTeams.has(str)) continue
        pd.trn[field] = str
        continue
      }
    }
  })

  const participantIds = [...perParticipant.keys()]

  // ── Mode: check ───────────────────────────────────────────────
  if (mode === 'check') {
    const [bRes, gRes, tpRes, tbRes] = await Promise.all([
      admin.from('bets').select('participant_id', { count: 'exact', head: false }).in('participant_id', participantIds),
      admin.from('group_bets').select('participant_id', { count: 'exact', head: false }).in('participant_id', participantIds),
      admin.from('third_place_bets').select('participant_id', { count: 'exact', head: false }).in('participant_id', participantIds),
      admin.from('tournament_bets').select('participant_id').in('participant_id', participantIds),
    ])

    const hasExisting = new Set<string>()
    for (const b of (bRes.data ?? []) as any[])  hasExisting.add(b.participant_id)
    for (const b of (gRes.data ?? []) as any[])  hasExisting.add(b.participant_id)
    for (const b of (tpRes.data ?? []) as any[]) hasExisting.add(b.participant_id)
    for (const b of (tbRes.data ?? []) as any[]) hasExisting.add(b.participant_id)

    const conflicts = [...hasExisting]
      .map(pid => perParticipant.get(pid)?.apelido)
      .filter(Boolean) as string[]

    return NextResponse.json({
      participants: participantIds.length,
      conflicts,
    })
  }

  // ── Mode: execute ─────────────────────────────────────────────
  // Determine which participants to process
  let targets = participantIds

  if (resolution === 'skip') {
    const [bRes, gRes, tpRes, tbRes] = await Promise.all([
      admin.from('bets').select('participant_id').in('participant_id', participantIds),
      admin.from('group_bets').select('participant_id').in('participant_id', participantIds),
      admin.from('third_place_bets').select('participant_id').in('participant_id', participantIds),
      admin.from('tournament_bets').select('participant_id').in('participant_id', participantIds),
    ])
    const hasExisting = new Set<string>()
    for (const b of (bRes.data ?? []) as any[])  hasExisting.add(b.participant_id)
    for (const b of (gRes.data ?? []) as any[])  hasExisting.add(b.participant_id)
    for (const b of (tpRes.data ?? []) as any[]) hasExisting.add(b.participant_id)
    for (const b of (tbRes.data ?? []) as any[]) hasExisting.add(b.participant_id)
    targets = participantIds.filter(pid => !hasExisting.has(pid))
  } else {
    // overwrite: delete existing bets for all target participants
    await Promise.all([
      admin.from('bets').delete().in('participant_id', participantIds),
      admin.from('group_bets').delete().in('participant_id', participantIds),
      admin.from('third_place_bets').delete().in('participant_id', participantIds),
      admin.from('tournament_bets').delete().in('participant_id', participantIds),
    ])
  }

  let totalMatches = 0
  let totalBonus   = 0
  let totalSkipped = 0

  for (const pid of targets) {
    const pd = perParticipant.get(pid)!

    // Match bets
    const matchUpserts = [...pd.matches.values()].map(m => ({
      participant_id: pid, ...m,
    }))
    if (matchUpserts.length > 0) {
      const { error } = await admin.from('bets').upsert(matchUpserts, { onConflict: 'participant_id,match_id' })
      if (error) return NextResponse.json({ error: `Erro ao salvar jogos de ${pd.apelido}: ${error.message}` }, { status: 500 })
      totalMatches += matchUpserts.length
    }

    // Group bets (combine 1st + 2nd)
    const groupBets: { participant_id: string; group_name: string; first_place: string; second_place: string }[] = []
    const allGroups = new Set([...pd.grpBet1.keys(), ...pd.grpBet2.keys()])
    for (const g of allGroups) {
      const first  = pd.grpBet1.get(g)
      const second = pd.grpBet2.get(g)
      if (first && second && first !== second) {
        groupBets.push({ participant_id: pid, group_name: g, first_place: first, second_place: second })
      }
    }
    if (groupBets.length > 0) {
      const { error } = await admin.from('group_bets').upsert(groupBets, { onConflict: 'participant_id,group_name' })
      if (error) return NextResponse.json({ error: `Erro ao salvar bônus grupos de ${pd.apelido}: ${error.message}` }, { status: 500 })
      totalBonus += groupBets.length
    }

    // Third place bets (max 8)
    const thirdEntries = [...pd.thirdBets.entries()].slice(0, 8)
    if (thirdEntries.length > 0) {
      const rows = thirdEntries.map(([g, team]) => ({ participant_id: pid, group_name: g, team }))
      const { error } = await admin.from('third_place_bets').upsert(rows, { onConflict: 'participant_id,group_name' })
      if (error) return NextResponse.json({ error: `Erro ao salvar 3ºs de ${pd.apelido}: ${error.message}` }, { status: 500 })
      totalBonus += rows.length
    }

    // Tournament bets
    const trnFields: Record<string, string> = {}
    for (const [k, v] of Object.entries(pd.trn)) {
      const dbField = k === 'scorer' ? 'top_scorer' : k
      trnFields[dbField] = v
    }
    // Validate G4 has no duplicates
    const g4Fields = ['champion', 'runner_up', 'semi1', 'semi2']
    const g4Values = g4Fields.map(f => trnFields[f]).filter(Boolean)
    const hasDupes = g4Values.length !== new Set(g4Values).size
    if (hasDupes) {
      for (const f of g4Fields) delete trnFields[f]
      totalSkipped++
    }

    if (Object.keys(trnFields).length > 0) {
      const { data: existing } = await admin
        .from('tournament_bets').select('id').eq('participant_id', pid).maybeSingle()
      if (existing) {
        await admin.from('tournament_bets').update(trnFields).eq('participant_id', pid)
      } else {
        await admin.from('tournament_bets').insert({ participant_id: pid, ...trnFields })
      }
      totalBonus++
    }
  }

  const skipped = participantIds.length - targets.length

  return NextResponse.json({
    ok: true,
    participants: targets.length,
    matches: totalMatches,
    bonus: totalBonus,
    skipped,
    g4DuplicatesFixed: totalSkipped,
  })
}
