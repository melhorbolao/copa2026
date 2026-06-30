'use client'

import { useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import { R32_MATCHES } from '@/lib/bracket/engine'
import type { R32Slot } from '@/app/tabela/BracketView'

// ── Types ──────────────────────────────────────────────────────────────────────

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
  r32Slots:        R32Slot[]
  knockoutMatches: KnockoutMatch[]
}

// ── Layout ─────────────────────────────────────────────────────────────────────

const CX = 500, CY = 500

// Raios dos anéis: externo (ring 0, 32 times) → interno (ring 4, 2 finalistas)
const RING_R: number[] = [450, 360, 272, 192, 120]

// Todos os nós mostram apenas a bandeira (lg = 48×36), sem texto
const NODE_W = 54   // 48 de bandeira + 3px padding cada lado
const NODE_H = 42   // 36 de bandeira + 3px padding cada lado

// ── Matemática ─────────────────────────────────────────────────────────────────

/**
 * Ângulo de um nó (ring, index) no diagrama radial.
 *
 * Fórmula: ((2^ring × (2×index + 1) − 1) / 64) × 2π − π/2
 *
 * Propriedades:
 *  - 64 = 2 × 32 (total de slots externos × 2)
 *  - −π/2: offset para começar no topo (12h)
 *  - Todo nó interno fica exatamente no ângulo médio entre seus dois filhos,
 *    garantindo o padrão de teia convergente.
 *  - Ring 0 (32 nós): passo angular fixo de 360/32 = 11,25° entre nós adjacentes
 */
function bracketAngle(ring: number, index: number): number {
  return ((Math.pow(2, ring) * (2 * index + 1) - 1) / 64) * 2 * Math.PI - Math.PI / 2
}

function nodePos(ring: number, index: number): { x: number; y: number } {
  const a = bracketAngle(ring, index)
  const r = RING_R[ring] ?? 0
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) }
}

// ── Picks (vencedores por fase) ────────────────────────────────────────────────

interface Picks {
  r32:   (string | null)[]   // [16] vencedores dos 16avos
  r16:   (string | null)[]   // [8]  vencedores das oitavas
  qf:    (string | null)[]   // [4]  vencedores das quartas
  sf:    (string | null)[]   // [2]  vencedores das semis (finalistas)
  final: string | null
}

function getWinner(
  m: KnockoutMatch | undefined,
  teamA: string | null,
  teamB: string | null,
): string | null {
  if (!m || m.score_home === null || m.score_away === null) return null
  if (m.score_home > m.score_away) return teamA
  if (m.score_away > m.score_home) return teamB
  return m.penalty_winner ?? null
}

function buildPicks(r32Slots: R32Slot[], ko: KnockoutMatch[]): Picks {
  const by = (ph: string) =>
    ko.filter(m => m.phase === ph).sort((a, b) => a.match_number - b.match_number)

  const r32DB = new Map(
    ko.filter(m => m.phase === 'round_of_32').map(m => [m.match_number, m]),
  )
  const r16DB = by('round_of_16')
  const qfDB  = by('quarterfinal')
  const sfDB  = by('semifinal')
  const finDB = ko.find(m => m.phase === 'final')

  const r32W = r32Slots.map((s, i) => {
    const num = parseInt(R32_MATCHES[i]?.matchNum.slice(1) ?? '0', 10)
    return getWinner(r32DB.get(num), s.teamA?.team ?? null, s.teamB?.team ?? null)
  })
  const r16W = r16DB.map((m, i) =>
    getWinner(m, r32W[i * 2] ?? null, r32W[i * 2 + 1] ?? null))
  const qfW  = qfDB.map((m, i) =>
    getWinner(m, r16W[i * 2] ?? null, r16W[i * 2 + 1] ?? null))
  const sfW  = sfDB.map((m, i) =>
    getWinner(m, qfW[i * 2] ?? null, qfW[i * 2 + 1] ?? null))

  return {
    r32:   r32W,
    r16:   r16W.length ? r16W : Array(8).fill(null),
    qf:    qfW.length  ? qfW  : Array(4).fill(null),
    sf:    sfW.length  ? sfW  : Array(2).fill(null),
    final: getWinner(finDB, sfW[0] ?? null, sfW[1] ?? null),
  }
}

// ── Tipos internos ─────────────────────────────────────────────────────────────

interface ConnLine {
  key: string
  x1: number; y1: number
  x2: number; y2: number
  active: boolean
}

