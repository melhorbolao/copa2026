'use client'

import { useState, useEffect, useMemo, useTransition, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MatchScoreRow } from './MatchScoreRow'
import { OfficialGroupCard } from './OfficialGroupCard'
import { OfficialBracketView } from './OfficialBracketView'
import { ThirdsTable } from '@/app/tabela/ThirdsTable'
import { saveOfficialTopScorer } from './actions'
import { isDeadlinePassed } from '@/utils/date'
import {
  calcGroupStandings,
  rankThirds,
  resolveThirdSlots,
  buildR32Teams,
} from '@/lib/bracket/engine'
import type { MatchSlim, BetSlim } from '@/lib/bracket/engine'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface MatchFull {
  id: string
  match_number: number
  phase: string
  group_name: string | null
  round: number | null
  team_home: string
  team_away: string
  flag_home: string
  flag_away: string
  match_datetime: string
  city: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
  is_brazil: boolean
  betting_deadline: string
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialMatches: any[]
  isAdmin: boolean
  initialOfficialTopScorer: string | null
  standardizedNames: string[]
  r1Deadline: string
}

// ── Constantes ────────────────────────────────────────────────────────────────

const GROUP_ORDER   = ['A','B','C','D','E','F','G','H','I','J','K','L']
const KNOCKOUT_PHASES = new Set(['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final'])

const STAGE_OPTIONS = [
  { value: '',      label: 'Fase de Grupos' },
  { value: 'r32',   label: '16avos' },
  { value: 'r16',   label: 'Oitavas' },
  { value: 'qf',    label: 'Quartas' },
  { value: 'sf',    label: 'Semis' },
  { value: 'final', label: 'Final' },
] as const

const STAGE_TO_PHASES: Record<string, string[]> = {
  r32:   ['round_of_32'],
  r16:   ['round_of_16'],
  qf:    ['quarterfinal'],
  sf:    ['semifinal'],
  final: ['third_place', 'final'],
}

// ── Janela de edição ──────────────────────────────────────────────────────────

const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

