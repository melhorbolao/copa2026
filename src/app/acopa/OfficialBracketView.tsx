'use client'

import { useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import { R32_MATCHES, QF_PAIRS, SF_PAIRS } from '@/lib/bracket/engine'
import type { R32Slot } from '@/app/tabela/BracketView'

interface KnockoutMatch {
  id: string
  match_number: number
  phase: string
  team_home: string
  team_away: string
  score_home: number | null
  score_away: number | null
  penalty_winner: string | null
}

interface Props {
  r32Slots: R32Slot[]
  knockoutMatches: KnockoutMatch[]
}

// ── Posicionamento vertical (mesma fórmula do BracketView) ────────────────────

const MATCH_H  = 58
const UNIT     = MATCH_H / 2   // 29px
const MATCH_W  = 156
const COL_GAP  = 20
const COL_STEP = MATCH_W + COL_GAP

function matchTop(r: number, i: number): number {
  return UNIT * ((1 << (r + 1)) * i + (1 << r) - 1)
}

const CONTAINER_H  = 16 * MATCH_H
const ROUND_LABELS = ['16avos', 'Oitavas', 'Quartas', 'Semi', 'Final']

// ── Ordem visual de 16avos/Oitavas ───────────────────────────────────────────
// As Quartas usam o cruzamento oficial real (QF_PAIRS: Bloco1, Bloco3, Bloco2,
// Bloco4 — ver engine.ts), então as linhas de 16avos/Oitavas precisam seguir
// essa MESMA ordem visual para que cada card de Quartas fique alinhado com o
// bloco de Oitavas que realmente o alimenta. Isso é só reposicionamento na
// tela: os índices continuam apontando para os dados reais (picks.r32/r16),
// nenhum placar, palpite ou cálculo é alterado.
const R32_VISUAL_ORDER = [0, 1, 2, 3, 8, 9, 10, 11, 4, 5, 6, 7, 12, 13, 14, 15]
const R16_VISUAL_ORDER = [0, 1, 4, 5, 2, 3, 6, 7]

// ── Derivação do vencedor de cada jogo ───────────────────────────────────────

function getWinner(
  dbMatch: KnockoutMatch | undefined,
  teamA: string | null,
  teamB: string | null,
): string | null {
  if (!dbMatch || dbMatch.score_home === null || dbMatch.score_away === null) return null
  if (dbMatch.score_home > dbMatch.score_away) return teamA ?? dbMatch.team_home
  if (dbMatch.score_away > dbMatch.score_home) return teamB ?? dbMatch.team_away
  return dbMatch.penalty_winner ?? null   // empate → quem ganhou nos pênaltis
}

// ── Constrói picks oficiais a partir dos resultados reais ────────────────────

interface OfficialPicks {
  r32:   (string | null)[]   // 16
  r16:   (string | null)[]   // 8
  qf:    (string | null)[]   // 4
  sf:    (string | null)[]   // 2
  final: string | null
  third: string | null
}

function buildOfficialPicks(r32Slots: R32Slot[], knockoutMatches: KnockoutMatch[]): OfficialPicks {
  const byPhase = (phase: string) =>
    knockoutMatches.filter(m => m.phase === phase).sort((a, b) => a.match_number - b.match_number)

  // R32: identifica cada partida pelo match_number que está em R32_MATCHES
  const r32DB     = new Map(knockoutMatches.filter(m => m.phase === 'round_of_32').map(m => [m.match_number, m]))
  const r16DB     = byPhase('round_of_16')
  const qfDB      = byPhase('quarterfinal')
  const sfDB      = byPhase('semifinal')
  const thirdDB   = knockoutMatches.find(m => m.phase === 'third_place')
  const finalDB   = knockoutMatches.find(m => m.phase === 'final')

  // R32 winners — teamA/teamB vêm dos r32Slots calculados a partir das classificações
  const r32Winners = r32Slots.map((slot, i) => {
    const num = parseInt(R32_MATCHES[i]?.matchNum.slice(1) ?? '0', 10)
    return getWinner(r32DB.get(num), slot.teamA?.team ?? null, slot.teamB?.team ?? null)
  })

  // R16 winners — 8 partidas: r16DB[i] recebe r32Winners[2i] vs r32Winners[2i+1]
  const r16Winners = r16DB.map((m, i) =>
    getWinner(m, r32Winners[i * 2] ?? null, r32Winners[i * 2 + 1] ?? null)
  )

  // QF winners — cruzamento oficial (ver QF_PAIRS), não pareamento sequencial
  const qfWinners = qfDB.map((m, i) => {
    const [qa, qb] = QF_PAIRS[i] ?? [i * 2, i * 2 + 1]
    return getWinner(m, r16Winners[qa] ?? null, r16Winners[qb] ?? null)
  })

  // SF winners e perdedores (para 3º lugar) — cruzamento oficial (SF_PAIRS),
  // não pareamento adjacente: vencedor(Bloco1) x vencedor(Bloco3), e
  // vencedor(Bloco2) x vencedor(Bloco4).
  const sfWinners = sfDB.map((m, i) => {
    const [qa, qb] = SF_PAIRS[i] ?? [0, 1]
    return getWinner(m, qfWinners[qa] ?? null, qfWinners[qb] ?? null)
  })

  const sfLoser = (i: number): string | null => {
    const w = sfWinners[i]
    if (!w) return null
    const [qa, qb] = SF_PAIRS[i] ?? [0, 1]
    const a = qfWinners[qa] ?? null
    const b = qfWinners[qb] ?? null
    return w === a ? b : a
  }

  const finalWinner = getWinner(finalDB, sfWinners[0] ?? null, sfWinners[1] ?? null)
  const thirdWinner = getWinner(thirdDB, sfLoser(0), sfLoser(1))

  return {
    r32:   r32Winners,
    r16:   r16Winners.length ? r16Winners : Array(8).fill(null),
    qf:    qfWinners.length  ? qfWinners  : Array(4).fill(null),
    sf:    sfWinners.length  ? sfWinners  : Array(2).fill(null),
    final: finalWinner,
    third: thirdWinner,
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

export function OfficialBracketView({ r32Slots, knockoutMatches }: Props) {
  const picks = useMemo(
    () => buildOfficialPicks(r32Slots, knockoutMatches),
    [r32Slots, knockoutMatches],
  )

  // Mapa de bandeiras a partir dos r32Slots
  const flagMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of r32Slots) {
      if (s.teamA) m.set(s.teamA.team, s.teamA.flag)
      if (s.teamB) m.set(s.teamB.team, s.teamB.flag)
    }
    return m
  }, [r32Slots])

  const getTeam = (name: string | null) =>
    name ? { team: name, flag: flagMap.get(name) ?? '' } : null

  const finalTop = matchTop(4, 0)
  const thirdTop = finalTop + MATCH_H + 48
  const totalWidth = COL_STEP * 4 + MATCH_W

  // Perdedores das SFs para o 3º lugar — cruzamento oficial (SF_PAIRS)
  const sf0Loser = (() => {
    const w = picks.sf[0]
    if (!w) return null
    const [qa, qb] = SF_PAIRS[0]
    const a = picks.qf[qa]; const b = picks.qf[qb]
    return w === a ? b : a
  })()
  const sf1Loser = (() => {
    const w = picks.sf[1]
    if (!w) return null
    const [qa, qb] = SF_PAIRS[1]
    const a = picks.qf[qa]; const b = picks.qf[qb]
    return w === a ? b : a
  })()

  return (
    <div>
      {/* Cabeçalho das rodadas */}
      <div className="mb-2 flex items-end">
        {ROUND_LABELS.map((lbl, i) => (
          <div
            key={lbl}
            style={{ width: MATCH_W, marginLeft: i === 0 ? 0 : COL_GAP }}
            className="text-center text-[10px] font-bold uppercase tracking-widest text-gray-400"
          >
            {lbl}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="relative" style={{ height: Math.max(CONTAINER_H, thirdTop + MATCH_H + 8), width: totalWidth }}>

          {/* ── R32 ── */}
          {R32_VISUAL_ORDER.map((slotIdx, visRow) => {
            const slot = r32Slots[slotIdx]
            if (!slot) return null
            return (
              <div key={slot.matchNum}>
                {visRow > 0 && (
                  <div style={{
                    position: 'absolute', left: -4, top: matchTop(0, visRow) - 6,
                    width: MATCH_W + 8, height: 2,
                    background: 'linear-gradient(to right, #e5e7eb, #9ca3af, #e5e7eb)',
                    borderRadius: 1,
                  }} />
                )}
                <OfficialMatchCard
                  style={{ position: 'absolute', left: 0, top: matchTop(0, visRow) }}
                  teamA={slot.teamA}
                  teamB={slot.teamB}
                  winner={picks.r32[slotIdx]}
                  labelA={slot.labelA}
                  labelB={slot.labelB}
                />
              </div>
            )
          })}

          {/* ── R16 ── */}
          {R16_VISUAL_ORDER.map((r16Idx, visRow) => (
            <OfficialMatchCard
              key={r16Idx}
              style={{ position: 'absolute', left: COL_STEP, top: matchTop(1, visRow) }}
              teamA={getTeam(picks.r32[r16Idx * 2])}
              teamB={getTeam(picks.r32[r16Idx * 2 + 1])}
              winner={picks.r16[r16Idx]}
            />
          ))}

          {/* ── QF ── */}
          {/* Cruzamento oficial (QF_PAIRS): não são as oitavas vizinhas i*2/i*2+1 */}
          {Array.from({ length: 4 }, (_, i) => {
            const [ra, rb] = QF_PAIRS[i]
            return (
              <OfficialMatchCard
                key={i}
                style={{ position: 'absolute', left: COL_STEP * 2, top: matchTop(2, i) }}
                teamA={getTeam(picks.r16[ra])}
                teamB={getTeam(picks.r16[rb])}
                winner={picks.qf[i]}
              />
            )
          })}

          {/* ── SF ── */}
          {/* Cruzamento oficial (SF_PAIRS): QF exibidas não são as vizinhas
              geométricas i*2/i*2+1, e sim o par real que se enfrenta. */}
          {Array.from({ length: 2 }, (_, i) => {
            const [qa, qb] = SF_PAIRS[i]
            return (
              <OfficialMatchCard
                key={i}
                style={{ position: 'absolute', left: COL_STEP * 3, top: matchTop(3, i) }}
                teamA={getTeam(picks.qf[qa])}
                teamB={getTeam(picks.qf[qb])}
                winner={picks.sf[i]}
              />
            )
          })}

          {/* ── 3º Lugar ── */}
          <div style={{ position: 'absolute', left: COL_STEP * 4, top: thirdTop }}>
            <div className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-gray-400">3º Lugar</div>
            <OfficialMatchCard
              style={{}}
              teamA={getTeam(sf0Loser)}
              teamB={getTeam(sf1Loser)}
              winner={picks.third}
            />
          </div>

          {/* ── Badge campeão ── */}
          {picks.final && (
            <div
              style={{ position: 'absolute', left: COL_STEP * 4, top: finalTop - 34, width: MATCH_W }}
              className="flex items-center justify-center gap-1 rounded-lg bg-amarelo-100 px-2 py-1"
            >
              <Flag code={flagMap.get(picks.final) ?? ''} size="xs" className="shrink-0" />
              <span className="text-[11px] font-black text-amarelo-800">{picks.final}</span>
              <span className="text-[10px]">🏆</span>
            </div>
          )}

          {/* ── Final ── */}
          <div style={{ position: 'absolute', left: COL_STEP * 4, top: finalTop }}>
            <div className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-amarelo-600">Final</div>
            <OfficialMatchCard
              style={{}}
              teamA={getTeam(picks.sf[0])}
              teamB={getTeam(picks.sf[1])}
              winner={picks.final}
            />
          </div>

        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Chaveamento calculado automaticamente com base nos resultados oficiais.
      </p>
    </div>
  )
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

interface BracketTeam { team: string; flag: string }

function OfficialMatchCard({
  teamA, teamB, winner, style, labelA, labelB,
}: {
  teamA: BracketTeam | null
  teamB: BracketTeam | null
  winner: string | null | undefined
  style: React.CSSProperties
  labelA?: string
  labelB?: string
}) {
  return (
    <div
      style={{ ...style, width: MATCH_W }}
      className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm"
    >
      <OfficialTeamSlot team={teamA} isWinner={!!teamA && winner === teamA.team} posLabel={labelA} />
      <div className="h-px bg-gray-100" />
      <OfficialTeamSlot team={teamB} isWinner={!!teamB && winner === teamB.team} posLabel={labelB} />
    </div>
  )
}

function OfficialTeamSlot({
  team, isWinner, posLabel,
}: {
  team: BracketTeam | null
  isWinner: boolean
  posLabel?: string
}) {
  return (
    <div className={[
      'flex h-7 items-center gap-1 px-1.5 text-[11px] leading-none select-none',
      isWinner  ? 'bg-verde-50 font-bold text-verde-800' : '',
      !isWinner && team  ? 'text-gray-700' : '',
      !team ? 'text-gray-300' : '',
    ].filter(Boolean).join(' ')}>
      {team ? (
        <>
          <Flag code={team.flag} size="xs" className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{team.team}</span>
          {posLabel && <span className="hidden sm:inline shrink-0 text-[9px] font-medium text-gray-400">{posLabel}</span>}
          {isWinner && <span className="ml-auto shrink-0 text-[10px] text-verde-500">✓</span>}
        </>
      ) : (
        <>
          {posLabel && <span className="text-[9px] font-bold text-gray-300 mr-0.5">{posLabel}</span>}
          <span className="text-gray-300">—</span>
        </>
      )}
    </div>
  )
}
