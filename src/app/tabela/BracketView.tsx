'use client'

import { useState, useEffect, useTransition } from 'react'
import { Flag } from '@/components/ui/Flag'
import { fillG4FromBracket } from '@/app/palpites/actions'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface BracketTeam { team: string; flag: string }
export interface R32Slot { matchNum: string; teamA: BracketTeam | null; teamB: BracketTeam | null }

interface Props {
  r32Slots: R32Slot[]
  userId: string
  g4Deadline: string
  hasTournamentBet: boolean
}

type Picks = {
  r32:   (string | null)[]   // 16
  r16:   (string | null)[]   // 8
  qf:    (string | null)[]   // 4
  sf:    (string | null)[]   // 2
  final: string | null
  third: string | null
}

// ── Estado inicial ────────────────────────────────────────────────────────────

function emptyPicks(): Picks {
  return { r32: Array(16).fill(null), r16: Array(8).fill(null), qf: Array(4).fill(null), sf: Array(2).fill(null), final: null, third: null }
}

// ── Lógica de picks ───────────────────────────────────────────────────────────

function makePick(picks: Picks, round: string, idx: number, team: string): Picks {
  const n: Picks = {
    r32: [...picks.r32], r16: [...picks.r16],
    qf:  [...picks.qf],  sf:  [...picks.sf],
    final: picks.final,  third: picks.third,
  }
  if (round === 'r32') {
    n.r32[idx] = team
    const r16i = Math.floor(idx / 2); n.r16[r16i] = null
    const qfi  = Math.floor(r16i / 2); n.qf[qfi]  = null
    const sfi  = Math.floor(qfi / 2);  n.sf[sfi]  = null
    n.final = null; n.third = null
  } else if (round === 'r16') {
    n.r16[idx] = team
    const qfi = Math.floor(idx / 2); n.qf[qfi] = null
    const sfi = Math.floor(qfi / 2); n.sf[sfi] = null
    n.final = null; n.third = null
  } else if (round === 'qf') {
    n.qf[idx] = team
    const sfi = Math.floor(idx / 2); n.sf[sfi] = null
    n.final = null; n.third = null
  } else if (round === 'sf') {
    n.sf[idx] = team; n.final = null; n.third = null
  } else if (round === 'final') {
    n.final = team
  } else if (round === 'third') {
    n.third = team
  }
  return n
}

// ── Posicionamento vertical ───────────────────────────────────────────────────
// Fórmula: top = UNIT * (2^(r+1) * i + 2^r − 1), onde UNIT = MATCH_H / 2

const MATCH_H = 58   // altura do card (2 linhas de 28px + 2px divisor)
const UNIT    = MATCH_H / 2  // 29px

function matchTop(r: number, i: number): number {
  const mult = 1 << (r + 1)
  const base = 1 << r
  return UNIT * (mult * i + base - 1)
}

// Container height = 16 matches * MATCH_H = 928px
const CONTAINER_H = 16 * MATCH_H

// ── Dimensões das colunas ─────────────────────────────────────────────────────

const MATCH_W  = 156
const COL_GAP  = 20
const COL_STEP = MATCH_W + COL_GAP

const ROUND_HEADERS = ['R32', 'R16', 'QF', 'SF', 'Final / 3º']

// ── Mapa de bandeiras ─────────────────────────────────────────────────────────

function buildFlagMap(r32Slots: R32Slot[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of r32Slots) {
    if (s.teamA) m.set(s.teamA.team, s.teamA.flag)
    if (s.teamB) m.set(s.teamB.team, s.teamB.flag)
  }
  return m
}

// ── Componente principal ──────────────────────────────────────────────────────

