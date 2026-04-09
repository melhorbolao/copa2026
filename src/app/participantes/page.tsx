import { createClient } from '@/lib/supabase/server'
import { getDisplayName } from '@/utils/display'
import { Navbar } from '@/components/layout/Navbar'
import { formatBrasilia } from '@/utils/date'
import { Countdown } from '@/app/palpites/Countdown'

type MatchPhase = 'group' | 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'third_place' | 'final'
interface Match { id: string; phase: MatchPhase; round: number | null; betting_deadline: string }
interface Bet   { user_id: string; match_id: string; updated_at: string }

function getStageKey(m: Match): string | null {
  if (m.phase === 'group') return m.round === 1 ? 'r1' : m.round === 2 ? 'r2' : m.round === 3 ? 'r3' : null
  const map: Partial<Record<MatchPhase, string>> = {
    round_of_32: 'r32', round_of_16: 'r16',
    quarterfinal: 'qf', semifinal: 'sf',
    third_place: 'final', final: 'final',
  }
  return map[m.phase] ?? null
}

type StageKey = 'r1' | 'r2' | 'r3' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
const STAGE_KEYS: StageKey[] = ['r1','r2','r3','r32','r16','qf','sf','final']
const STAGE_LABELS: Record<StageKey, string> = {
  r1:'R1', r2:'R2', r3:'R3', r32:'16av', r16:'Oit', qf:'Qrt', sf:'Semi', final:'Final'
}

