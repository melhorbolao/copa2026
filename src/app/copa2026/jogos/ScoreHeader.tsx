'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useTransition } from 'react'
import { Flag } from '@/components/ui/Flag'
import { saveOfficialScore } from '@/app/copa2026/acopa/actions'
import type { MatchFull } from './JogosDashboard'

const CYAN = '#04EFD0'
const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

function canEditScore(match: MatchFull, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const now   = Date.now()
  const start = new Date(match.match_datetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

interface Props {
  match: MatchFull
  matches: MatchFull[]
  matchIdx: number
  abbr: (team: string) => string
  isAdmin: boolean
  userId: string
  goalAnim: { home: boolean; away: boolean }
  isZebra: boolean
  onNavigate: (dir: -1 | 1) => void
  onScoreSaved: (sh: number | null, sa: number | null) => void
}

export function ScoreHeader({
  match, matches, matchIdx, abbr, isAdmin, userId, goalAnim, isZebra,
  onNavigate, onScoreSaved,
}: Props) {
  const [editing, setEditing]   = useState(false)
  const [ih, setIh]             = useState('')
  const [ia, setIa]             = useState('')
  const [saveErr, setSaveErr]   = useState('')
  const [saving, startSave]     = useTransition()

  const canEdit = canEditScore(match, isAdmin)

  const startEdit = () => {
    setIh(match.score_home !== null ? String(match.score_home) : '')
    setIa(match.score_away !== null ? String(match.score_away) : '')
    setSaveErr('')
    setEditing(true)
  }

  const handleSave = () => {
    const sh = ih === '' ? null : parseInt(ih, 10)
    const sa = ia === '' ? null : parseInt(ia, 10)
    if (ih !== '' && (isNaN(sh!) || sh! < 0)) { setSaveErr('Placar inválido'); return }
    if (ia !== '' && (isNaN(sa!) || sa! < 0)) { setSaveErr('Placar inválido'); return }
    startSave(async () => {
      const res = await saveOfficialScore(match.id, sh, sa)
      if (res.error) { setSaveErr(res.error); return }
      onScoreSaved(sh, sa)
      setEditing(false)
    })
  }

  const phaseLabel = { round_of_32: '16 Avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas', semifinal: 'Semifinal', third_place: '3º Lugar', final: 'Final' }[match.phase] ?? match.phase

  return (
    <>
      {/* Score pill header */}
      <div className="pt-2 pb-1">
        <div className="max-w-3xl mx-auto px-3 sm:px-4">
        <div
          className="w-full rounded-2xl shadow-2xl"
          style={{ background: '#2a2a2a', border: '1px solid #3a3a3a' }}
        >
          {/* Top row: nav+phase | scoreboard | date */}
          <div className="flex items-center gap-1 px-3 pt-3 pb-1">

            {/* Left: stacked nav arrows + phase label */}
            <div className="flex items-center gap-0.5 flex-1 min-w-0">
              <div className="flex flex-col items-center shrink-0">
                <NavArrow dir="right" disabled={matchIdx === matches.length - 1} onClick={() => onNavigate(1)} />
                <NavArrow dir="left" disabled={matchIdx === 0} onClick={() => onNavigate(-1)} />
              </div>
              <div className="min-w-0 hidden sm:block">
                {match.phase === 'group' ? (
                  <>
                    <div className="text-xs text-gray-400 leading-tight">Rodada {match.round}</div>
                    <div className="text-xs text-gray-400 leading-tight">Grupo {match.group_name}</div>
                  </>
                ) : (
                  <div className="text-xs text-gray-400 leading-tight truncate">{phaseLabel}</div>
                )}
              </div>
            </div>

            {/* Center: [team-col][score strip + edit link][team-col] */}
            <div className="flex items-start gap-0 shrink-0">

              {/* Home column: black bar + goal ball below abbreviation */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1 px-1.5 h-8 bg-black">
                  <Flag code={match.flag_home} size="sm" className="w-8 h-[26px] rounded-[2px] object-cover" />
                  <span className="text-[13px] font-black text-white tracking-wide">{abbr(match.team_home)}</span>
                </div>
                {/* pl-[42px] = pl-1.5(6) + w-8(32) + gap-1(4) — centers ball under abbreviation */}
                <div className="h-5 flex items-center justify-center pl-[42px] pr-1.5">
                  {goalAnim.home && <span className="text-base leading-none select-none">⚽</span>}
                </div>
              </div>

              {/* Score strip + edit link stacked */}
              <div className="flex flex-col items-center">
                <div className="flex items-stretch gap-0">
                  <ScoreBox score={match.score_home} editing={editing} inputVal={ih} onInput={setIh} />
                  <div className="relative flex items-center justify-center w-9" style={{ background: '#FD1111' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logoCopa.png" alt="" className="absolute z-10" style={{ height: '38px', width: 'auto' }} />
                  </div>
                  <ScoreBox score={match.score_away} editing={editing} inputVal={ia} onInput={setIa} />
                </div>
                {/* Edit controls directly below score */}
                <div className="flex items-center justify-center gap-2 h-5">
                  {editing ? (
                    <>
                      <button onClick={handleSave} disabled={saving}
                        className="text-[10px] font-bold px-3 py-0.5 rounded-full"
                        style={{ background: CYAN, color: '#000' }}>
                        {saving ? '…' : 'Salvar'}
                      </button>
                      <button onClick={() => setEditing(false)}
                        className="text-[10px] text-gray-500 hover:text-gray-300">Cancelar</button>
                      {saveErr && <span className="text-[10px] text-red-400">{saveErr}</span>}
                    </>
                  ) : canEdit ? (
                    <button onClick={startEdit}
                      className="text-[10px] text-gray-500 hover:text-gray-300 underline underline-offset-2 leading-none">
                      {match.score_home !== null ? 'Editar placar' : 'Registrar placar'}
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-700 leading-none">J{match.match_number}</span>
                  )}
                </div>
              </div>

              {/* Away column: black bar + goal ball below abbreviation */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1 px-1.5 h-8 bg-black flex-row-reverse">
                  <Flag code={match.flag_away} size="sm" className="w-8 h-[26px] rounded-[2px] object-cover" />
                  <span className="text-[13px] font-black text-white tracking-wide">{abbr(match.team_away)}</span>
                </div>
                {/* pr-[42px] = pr-1.5(6) + w-8(32) + gap-1(4) — centers ball under abbreviation (flag is on right) */}
                <div className="h-5 flex items-center justify-center pr-[42px] pl-1.5">
                  {goalAnim.away && <span className="text-base leading-none select-none">⚽</span>}
                </div>
              </div>

            </div>

            {/* Right: date/city */}
            <div className="flex flex-col flex-1 items-end min-w-0">
              <div className="flex items-center gap-1.5 justify-end w-full">
                <div className="min-w-0 text-right">
                  <div className="text-[11px] text-gray-300 leading-tight truncate font-medium">
                    {fmtDay(match.match_datetime)}
                  </div>
                  <div className="text-[11px] text-gray-400 leading-tight truncate">
                    {fmtTime(match.match_datetime)}
                  </div>
                  <div className="text-[10px] text-gray-500 leading-tight mt-0.5 truncate hidden sm:block">{match.city}</div>
                </div>
              </div>
              {/* spacer mirrors the h-5 edit-link row so this column = 52px = same as center */}
              <div className="h-5" />
            </div>
          </div>

        </div>
        </div>
      </div>
    </>
  )
}

function NavArrow({ dir, disabled, onClick }: { dir: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center w-6 h-6 sm:w-8 sm:h-8 transition ${disabled ? 'opacity-20 cursor-not-allowed' : 'active:scale-95'}`}
    >
      <svg width="20" height="14" className="sm:hidden" viewBox="0 0 28 20" fill="none">
        {dir === 'left'
          ? <path d="M17 2L5 10L17 18" stroke={disabled ? '#555' : '#ccc'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
          : <path d="M11 2L23 10L11 18" stroke={disabled ? '#555' : '#ccc'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        }
      </svg>
      <svg width="28" height="20" className="hidden sm:block" viewBox="0 0 28 20" fill="none">
        {dir === 'left'
          ? <path d="M17 2L5 10L17 18" stroke={disabled ? '#555' : '#ccc'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
          : <path d="M11 2L23 10L11 18" stroke={disabled ? '#555' : '#ccc'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
        }
      </svg>
    </button>
  )
}


/** Retângulo ciano preenchido com o dígito do placar */
function ScoreBox({ score, editing, inputVal, onInput }: {
  score: number | null; editing: boolean; inputVal: string; onInput: (v: string) => void
}) {
  return (
    <div
      className="flex items-center justify-center font-black text-base px-2 py-0.5 min-w-[2rem]"
      style={{ background: editing ? '#333' : CYAN, border: editing ? `2px solid ${CYAN}` : '2px solid transparent', color: editing ? CYAN : '#000' }}
    >
      {editing
        ? <input
            value={inputVal}
            onChange={e => onInput(e.target.value)}
            className="w-7 bg-transparent text-center outline-none font-black"
            style={{ color: CYAN }}
            inputMode="numeric"
          />
        : score !== null
          ? <span className="tabular-nums">{score}</span>
          : <span className="font-bold text-black/40">–</span>
      }
    </div>
  )
}