export function BracketView({ r32Slots, userId, g4Deadline, hasTournamentBet }: Props) {
  const storageKey = `bracket_v2_${userId}`

  const [picks,   setPicks]   = useState<Picks>(emptyPicks)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setPicks(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [storageKey])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem(storageKey, JSON.stringify(picks))
  }, [picks, storageKey, mounted])

  const flagMap = buildFlagMap(r32Slots)
  const getTeam = (name: string | null) =>
    name ? { team: name, flag: flagMap.get(name) ?? '' } : null

  const pick = (round: string, idx: number, team: string) =>
    setPicks(prev => makePick(prev, round, idx, team))

  // ── G4 fill ────────────────────────────────────────────────
  const [g4Pending, startG4] = useTransition()
  const [showG4Confirm, setShowG4Confirm] = useState(false)
  const [g4Error, setG4Error] = useState('')

  const canFillG4 =
    picks.qf.every(p => p !== null) &&
    picks.sf.every(p => p !== null) &&
    picks.final !== null

  const g4Open = g4Deadline ? new Date() < new Date(g4Deadline) : false

  const deriveG4 = () => {
    const champion  = picks.final!
    const runner_up = picks.sf[0] === champion ? picks.sf[1]! : picks.sf[0]!
    const semi1     = picks.sf[0] === picks.qf[0] ? picks.qf[1]! : picks.qf[0]!
    const semi2     = picks.sf[1] === picks.qf[2] ? picks.qf[3]! : picks.qf[2]!
    return { champion, runner_up, semi1, semi2 }
  }

  const doFillG4 = () => {
    setG4Error('')
    startG4(async () => {
      try {
        await fillG4FromBracket(deriveG4())
        setShowG4Confirm(false)
      } catch (e) {
        setG4Error(e instanceof Error ? e.message : 'Erro')
      }
    })
  }

  const handleG4Click = () => {
    if (hasTournamentBet) setShowG4Confirm(true)
    else doFillG4()
  }

  // Perdedores das SFs → jogo de 3º lugar
  const sfLoser = (sfIdx: number): string | null => {
    const winner = picks.sf[sfIdx]
    if (!winner) return null
    const a = picks.qf[sfIdx * 2]
    const b = picks.qf[sfIdx * 2 + 1]
    if (winner === a) return b
    if (winner === b) return a
    return null
  }

  const thirdA = sfLoser(0)
  const thirdB = sfLoser(1)
  const finalTop  = matchTop(4, 0)
  const thirdTop  = finalTop + MATCH_H + 48  // espaço fixo independente do badge

  if (!mounted) {
    return <div className="flex h-32 items-center justify-center text-sm text-gray-400">Carregando chaveamento…</div>
  }

  const totalWidth = COL_STEP * 4 + MATCH_W

  return (
    <div>
      {/* Cabeçalho das rodadas */}
      <div className="mb-2 flex items-end" style={{ gap: 0 }}>
        {ROUND_HEADERS.map((lbl, i) => (
          <div
            key={lbl}
            style={{ width: MATCH_W, marginLeft: i === 0 ? 0 : COL_GAP }}
            className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400"
          >
            {lbl}
          </div>
        ))}
      </div>

      {/* Bracket */}
      <div className="overflow-x-auto pb-4">
        <div className="relative" style={{ height: Math.max(CONTAINER_H, thirdTop + MATCH_H + 8), width: totalWidth }}>

          {/* ── R32 ── */}
          {r32Slots.map((slot, i) => (
            <div key={slot.matchNum}>
              {/* Separador visual a cada 4 partidas (entre QFs) */}
              {i > 0 && i % 4 === 0 && (
                <div
                  style={{
                    position: 'absolute',
                    left: -4,
                    top: matchTop(0, i) - 6,
                    width: MATCH_W + 8,
                    height: 2,
                    background: 'linear-gradient(to right, #e5e7eb, #9ca3af, #e5e7eb)',
                    borderRadius: 1,
                  }}
                />
              )}
              <MatchCard
                style={{ position: 'absolute', left: 0, top: matchTop(0, i) }}
                teamA={slot.teamA}
                teamB={slot.teamB}
                winner={picks.r32[i]}
                onPick={t => pick('r32', i, t)}
              />
            </div>
          ))}

          {/* ── R16 ── */}
          {Array.from({ length: 8 }, (_, i) => (
            <MatchCard
              key={i}
              style={{ position: 'absolute', left: COL_STEP, top: matchTop(1, i) }}
              teamA={getTeam(picks.r32[i * 2])}
              teamB={getTeam(picks.r32[i * 2 + 1])}
              winner={picks.r16[i]}
              onPick={t => pick('r16', i, t)}
            />
          ))}

          {/* ── QF ── */}
          {Array.from({ length: 4 }, (_, i) => (
            <MatchCard
              key={i}
              style={{ position: 'absolute', left: COL_STEP * 2, top: matchTop(2, i) }}
              teamA={getTeam(picks.r16[i * 2])}
              teamB={getTeam(picks.r16[i * 2 + 1])}
              winner={picks.qf[i]}
              onPick={t => pick('qf', i, t)}
            />
          ))}

          {/* ── SF ── */}
          {Array.from({ length: 2 }, (_, i) => (
            <MatchCard
              key={i}
              style={{ position: 'absolute', left: COL_STEP * 3, top: matchTop(3, i) }}
              teamA={getTeam(picks.qf[i * 2])}
              teamB={getTeam(picks.qf[i * 2 + 1])}
              winner={picks.sf[i]}
              onPick={t => pick('sf', i, t)}
            />
          ))}

          {/* ── Badge campeão (acima da Final, cresce para cima) ── */}
          {picks.final && (
            <div style={{ position: 'absolute', left: COL_STEP * 4, top: finalTop - 34, width: MATCH_W }}
              className="flex items-center justify-center gap-1 rounded-lg bg-amarelo-100 px-2 py-1"
            >
              <Flag code={flagMap.get(picks.final) ?? ''} size="sm" className="!h-2.5 !w-3.5 shrink-0" />
              <span className="text-[11px] font-black text-amarelo-800">{picks.final}</span>
              <span className="text-[10px]">🏆</span>
            </div>
          )}

          {/* ── Final ── */}
          <div style={{ position: 'absolute', left: COL_STEP * 4, top: finalTop }}>
            <div className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-amarelo-600">Final</div>
            <MatchCard
              style={{}}
              teamA={getTeam(picks.sf[0])}
              teamB={getTeam(picks.sf[1])}
              winner={picks.final}
              onPick={t => pick('final', 0, t)}
            />
          </div>

          {/* ── 3º Lugar ── */}
          <div style={{ position: 'absolute', left: COL_STEP * 4, top: thirdTop }}>
            <div className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-gray-400">3º Lugar</div>
            <MatchCard
              style={{}}
              teamA={getTeam(thirdA)}
              teamB={getTeam(thirdB)}
              winner={picks.third}
              onPick={t => pick('third', 0, t)}
            />
          </div>

        </div>
      </div>

      {/* Rodapé */}
      <div className="mt-3 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-gray-400">
          Clique em uma seleção para avançá-la à próxima fase.
        </p>
        <button
          onClick={() => setPicks(emptyPicks())}
          className="text-xs text-gray-400 underline hover:text-gray-600"
        >
          Limpar chaveamento
        </button>
      </div>

      {/* Botão G4 */}
      {g4Open && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-azul-escuro/20 bg-blue-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-azul-escuro">
              Preencher / atualizar palpites do G4 com base no chaveamento
            </p>
            {!canFillG4 && (
              <p className="mt-0.5 text-xs text-gray-500">
                Complete o chaveamento até a final para habilitar.
              </p>
            )}
            {g4Error && <p className="mt-0.5 text-xs text-red-500">{g4Error}</p>}
          </div>
          <button
            onClick={handleG4Click}
            disabled={!canFillG4 || g4Pending}
            className="rounded-lg bg-azul-escuro px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {g4Pending ? 'Preenchendo…' : 'Preencher G4'}
          </button>
        </div>
      )}

      {/* Confirmação G4 */}
      {showG4Confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-gray-900">Sobrescrever palpites do G4?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Você já tem palpites do G4 preenchidos. Deseja substituí-los pelos times do seu chaveamento?
              O artilheiro não será alterado.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowG4Confirm(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={doFillG4}
                disabled={g4Pending}
                className="rounded-lg bg-azul-escuro px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
              >
                {g4Pending ? 'Preenchendo…' : 'Sim, substituir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function MatchCard({
  teamA, teamB, winner, onPick, label, style,
}: {
  teamA: BracketTeam | null
  teamB: BracketTeam | null
  winner: string | null
  onPick: (team: string) => void
  label?: string
  style: React.CSSProperties
}) {
  const canPick = !!(teamA && teamB)
  return (
    <div
      style={{ ...style, width: MATCH_W }}
      className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm"
    >
      {label && (
        <div className="bg-gray-800 px-1.5 py-0.5 text-[9px] font-mono leading-tight text-gray-400">
          {label}
        </div>
      )}
      <TeamSlot
        team={teamA}
        isWinner={!!teamA && winner === teamA.team}
        onClick={canPick ? () => onPick(teamA!.team) : undefined}
      />
      <div className="h-px bg-gray-100" />
      <TeamSlot
        team={teamB}
        isWinner={!!teamB && winner === teamB.team}
        onClick={canPick ? () => onPick(teamB!.team) : undefined}
      />
    </div>
  )
}

function TeamSlot({
  team, isWinner, onClick,
}: {
  team: BracketTeam | null
  isWinner: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={[
        'flex h-7 items-center gap-1 px-1.5 text-[11px] leading-none select-none',
        isWinner  ? 'bg-verde-50 font-bold text-verde-800' : '',
        !isWinner && team && onClick ? 'cursor-pointer text-gray-700 hover:bg-gray-50' : '',
        !isWinner && team && !onClick ? 'text-gray-700' : '',
        !team ? 'text-gray-300' : '',
      ].filter(Boolean).join(' ')}
    >
      {team ? (
        <>
          <Flag code={team.flag} size="sm" className="!h-2.5 !w-3.5 shrink-0" />
          <span className="truncate">{team.team}</span>
          {isWinner && <span className="ml-auto shrink-0 text-[10px] text-verde-500">✓</span>}
        </>
      ) : (
        <span>—</span>
      )}
    </div>
  )
}