interface BracketNode {
  key:    string
  ring:   number
  x:      number
  y:      number
  team:   string | null
  flag:   string
  label:  string
  isWin:  boolean
}

// ── Componente principal ───────────────────────────────────────────────────────

export function RadialBracket({ r32Slots, knockoutMatches }: Props) {
  // ── Dados derivados ──────────────────────────────────────────────────────────
  const { picks, flagMap } = useMemo(() => {
    const p = buildPicks(r32Slots, knockoutMatches)
    const fm = new Map<string, string>()
    for (const s of r32Slots) {
      if (s.teamA) fm.set(s.teamA.team, s.teamA.flag)
      if (s.teamB) fm.set(s.teamB.team, s.teamB.flag)
    }
    return { picks: p, flagMap: fm }
  }, [r32Slots, knockoutMatches])

  // ── Linhas conectoras (62 arestas da árvore binária do chaveamento) ──────────
  const lines = useMemo<ConnLine[]>(() => {
    const result: ConnLine[] = []

    // Centro → ring 4 (2 finalistas)
    for (let i = 0; i < 2; i++) {
      const { x, y } = nodePos(4, i)
      result.push({ key: `fin-${i}`, x1: CX, y1: CY, x2: x, y2: y, active: !!picks.sf[i] })
    }

    // Ring 4 → Ring 3 (semis → quartas)
    for (let i = 0; i < 2; i++) {
      const p = nodePos(4, i)
      for (let c = 0; c < 2; c++) {
        const ch = nodePos(3, 2 * i + c)
        result.push({ key: `r4-${i}-${c}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.qf[2 * i + c] })
      }
    }

    // Ring 3 → Ring 2 (quartas → oitavas)
    for (let i = 0; i < 4; i++) {
      const p = nodePos(3, i)
      for (let c = 0; c < 2; c++) {
        const ch = nodePos(2, 2 * i + c)
        result.push({ key: `r3-${i}-${c}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.r16[2 * i + c] })
      }
    }

    // Ring 2 → Ring 1 (oitavas → 16avos winners)
    for (let i = 0; i < 8; i++) {
      const p = nodePos(2, i)
      for (let c = 0; c < 2; c++) {
        const ch = nodePos(1, 2 * i + c)
        result.push({ key: `r2-${i}-${c}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.r32[2 * i + c] })
      }
    }

    // Ring 1 → Ring 0 (16avos winners → 32 times)
    for (let i = 0; i < 16; i++) {
      const p = nodePos(1, i)
      const pA = nodePos(0, 2 * i)
      const pB = nodePos(0, 2 * i + 1)
      result.push({ key: `r1-${i}-0`, x1: p.x, y1: p.y, x2: pA.x, y2: pA.y, active: !!r32Slots[i]?.teamA })
      result.push({ key: `r1-${i}-1`, x1: p.x, y1: p.y, x2: pB.x, y2: pB.y, active: !!r32Slots[i]?.teamB })
    }

    return result
  }, [picks, r32Slots])

  // ── Nós do anel externo (ring 0, 32 times) ───────────────────────────────────
  const outerNodes = useMemo<BracketNode[]>(() =>
    r32Slots.flatMap((slot, mi) => {
      const pA = nodePos(0, 2 * mi)
      const pB = nodePos(0, 2 * mi + 1)
      return [
        {
          key:   `r0-${mi}-A`,
          ring:  0,
          x:     pA.x,
          y:     pA.y,
          team:  slot.teamA?.team ?? null,
          flag:  slot.teamA?.flag ?? '',
          label: slot.labelA,
          isWin: !!slot.teamA && picks.r32[mi] === slot.teamA.team,
        },
        {
          key:   `r0-${mi}-B`,
          ring:  0,
          x:     pB.x,
          y:     pB.y,
          team:  slot.teamB?.team ?? null,
          flag:  slot.teamB?.flag ?? '',
          label: slot.labelB,
          isWin: !!slot.teamB && picks.r32[mi] === slot.teamB.team,
        },
      ]
    }),
  [r32Slots, picks])

  // ── Nós dos anéis internos (rings 1–4) ───────────────────────────────────────
  const innerNodes = useMemo<BracketNode[]>(() => {
    const result: BracketNode[] = []

    const ringCfg = [
      {
        ring: 1, count: 16,
        getTeam:   (i: number) => picks.r32[i] ?? null,
        isWinner:  (i: number, t: string | null) => !!t && picks.r16[Math.floor(i / 2)] === t,
        getLabel:  (i: number) => `V.${R32_MATCHES[i]?.matchNum ?? ''}`,
      },
      {
        ring: 2, count: 8,
        getTeam:   (i: number) => picks.r16[i] ?? null,
        isWinner:  (i: number, t: string | null) => !!t && picks.qf[Math.floor(i / 2)] === t,
        getLabel:  (i: number) => `Oit.${i + 1}`,
      },
      {
        ring: 3, count: 4,
        getTeam:   (i: number) => picks.qf[i] ?? null,
        isWinner:  (i: number, t: string | null) => !!t && picks.sf[Math.floor(i / 2)] === t,
        getLabel:  (i: number) => `QF${i + 1}`,
      },
      {
        ring: 4, count: 2,
        getTeam:   (i: number) => picks.sf[i] ?? null,
        isWinner:  (i: number, t: string | null) => !!t && picks.final === t,
        getLabel:  (i: number) => `SF${i + 1}`,
      },
    ]

    for (const { ring, count, getTeam, isWinner, getLabel } of ringCfg) {
      for (let i = 0; i < count; i++) {
        const team = getTeam(i)
        const { x, y } = nodePos(ring, i)
        result.push({
          key:   `r${ring}-${i}`,
          ring,
          x, y,
          team,
          flag:  team ? (flagMap.get(team) ?? '') : '',
          label: getLabel(i),
          isWin: isWinner(i, team),
        })
      }
    }

    return result
  }, [picks, flagMap])

  const champion     = picks.final
  const champFlag    = champion ? (flagMap.get(champion) ?? '') : ''

  // ── SVG ───────────────────────────────────────────────────────────────────────
  return (
    <div className="w-full overflow-x-auto touch-pan-x">
      <svg
        viewBox="0 0 1000 1000"
        style={{ minWidth: 360, width: '100%', maxWidth: 920 }}
        className="mx-auto block"
      >
        {/* Círculos-guia concêntricos (muito sutis) */}
        {RING_R.map((r, i) => (
          <circle key={`g-${i}`} cx={CX} cy={CY} r={r}
            fill="none" stroke="#f1f5f9" strokeWidth={0.6} />
        ))}

        {/* Linhas conectoras */}
        {lines.map(l => (
          <line
            key={l.key}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={l.active ? '#d1d5db' : '#e5e7eb'}
            strokeWidth={l.active ? 0.9 : 0.5}
          />
        ))}

        {/* Nós do anel externo (32 times) */}
        {outerNodes.map(({ key, ring: _r, label: _l, ...n }) => (
          <BracketNodeCell key={key} {...n} />
        ))}

        {/* Nós dos anéis internos (rings 1–4) */}
        {innerNodes.map(({ key, ring: _r, label: _l, ...n }) => (
          <BracketNodeCell key={key} {...n} />
        ))}

        {/* Centro: taça da Copa do Mundo */}
        <image
          href="/logoCopa.png"
          x={CX - 52} y={CY - 62}
          width={104} height={124}
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Bandeira do campeão abaixo da taça */}
        {champion && (
          <foreignObject x={CX - 28} y={CY + 64} width={56} height={22} overflow="visible">
            <div className="flex items-center justify-center gap-1 h-full w-full rounded border-2 border-amarelo-400 bg-amarelo-50 shadow-sm">
              <Flag code={champFlag} size="xs" />
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  )
}

// ── Sub-componente: nó individual ─────────────────────────────────────────────

function BracketNodeCell({ x, y, team, flag, isWin }: Omit<BracketNode, 'key' | 'label' | 'ring'> & { isWin: boolean }) {
  const w = NODE_W
  const h = NODE_H

  if (team) {
    return (
      <foreignObject
        x={x - w / 2} y={y - h / 2}
        width={w} height={h}
        overflow="visible"
      >
        <div
          className={[
            'flex w-full h-full items-center justify-center rounded-sm shadow border',
            isWin ? 'border-verde-400 ring-1 ring-verde-400' : 'border-gray-200 bg-white',
          ].join(' ')}
        >
          <Flag code={flag} size="lg" />
        </div>
      </foreignObject>
    )
  }

  return (
    <foreignObject
      x={x - w / 2} y={y - h / 2}
      width={w} height={h}
      overflow="visible"
    >
      <div className="w-full h-full rounded-sm border border-dashed border-gray-200 bg-gray-50" />
    </foreignObject>
  )
}
