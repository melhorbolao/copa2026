'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useTransition } from 'react'
import { Flag } from '@/components/ui/Flag'
import { saveOfficialScore } from '@/app/acopa/actions'
import type { MatchFull, AttendanceRow, Participant } from './JogosDashboard'
import { upsertAttendance } from './actions'

const CYAN = '#00F2FF'
const EDIT_WINDOW_MS = 4 * 60 * 60 * 1000

function canEditScore(match: MatchFull, isAdmin: boolean): boolean {
  if (isAdmin) return true
  const now   = Date.now()
  const start = new Date(match.match_datetime).getTime()
  return now >= start && now <= start + EDIT_WINDOW_MS
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).replace(',', ' •')
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
  presentCount: number
  attendance: AttendanceRow[]
  participants: Participant[]
  userToParticipants: Record<string, string[]>
  activeParticipantId: string | null
  onNavigate: (dir: -1 | 1) => void
  onScoreSaved: (sh: number | null, sa: number | null) => void
}

export function ScoreHeader({
  match, matches, matchIdx, abbr, isAdmin, userId, goalAnim, isZebra,
  presentCount, attendance, participants, userToParticipants, activeParticipantId,
  onNavigate, onScoreSaved,
}: Props) {
  const [editing, setEditing]   = useState(false)
  const [ih, setIh]             = useState('')
  const [ia, setIa]             = useState('')
  const [saveErr, setSaveErr]   = useState('')
  const [saving, startSave]     = useTransition()

  const [showPresence, setShowPresence] = useState(false)
  const [presenceSelecting, setPresenceSelecting] = useState(false)
  const [selectedPids, setSelectedPids] = useState<string[]>([])
  const [presencePending, startPresence] = useTransition()

  const canEdit = canEditScore(match, isAdmin)
  const myAttendance = attendance.find(a => a.user_id === userId)
  const amPresent = !!myAttendance

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

  const togglePresence = () => {
    if (amPresent) {
      startPresence(async () => { await upsertAttendance(match.id, [], false) })
    } else {
      const myPids = userToParticipants[userId] ?? []
      setSelectedPids(myPids)
      setPresenceSelecting(true)
    }
  }

  const confirmPresence = () => {
    startPresence(async () => {
      await upsertAttendance(match.id, selectedPids, true)
      setPresenceSelecting(false)
    })
  }

  const presentPids = new Set<string>()
  for (const a of attendance) for (const pid of a.participant_ids ?? []) presentPids.add(pid)
  const presentNames = participants.filter(p => presentPids.has(p.id)).map(p => p.apelido)

  const phaseLabel = match.phase === 'group'
    ? `Rodada ${match.round} · Grupo ${match.group_name}`
    : { round_of_32: '16 Avos', round_of_16: 'Oitavas', quarterfinal: 'Quartas', semifinal: 'Semifinal', third_place: '3º Lugar', final: 'Final' }[match.phase] ?? match.phase

  return (
    <>
      {/* Fixed pill header */}
      <div className="fixed top-14 sm:top-0 left-0 right-0 z-40 flex justify-center px-3 pt-2 pb-1 pointer-events-none">
        <div
          className="w-full max-w-3xl rounded-2xl shadow-2xl pointer-events-auto"
          style={{ background: '#1A1A1A', border: '1px solid #2a2a2a' }}
        >
          {/* Top row */}
          <div className="flex items-center gap-1 px-3 pt-2.5 pb-1">

            {/* Left: meta + nav prev */}
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <NavArrow dir="left" disabled={matchIdx === 0} onClick={() => onNavigate(-1)} />
              <div className="min-w-0">
                <div className="text-[10px] text-gray-400 leading-none truncate">
                  {fmtDate(match.match_datetime)} · {match.city}
                </div>
                <div className="text-[9px] text-gray-600 leading-none mt-0.5">{phaseLabel}</div>
              </div>
            </div>

            {/* Center: [flag abbr] [score] [logo] [score] [abbr flag] */}
            <div className="flex items-center gap-1.5 shrink-0">
              <TeamSide flag={match.flag_home} abbr={abbr(match.team_home)} side="home" goalAnim={goalAnim.home} />

              <ScoreBox score={match.score_home} editing={editing} inputVal={ih} onInput={setIh} />

              {/* Center logo + zebra */}
              <div className="flex flex-col items-center gap-0.5 px-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" width={18} height={18} className="object-contain opacity-30" style={{ mixBlendMode: 'screen' }} />
                {isZebra && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/zebra.png" alt="zebra" width={12} height={12} className="object-contain" />
                )}
              </div>

              <ScoreBox score={match.score_away} editing={editing} inputVal={ia} onInput={setIa} />

              <TeamSide flag={match.flag_away} abbr={abbr(match.team_away)} side="away" goalAnim={goalAnim.away} />
            </div>

            {/* Right: stadium + nav next */}
            <div className="flex items-center gap-1 flex-1 justify-end">
              <button
                onClick={() => setShowPresence(v => !v)}
                className="flex flex-col items-center gap-0 relative"
                title="No Estádio"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/estou-aqui.png" alt="No Estádio" width={28} height={28} className="object-contain" />
                {presentCount > 0 && (
                  <span className="text-[9px] font-bold text-cyan-400 leading-none">{presentCount}</span>
                )}
              </button>
              <NavArrow dir="right" disabled={matchIdx === matches.length - 1} onClick={() => onNavigate(1)} />
            </div>
          </div>

          {/* Edit bar */}
          <div className="flex items-center justify-center gap-2 pb-2 px-3">
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
                className="text-[10px] text-gray-500 hover:text-gray-300 underline underline-offset-2">
                {match.score_home !== null ? 'Editar placar' : 'Registrar placar'}
              </button>
            ) : (
              <span className="text-[10px] text-gray-700">J{match.match_number}</span>
            )}
          </div>
        </div>
      </div>

      {/* Presence popup */}
      {showPresence && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" onClick={() => setShowPresence(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-white text-sm">No Estádio</span>
              <button onClick={() => setShowPresence(false)} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
            </div>
            {presentNames.length === 0
              ? <p className="text-gray-500 text-sm">Ninguém marcou presença ainda.</p>
              : <ul className="space-y-1 mb-3">
                  {presentNames.map(n => (
                    <li key={n} className="text-sm text-gray-200 flex items-center gap-1">
                      <span className="text-green-400">✓</span> {n}
                    </li>
                  ))}
                </ul>
            }
            <button
              onClick={() => { setShowPresence(false); togglePresence() }}
              disabled={presencePending}
              className={`w-full rounded-xl py-2 text-sm font-bold transition ${amPresent ? 'bg-red-900 text-red-300 hover:bg-red-800' : 'bg-cyan-500 text-black hover:bg-cyan-400'}`}
            >
              {presencePending ? '…' : amPresent ? 'Cancelar minha presença' : 'Marcar presença'}
            </button>
          </div>
        </div>
      )}

      {/* Presence selection modal */}
      {presenceSelecting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4" onClick={() => setPresenceSelecting(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-white mb-1">Marcar presença</p>
            <p className="text-xs text-gray-400 mb-3">Quem está com você no estádio?</p>
            <ul className="space-y-1 max-h-52 overflow-y-auto mb-3">
              {participants.map(p => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={selectedPids.includes(p.id)}
                      onChange={e => setSelectedPids(prev =>
                        e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id)
                      )}
                      className="accent-cyan-400"
                    />
                    <span className="text-sm text-gray-200">{p.apelido}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button onClick={confirmPresence} disabled={presencePending}
                className="flex-1 rounded-xl py-2 text-sm font-bold bg-cyan-500 text-black hover:bg-cyan-400">
                {presencePending ? '…' : 'Confirmar'}
              </button>
              <button onClick={() => setPresenceSelecting(false)}
                className="px-4 text-sm text-gray-500 hover:text-gray-300">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function NavArrow({ dir, disabled, onClick }: { dir: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center w-7 h-7 rounded-full transition text-gray-400 ${disabled ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white active:scale-95'}`}
    >
      {dir === 'left' ? '‹' : '›'}
    </button>
  )
}

/** Bloco [bandeira + sigla] com ⚽ centralizado abaixo da sigla */
function TeamSide({ flag, abbr, side, goalAnim }: {
  flag: string; abbr: string; side: 'home' | 'away'; goalAnim: boolean
}) {
  return (
    <div className="flex flex-col items-center">
      <div className={`flex items-center gap-1 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
        <Flag code={flag} size="sm" className="w-7 h-[18px] rounded-[2px] object-cover" />
        <span className="text-[10px] font-black text-white tracking-wide">{abbr}</span>
      </div>
      {/* ⚽ aparece centralizado abaixo da sigla, ocupa espaço fixo para não empurrar layout */}
      <div className="h-3 flex items-center justify-center">
        {goalAnim && <span className="text-[11px] animate-bounce leading-none">⚽</span>}
      </div>
    </div>
  )
}

/** Retângulo ciano vertical com o dígito do placar */
function ScoreBox({ score, editing, inputVal, onInput }: {
  score: number | null; editing: boolean; inputVal: string; onInput: (v: string) => void
}) {
  return (
    <div
      className="flex items-center justify-center font-black text-base px-2 py-1 min-w-[2rem] rounded-md"
      style={{ background: editing ? '#333' : '#0a0f0f', border: `2px solid ${CYAN}`, color: CYAN }}
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
          : <span className="text-gray-600 text-sm font-bold">–</span>
      }
    </div>
  )
}