export default async function ControlePage() {
  const supabase = await createClient()

  const [
    { data: users },
    { data: matches },
    { data: allBets },
    { data: trnBets },
    { data: groupBets },
    { data: thirdBets },
  ] = await Promise.all([
    supabase.from('users')
      .select('id, name, apelido, paid')
      .eq('status', 'aprovado'),
    supabase.from('matches').select('id, phase, round, betting_deadline'),
    supabase.from('bets').select('user_id, match_id, updated_at'),
    supabase.from('tournament_bets').select('user_id, champion, runner_up, semi1, semi2, top_scorer'),
    supabase.from('group_bets').select('user_id, group_name'),
    supabase.from('third_place_bets').select('user_id, group_name'),
  ])

  // Valida duplicidade G4 por usuário
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
    if (errs.length > 0) g4ErrorMap.set(t.user_id, errs)
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
    // Guarda o prazo da etapa (todos os jogos da mesma etapa têm o mesmo prazo)
    if (!stageDeadlines[k]) stageDeadlines[k] = m.betting_deadline
  }
  // R1 inclui bônus pré-torneio: G4+artilheiro (5) + classificados por grupo (12) + terceiros (8)
  const R1_BONUS = 5 + 12 + 8   // 25 campos adicionais
  stageTotals['r1'] += R1_BONUS

  // Pré-processa bônus por usuário para R1
  // Conta campos preenchidos individualmente (champion, runner_up, semi1, semi2, top_scorer)
  const trnBetCount = new Map<string, number>()
  for (const t of (trnBets ?? [])) {
    const filled = [t.champion, t.runner_up, t.semi1, t.semi2, t.top_scorer].filter(Boolean).length
    trnBetCount.set(t.user_id, filled)
  }

  const groupBetCount = new Map<string, number>()
  for (const g of (groupBets ?? [])) {
    groupBetCount.set(g.user_id, (groupBetCount.get(g.user_id) ?? 0) + 1)
  }

  const thirdBetCount = new Map<string, number>()
  for (const t of (thirdBets ?? [])) {
    thirdBetCount.set(t.user_id, (thirdBetCount.get(t.user_id) ?? 0) + 1)
  }

  // Palpites e último salvamento por usuário por etapa
  const betCount   = new Map<string, Record<StageKey, number>>()
  const lastSavedMap = new Map<string, Record<StageKey, string>>()

  for (const b of (allBets ?? []) as Bet[]) {
    const k = matchStage.get(b.match_id)
    if (!k) continue

    if (!betCount.has(b.user_id))    betCount.set(b.user_id,    { r1:0,r2:0,r3:0,r32:0,r16:0,qf:0,sf:0,final:0 })
    if (!lastSavedMap.has(b.user_id)) lastSavedMap.set(b.user_id, { r1:'',r2:'',r3:'',r32:'',r16:'',qf:'',sf:'',final:'' })

    betCount.get(b.user_id)![k]++

    const prev = lastSavedMap.get(b.user_id)![k]
    if (!prev || b.updated_at > prev) lastSavedMap.get(b.user_id)![k] = b.updated_at
  }

  // Soma bônus de R1 por usuário
  for (const user of (users ?? [])) {
    const uid = user.id
    if (!betCount.has(uid)) betCount.set(uid, { r1:0,r2:0,r3:0,r32:0,r16:0,qf:0,sf:0,final:0 })
    const counts = betCount.get(uid)!
    counts.r1 += trnBetCount.get(uid) ?? 0                                                  // G4 + artilheiro (campo a campo)
    counts.r1 += Math.min(groupBetCount.get(uid) ?? 0, 12)                                 // classificados (0-12 grupos)
    counts.r1 += Math.min(thirdBetCount.get(uid) ?? 0, 8)                                  // terceiros (0-8 picks)
  }

  const calcPct = (userId: string, k: StageKey) => {
    const total = stageTotals[k]
    if (!total) return -1
    return Math.round((betCount.get(userId)?.[k] ?? 0) / total * 100)
  }

  const getLastSaved = (userId: string, k: StageKey): string | null => {
    const ts = lastSavedMap.get(userId)?.[k]
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

  // Ordena alfabeticamente pelo displayName
  const sorted = [...(users ?? [])].sort((a, b) =>
    getDisplayName(a).localeCompare(getDisplayName(b), 'pt-BR', { sensitivity: 'base' })
  )

  const pct    = (v: number) => v === -1 ? '—' : `${v}%`
  const pctCls = (v: number) =>
    v === -1  ? 'text-gray-300' :
    v === 100 ? 'text-verde-600 font-bold' :
    v > 0     ? 'text-amber-600' : 'text-red-400'

  return (
    <>
      <Navbar />

      {/* Banner de alerta global */}
      {hasAnyError && (
        <div className="sticky top-14 z-40 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 font-medium">
          ⚠️ Existem erros de lógica nos palpites de alguns participantes. Verifique a lista abaixo.
        </div>
      )}

    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-black text-gray-900">Participantes</h1>
        {nextDeadline && (
          <Countdown deadline={nextDeadline.iso} label={nextDeadline.label} />
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">Nome</th>
                <th className="px-3 py-3 text-center">Pagamento</th>
                <th className="px-2 py-3 text-center w-8" title="Erros de lógica">⚠️</th>
                {STAGE_KEYS.map(k => (
                  <th key={k} className="px-2 py-3 text-center">
                    <div>{STAGE_LABELS[k]}</div>
                    {stageDeadlines[k] && (
                      <div className="text-[10px] font-normal normal-case tracking-normal text-gray-400">
                        {formatBrasilia(stageDeadlines[k], 'dd/MM HH:mm')}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((user, i) => (
                <tr key={user.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-xs text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                    {getDisplayName(user)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {user.paid ? (
                      <span className="inline-block rounded-full bg-verde-100 px-2.5 py-0.5 text-xs font-semibold text-verde-700">✓ Pago</span>
                    ) : (
                      <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">✗ Pendente</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {g4ErrorMap.has(user.id) ? (
                      <span
                        title={g4ErrorMap.get(user.id)!.join('\n')}
                        className="cursor-help text-sm text-red-500"
                      >
                        ⚠️
                      </span>
                    ) : (
                      <span className="text-xs text-gray-200">✓</span>
                    )}
                  </td>
                  {STAGE_KEYS.map(k => {
                    const v    = calcPct(user.id, k)
                    const ts   = getLastSaved(user.id, k)
                    return (
                      <td key={k} className="px-2 py-2 text-center">
                        <div className={`text-xs tabular-nums ${pctCls(v)}`}>{pct(v)}</div>
                        {ts && <div className="text-[10px] text-gray-300 tabular-nums leading-tight">{ts}</div>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {sorted.length} participantes aprovados
      </p>
    </div>
    </>
  )
}
