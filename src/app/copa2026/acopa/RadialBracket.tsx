'use client'

import { useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import { R32_MATCHES, QF_PAIRS, SF_PAIRS } from '@/lib/bracket/engine'
import type { R32Slot } from '@/app/copa2026/tabela/BracketView'

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

// Ordem visual dos anéis 0–2 (32 times → 16avos → oitavas): reordena as
// posições geométricas — não os dados — para que o cruzamento oficial
// oitavas→quartas (QF_PAIRS, em engine.ts) apareça como vizinhança direta
// no diagrama, sem linhas cruzadas. QF_PAIRS.flat() = [0,1,4,5,2,3,6,7]:
// as oitavas de índice real 2/3 (Bloco 2) e 4/5 (Bloco 3) trocam de posição
// visual, e seus 16avos (ring 1) e times (ring 0) acompanham a troca.
const VISUAL_R16_ORDER: number[] = QF_PAIRS.flat()
const VISUAL_R32_ORDER: number[] = VISUAL_R16_ORDER.flatMap(k => [2 * k, 2 * k + 1])

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
  // QF — cruzamento oficial (ver QF_PAIRS), não pareamento sequencial
  const qfW  = qfDB.map((m, i) => {
    const [qa, qb] = QF_PAIRS[i] ?? [i * 2, i * 2 + 1]
    return getWinner(m, r16W[qa] ?? null, r16W[qb] ?? null)
  })
  // SF — cruzamento oficial (ver SF_PAIRS), não pareamento adjacente
  const sfW  = sfDB.map((m, i) => {
    const [qa, qb] = SF_PAIRS[i] ?? [0, 1]
    return getWinner(m, qfW[qa] ?? null, qfW[qb] ?? null)
  })

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

    // Ring 4 → Ring 3 (semis → quartas) — cruzamento oficial (ver SF_PAIRS):
    // a semi i não liga aos vizinhos geométricos 2i/2i+1, e sim ao par real
    // definido em SF_PAIRS (o vencedor do Bloco 1 enfrenta o do Bloco 3, e o
    // do Bloco 2 enfrenta o do Bloco 4).
    for (let i = 0; i < 2; i++) {
      const p = nodePos(4, i)
      const [qa, qb] = SF_PAIRS[i] ?? [0, 1]
      for (const qi of [qa, qb]) {
        const ch = nodePos(3, qi)
        result.push({ key: `r4-${i}-${qi}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.qf[qi] })
      }
    }

    // Ring 3 → Ring 2 (quartas → oitavas) — geometricamente adjacente: a
    // ordem visual do ring 2 (VISUAL_R16_ORDER) já foi rearranjada para que
    // a quarta i sempre ligue aos vizinhos 2i/2i+1 corretos.
    for (let i = 0; i < 4; i++) {
      const p = nodePos(3, i)
      for (let c = 0; c < 2; c++) {
        const r16Visual = 2 * i + c
        const ch = nodePos(2, r16Visual)
        result.push({ key: `r3-${i}-${c}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.r16[VISUAL_R16_ORDER[r16Visual]] })
      }
    }

    // Ring 2 → Ring 1 (oitavas → 16avos winners) — idem, via VISUAL_R32_ORDER
    for (let i = 0; i < 8; i++) {
      const p = nodePos(2, i)
      for (let c = 0; c < 2; c++) {
        const r32Visual = 2 * i + c
        const ch = nodePos(1, r32Visual)
        result.push({ key: `r2-${i}-${c}`, x1: p.x, y1: p.y, x2: ch.x, y2: ch.y, active: !!picks.r32[VISUAL_R32_ORDER[r32Visual]] })
      }
    }

    // Ring 1 → Ring 0 (16avos winners → 32 times) — idem, via VISUAL_R32_ORDER
    for (let i = 0; i < 16; i++) {
      const mi = VISUAL_R32_ORDER[i]
      const p = nodePos(1, i)
      const pA = nodePos(0, 2 * i)
      const pB = nodePos(0, 2 * i + 1)
      result.push({ key: `r1-${i}-0`, x1: p.x, y1: p.y, x2: pA.x, y2: pA.y, active: !!r32Slots[mi]?.teamA })
      result.push({ key: `r1-${i}-1`, x1: p.x, y1: p.y, x2: pB.x, y2: pB.y, active: !!r32Slots[mi]?.teamB })
    }

    return result
  }, [picks, r32Slots])

  // ── Nós do anel externo (ring 0, 32 times) ───────────────────────────────────
  // Percorre na ORDEM VISUAL (VISUAL_R32_ORDER): vi = posição geométrica,
  // mi = índice real do jogo do R32 (dados de picks.r32/r32Slots inalterados).
  const outerNodes = useMemo<BracketNode[]>(() =>
    VISUAL_R32_ORDER.flatMap((mi, vi) => {
      const slot = r32Slots[mi]
      if (!slot) return []
      const pA = nodePos(0, 2 * vi)
      const pB = nodePos(0, 2 * vi + 1)
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

    // `mapIndex` converte a posição visual (vi, geométrica) no índice real
    // dos arrays de `picks` — necessário nos anéis 1 e 2, cuja ordem visual
    // foi rearranjada (VISUAL_R32_ORDER/VISUAL_R16_ORDER) para eliminar
    // linhas cruzadas. Anéis 3 e 4 não são reordenados (vi === real).
    const ringCfg = [
      {
        ring: 1, count: 16,
        mapIndex:  (vi: number) => VISUAL_R32_ORDER[vi],
        getTeam:   (real: number) => picks.r32[real] ?? null,
        // R32→R16 nunca é cruzado: o real índice 2k/2k+1 sempre alimenta a
        // oitava real k.
        isWinner:  (_vi: number, real: number, t: string | null) => !!t && picks.r16[Math.floor(real / 2)] === t,
        getLabel:  (real: number) => `V.${R32_MATCHES[real]?.matchNum ?? ''}`,
      },
      {
        ring: 2, count: 8,
        mapIndex:  (vi: number) => VISUAL_R16_ORDER[vi],
        getTeam:   (real: number) => picks.r16[real] ?? null,
        // Cruzamento oficial (QF_PAIRS) já embutido na ordem visual: usando a
        // posição visual (vi), o par adjacente 2*floor(vi/2) sempre cai na
        // quarta correta.
        isWinner:  (vi: number, _real: number, t: string | null) => !!t && picks.qf[Math.floor(vi / 2)] === t,
        getLabel:  (real: number) => `Oit.${real + 1}`,
      },
      {
        ring: 3, count: 4,
        getTeam:   (real: number) => picks.qf[real] ?? null,
        // Cruzamento oficial (SF_PAIRS): a quarta i não alimenta a semi
        // Math.floor(i/2), e sim a semi cujo par contém i.
        isWinner:  (_vi: number, real: number, t: string | null) =>
          !!t && picks.sf[SF_PAIRS.findIndex(([a, b]) => a === real || b === real)] === t,
        getLabel:  (real: number) => `QF${real + 1}`,
      },
      {
        ring: 4, count: 2,
        getTeam:   (real: number) => picks.sf[real] ?? null,
        isWinner:  (_vi: number, _real: number, t: string | null) => !!t && picks.final === t,
        getLabel:  (real: number) => `SF${real + 1}`,
      },
    ]

    for (const { ring, count, mapIndex, getTeam, isWinner, getLabel } of ringCfg) {
      for (let vi = 0; vi < count; vi++) {
        const real = mapIndex ? mapIndex(vi) : vi
        const team = getTeam(real)
        const { x, y } = nodePos(ring, vi)
        result.push({
          key:   `r${ring}-${vi}`,
          ring,
          x, y,
          team,
          flag:  team ? (flagMap.get(team) ?? '') : '',
          label: getLabel(real),
          isWin: isWinner(vi, real, team),
        })
      }
    }

    return result
  }, [picks, flagMap])

  const champion     = picks.final
  const champFlag    = champion ? (flagMap.get(champion) ?? '') : ''

  // ── SVG ───────────────────────────────────────────────────────────────────────
  // CSS Grid sobrepõe SVG e <img> na mesma célula (gridArea '1/1').
  // O SVG determina o tamanho do container; a img fica centralizada por align/justifySelf.
  return (
    <div className="w-full overflow-x-auto touch-pan-x">
      <div
        className="mx-auto"
        style={{ minWidth: 360, maxWidth: 920, width: '100%', display: 'grid' }}
      >
        <svg
          viewBox="0 0 1000 1000"
          className="block w-full"
          style={{ gridArea: '1 / 1' }}
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
              stroke={l.active ? '#6b7280' : '#9ca3af'}
              strokeWidth={l.active ? 1.2 : 0.8}
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

          {/* Bandeira do campeão acima da taça, no mesmo tamanho (lg) dos
              demais nós — a taça (258×485px, 11% de largura) ocupa cerca de
              ±103 unidades do viewBox a partir do centro; um badge abaixo
              (CY+66) ficava coberto pela <img> da taça, que é pintada por
              cima do <svg> por vir depois no DOM. Centro em CY-155 fica fora
              do alcance da taça e de qualquer nó/linha do anel de
              semifinalistas mesmo com a caixa no tamanho padrão (NODE_W×NODE_H). */}
          {champion && (
            <foreignObject
              x={CX - NODE_W / 2} y={CY - 155 - NODE_H / 2}
              width={NODE_W} height={NODE_H} overflow="visible"
            >
              <div className="flex items-center justify-center h-full w-full rounded-sm border-2 border-amarelo-400 bg-amarelo-50 shadow">
                <Flag code={champFlag} size="lg" />
              </div>
            </foreignObject>
          )}
        </svg>

        {/* Taça sobreposta via CSS Grid — sem position absolute, sem % de altura */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/taca.png"
          alt="Taça da Copa do Mundo"
          className="pointer-events-none"
          style={{
            gridArea:    '1 / 1',
            alignSelf:   'center',
            justifySelf: 'center',
            width:       '11%',
            objectFit:   'contain',
          }}
        />
      </div>
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