function computeCanEdit(match: MatchFull, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const now   = Date.now()
  const start = new Date(match.match_datetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ACopaClient({ initialMatches, isAdmin, initialOfficialTopScorer, standardizedNames, r1Deadline }: Props) {
  const [matches, setMatches]          = useState<MatchFull[]>(initialMatches as MatchFull[])
  const [groupFilter, setGroup]        = useState('')
  const [stageFilter, setStage]        = useState('')
  const [now, setNow]                  = useState(Date.now())

  // Artilheiros oficiais — armazenados como JSON array no banco
  const parseNames = (raw: string | null): string[] => {
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return raw ? [raw] : [] }
  }
  const [officialScorers, setScorers]  = useState<string[]>(() => parseNames(initialOfficialTopScorer))
  const [tsPending, startTsTransition] = useTransition()
  const [tsError, setTsError]          = useState('')
  const tsSavedRef                     = useRef(initialOfficialTopScorer ?? '')
  const tsTimer                        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Atualiza relógio a cada 30s para recalcular canEdit sem reload
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Supabase realtime — escuta alterações na tabela matches
  useEffect(() => {
    const supabase = createClient()
    const channel  = supabase
      .channel('acopa_matches_rt')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          setMatches(prev =>
            prev.map(m => m.id === payload.new.id ? { ...m, ...(payload.new as Partial<MatchFull>) } : m)
          )
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // ── Jogos filtrados ────────────────────────────────────────────────────────

  const isGroupStage = stageFilter === ''

  const filteredMatches = useMemo(() => {
    if (isGroupStage) {
      return matches.filter(m =>
        m.phase === 'group' && (groupFilter === '' || m.group_name === groupFilter)
      )
    }
    const phases = STAGE_TO_PHASES[stageFilter] ?? []
    return matches.filter(m => phases.includes(m.phase))
  }, [matches, isGroupStage, groupFilter, stageFilter])

  // ── Classificações calculadas a partir dos placares oficiais ──────────────

  const groupMatches = useMemo(
    () => matches.filter(m => m.phase === 'group'),
    [matches],
  )

  // Uma única passagem sobre groupMatches computa slimMatches, officialBetMap,
  // completeGroups e allGroupsComplete em vez de 5 useMemo separados.
  const { slimMatches, officialBetMap, completeGroups, allGroupsComplete } = useMemo(() => {
    const slim: MatchSlim[]           = []
    const betMap = new Map<string, BetSlim>()
    const byGroup = new Map<string, { total: number; scored: number }>()

    for (const m of groupMatches) {
      slim.push({
        id: m.id, group_name: m.group_name, phase: m.phase,
        team_home: m.team_home, team_away: m.team_away,
        flag_home: m.flag_home, flag_away: m.flag_away,
      })
      if (m.score_home !== null && m.score_away !== null) {
        betMap.set(m.id, { match_id: m.id, score_home: m.score_home, score_away: m.score_away })
      }
      if (m.group_name) {
        const e = byGroup.get(m.group_name) ?? { total: 0, scored: 0 }
        e.total++
        if (m.score_home !== null && m.score_away !== null) e.scored++
        byGroup.set(m.group_name, e)
      }
    }

    const complete = new Set<string>()
    for (const [g, { total, scored }] of byGroup) {
      if (total > 0 && scored === total) complete.add(g)
    }

    return {
      slimMatches:      slim,
      officialBetMap:   betMap,
      completeGroups:   complete,
      allGroupsComplete: byGroup.size > 0 && complete.size === byGroup.size,
    }
  }, [groupMatches])

  const hasAnyScore = officialBetMap.size > 0

  const standings = useMemo(
    () => calcGroupStandings(slimMatches, officialBetMap),
    [slimMatches, officialBetMap],
  )

  const thirds     = useMemo(() => rankThirds(standings), [standings])
  const thirdSlots = useMemo(() => resolveThirdSlots(thirds), [thirds])
  const r32Slots   = useMemo(
    () => buildR32Teams(standings, thirds, thirdSlots, undefined, completeGroups, allGroupsComplete),
    [standings, thirds, thirdSlots, completeGroups, allGroupsComplete],
  )

  const sortedStandings = useMemo(
    () => GROUP_ORDER.map(g => standings.find(s => s.group === g)).filter(Boolean) as typeof standings,
    [standings],
  )

  const advancingGroups = useMemo(
    () => new Set(thirds.filter(t => t.advances).map(t => t.group)),
    [thirds],
  )

  const knockoutMatches = useMemo(
    () => matches.filter(m => KNOCKOUT_PHASES.has(m.phase)),
    [matches],
  )

  // ── Grupos disponíveis para filtro (apenas os que têm jogos no estágio atual) ──

  const availableGroups = useMemo(() => {
    const gs = new Set<string>()
    for (const m of matches) {
      if (m.phase === 'group' && m.group_name) gs.add(m.group_name)
    }
    return GROUP_ORDER.filter(g => gs.has(g))
  }, [matches])

  // ── Render ─────────────────────────────────────────────────────────────────
  void now  // usado indiretamente via computeCanEdit — força re-render ao mudar

  return (
    <div>
      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap gap-2">
        {/* Fases */}
        <div className="flex flex-wrap gap-1">
          {STAGE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setStage(value); setGroup('') }}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                stageFilter === value
                  ? 'bg-verde-600 text-white shadow-sm'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sub-filtro de grupo (apenas na fase de grupos) */}
        {isGroupStage && availableGroups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setGroup('')}
              className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                groupFilter === ''
                  ? 'bg-azul-escuro text-white shadow-sm'
                  : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              Todos
            </button>
            {availableGroups.map(g => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  groupFilter === g
                    ? 'bg-azul-escuro text-white shadow-sm'
                    : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                Gr. {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabela de Jogos ──────────────────────────────────────────────────── */}
      <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
          <span className="text-sm font-black uppercase tracking-widest text-white">
            ⚽ Jogos
          </span>
          <span className="ml-auto text-[11px] font-medium text-white/60">
            {filteredMatches.filter(m => m.score_home !== null).length}/{filteredMatches.length} placar{filteredMatches.length !== 1 ? 'es' : ''} registrado{filteredMatches.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="py-2 pl-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:pl-3">#</th>
                <th className="px-1.5 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:px-3">Casa</th>
                <th className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:px-3">Placar</th>
                <th className="px-1.5 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:px-3">Visitante</th>
                <th className="hidden px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400 sm:table-cell">Data · Cidade</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatches.map(match => (
                <MatchScoreRow
                  key={match.id}
                  match={match}
                  canEdit={computeCanEdit(match, isAdmin)}
                  onPenaltyUpdate={(matchId, winner) =>
                    setMatches(prev =>
                      prev.map(m => m.id === matchId ? { ...m, penalty_winner: winner } : m)
                    )
                  }
                />
              ))}
              {filteredMatches.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-gray-400">
                    Nenhum jogo nessa fase ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Classificação dos Grupos — só na fase de grupos ─────────────────── */}
      {hasAnyScore && isGroupStage && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-black text-gray-900">Classificação dos Grupos</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {sortedStandings.map(standing => (
              <OfficialGroupCard
                key={standing.group}
                standing={standing}
                advancingGroups={advancingGroups}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Melhores Terceiros — só na fase de grupos ────────────────────────── */}
      {hasAnyScore && isGroupStage && thirds.length > 0 && (
        <div className="mb-8">
          <ThirdsTable thirds={thirds} />
        </div>
      )}

      {/* ── Artilheiro Oficial — só no filtro "Final" ───────────────────────── */}
      {stageFilter === 'final' && <div className="mb-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
          <span className="text-sm font-black uppercase tracking-widest text-white">
            ⚽ Artilheiro Oficial
          </span>
          {tsPending && <span className="ml-auto text-[11px] text-white/60 animate-pulse">Salvando…</span>}
        </div>
        <div className="px-4 py-4">
          <OfficialTopScorerCard
            isAdmin={isAdmin}
            r1Deadline={r1Deadline}
            standardizedNames={standardizedNames}
            names={officialScorers}
            pending={tsPending}
            error={tsError}
            onSave={(names) => {
              setScorers(names)
              setTsError('')
              clearTimeout(tsTimer.current)
              const json = JSON.stringify(names)
              if (json === tsSavedRef.current) return
              tsTimer.current = setTimeout(() => {
                startTsTransition(async () => {
                  const r = await saveOfficialTopScorer(json)
                  if (r.error) setTsError(r.error)
                  else tsSavedRef.current = json
                })
              }, 300)
            }}
          />
        </div>
      </div>}

      {/* ── Chaveamento Oficial ───────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
          <span className="text-sm font-black uppercase tracking-widest text-white">
            🏆 Chaveamento Oficial
          </span>
          <span className="ml-auto text-[11px] font-medium text-white/60">
            baseado nos resultados oficiais
          </span>
        </div>
        <div className="p-4">
          {hasAnyScore ? (
            <OfficialBracketView r32Slots={r32Slots} knockoutMatches={knockoutMatches} />
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">
              O chaveamento será exibido assim que os primeiros resultados forem registrados.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Campo de artilheiro oficial (múltiplos, para empates) ────────────────────

function OfficialTopScorerCard({
  isAdmin, r1Deadline, standardizedNames, names, pending, error, onSave,
}: {
  isAdmin: boolean
  r1Deadline: string
  standardizedNames: string[]
  names: string[]
  pending: boolean
  error: string
  onSave: (names: string[]) => void
}) {
  const [inputVal, setInputVal] = useState('')
  const r1Passed    = isDeadlinePassed(r1Deadline)
  const useDropdown = r1Passed && standardizedNames.length > 0
  const available   = standardizedNames.filter(n => !names.includes(n))

  const add = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || names.includes(trimmed)) return
    onSave([...names, trimmed])
    setInputVal('')
  }

  const remove = (name: string) => onSave(names.filter(n => n !== name))

  return (
    <div>

      {/* Lista dos artilheiros registrados */}
      {names.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {names.map(n => (
            <span key={n} className="inline-flex items-center gap-1.5 rounded-full bg-amarelo-100 px-3 py-1 text-sm font-bold text-amarelo-800">
              {n}
              {isAdmin && (
                <button
                  onClick={() => remove(n)}
                  className="text-amarelo-500 hover:text-red-500 transition leading-none"
                  title="Remover"
                >×</button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-sm text-gray-400 italic">
          {isAdmin || r1Passed ? 'Nenhum registrado ainda.' : 'Será divulgado após o prazo da Rodada 1.'}
        </p>
      )}

      {/* Controles de adição — somente admin */}
      {isAdmin && (
        <div className="flex items-center gap-2">
          {useDropdown ? (
            <select
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              className="rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-verde-400 focus:outline-none"
            >
              <option value="">+ adicionar artilheiro…</option>
              {available.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add(inputVal)}
              placeholder="Nome do artilheiro…"
              className="rounded border border-gray-200 px-2 py-1.5 text-sm focus:border-verde-400 focus:outline-none w-56"
            />
          )}
          <button
            onClick={() => add(inputVal)}
            disabled={!inputVal}
            className="rounded bg-verde-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-verde-700 disabled:opacity-40 transition"
          >
            Adicionar
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
