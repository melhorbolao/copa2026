'use client'

import { useState, useRef, useTransition } from 'react'
import { Flag } from '@/components/ui/Flag'
import { updateGroupBetFromReorder } from './actions'
import type { CalcGroupStanding, TeamRow } from '@/lib/bracket/engine'

interface Props {
  standing:          CalcGroupStanding
  advancingGroups:   Set<string>
  userId:            string
  /** Times em empate real segundo critérios FIFA (antes de qualquer override) */
  originalTiedTeams: string[]
  /** Palpite formal de 1º/2º já salvo pelo usuário (null se não preenchido) */
  formalBet:         { first_place: string; second_place: string } | null
  manualOrder:       string[] | null
  onOrderChange:     (order: string[]) => void
  onOrderReset:      () => void
}

const POS_COLORS = [
  'bg-verde-600 text-white',
  'bg-azul-escuro text-white',
  'bg-amber-400 text-amber-900',
  'bg-gray-200 text-gray-600',
]

export function GroupCard({
  standing,
  advancingGroups,
  userId,
  originalTiedTeams,
  formalBet,
  manualOrder,
  onOrderChange,
  onOrderReset,
}: Props) {
  const storageKey = `tie_order_${userId}_${standing.group}`

  const hasTie = originalTiedTeams.length > 0

  const [draftOrder,       setDraftOrder]       = useState<string[] | null>(null)
  const [dragOver,         setDragOver]         = useState<number | null>(null)
  const [showModal,        setShowModal]        = useState(false)
  const [confirmPending,   startConfirm]        = useTransition()
  const [confirmError,     setConfirmError]     = useState('')
  const dragIdx = useRef<number | null>(null)

  // Prioridade de exibição: rascunho > ordem confirmada > calculada
  const displayTeams: TeamRow[] = (() => {
    const order = draftOrder ?? manualOrder
    if (!order) return standing.teams
    const teamMap = new Map(standing.teams.map(t => [t.team, t]))
    const ordered = order.map(n => teamMap.get(n)).filter(Boolean) as TeamRow[]
    if (ordered.length !== standing.teams.length) return standing.teams
    return ordered
  })()

  // ── Drag handlers ──────────────────────────────────────────────
  const handleDragStart = (i: number) => { dragIdx.current = i }
  const handleDragOver  = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i) }
  const handleDragEnd   = () => { dragIdx.current = null; setDragOver(null) }

  const handleDrop = (i: number) => {
    if (dragIdx.current === null || dragIdx.current === i) {
      dragIdx.current = null; setDragOver(null); return
    }
    const next = [...displayTeams]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    setDraftOrder(next.map(t => t.team))
    dragIdx.current = null
    setDragOver(null)
  }

  // ── Lógica de commit com verificação de palpite formal ─────────
  const doCommit = (order: string[]) => {
    onOrderChange(order)
    try { localStorage.setItem(storageKey, JSON.stringify(order)) } catch { /* ignore */ }
    setDraftOrder(null)
  }

  const handleSaveClick = () => {
    if (!draftOrder) return
    const newFirst  = draftOrder[0]
    const newSecond = draftOrder[1]

    // Sem palpite formal → commita direto
    if (!formalBet) {
      doCommit(draftOrder)
      return
    }

    // Palpite formal igual à nova ordem → commita direto
    if (formalBet.first_place === newFirst && formalBet.second_place === newSecond) {
      doCommit(draftOrder)
      return
    }

    // Palpite formal diferente → abre modal de confirmação
    setConfirmError('')
    setShowModal(true)
  }

  const handleConfirmYes = () => {
    if (!draftOrder) return
    setConfirmError('')
    startConfirm(async () => {
      try {
        await updateGroupBetFromReorder(standing.group, draftOrder[0], draftOrder[1])
        doCommit(draftOrder)
        setShowModal(false)
      } catch (e) {
        setConfirmError(e instanceof Error ? e.message : 'Erro ao atualizar palpite')
      }
    })
  }

  const handleConfirmNo = () => {
    // Descarta o rascunho sem alterar nada
    setDraftOrder(null)
    setShowModal(false)
  }

  const discardDraft = () => setDraftOrder(null)

  const resetOrder = () => {
    setDraftOrder(null)
    onOrderReset()
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }

  // ── Flags de estado ────────────────────────────────────────────
  const isManuallyOrdered  = manualOrder !== null
  const hasDraft           = draftOrder !== null
  const isTiedUnresolved   = (team: TeamRow) =>
    originalTiedTeams.includes(team.team) && !isManuallyOrdered && !hasDraft

  const third    = displayTeams[2]
  const thirdAdv = third && advancingGroups.has(standing.group)

  return (
    <>
    <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ backgroundColor: '#002776' }}>
        <span className="text-sm font-black uppercase tracking-widest text-white">
          Grupo {standing.group}
        </span>

        {hasTie && !isManuallyOrdered && !hasDraft && (
          <span className="ml-auto rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-900">
            ⚠️ Empate — arraste para definir
          </span>
        )}

        {hasDraft && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={discardDraft}
              className="text-[10px] font-medium text-white/60 underline hover:text-white/80"
            >
              Descartar
            </button>
            <button
              onClick={handleSaveClick}
              className="rounded-full bg-verde-500 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-verde-600"
            >
              💾 Salvar ordem
            </button>
          </div>
        )}

        {isManuallyOrdered && !hasDraft && (
          <button
            onClick={resetOrder}
            className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/30"
          >
            ↺ Resetar ordem
          </button>
        )}
      </div>

      {/* Aviso de empate não resolvido */}
      {hasTie && !isManuallyOrdered && !hasDraft && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>Empate nos critérios 1–6 da FIFA</strong> entre{' '}
          {originalTiedTeams.join(' e ')}.{' '}
          Arraste as linhas para definir manualmente (simula Ranking FIFA ou Cartões).
        </div>
      )}

      {/* Aviso de rascunho pendente */}
      {hasDraft && (
        <div className="border-b border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Ordem alterada — clique em <strong>💾 Salvar ordem</strong> para aplicar ao chaveamento e à tabela de terceiros.
        </div>
      )}

      {/* Tabela */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50 text-gray-400">
            {hasTie && <th className="w-4 px-1 py-1.5" />}
            <th className="w-6 px-2 py-1.5 text-center font-medium">#</th>
            <th className="px-2 py-1.5 text-left font-medium">Seleção</th>
            <th className="w-8 px-2 py-1.5 text-center font-medium">Pts</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">J</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">V</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">E</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">D</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GP</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">GC</th>
            <th className="w-7 px-1 py-1.5 text-center font-medium">SG</th>
          </tr>
        </thead>
        <tbody>
          {displayTeams.map((team, i) => {
            const isThirdAdv     = i === 2 && thirdAdv
            const tiedUnresolved = isTiedUnresolved(team)
            const draggable      = hasTie

            return (
              <tr
                key={team.team}
                draggable={draggable}
                onDragStart={draggable ? () => handleDragStart(i) : undefined}
                onDragOver={draggable  ? e => handleDragOver(e, i) : undefined}
                onDrop={draggable      ? () => handleDrop(i) : undefined}
                onDragEnd={draggable   ? handleDragEnd : undefined}
                className={[
                  'border-t border-gray-100 transition',
                  i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40',
                  dragOver === i ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : '',
                  draggable     ? 'cursor-grab active:cursor-grabbing select-none' : '',
                ].join(' ')}
              >
                {hasTie && (
                  <td className="px-1 py-2 text-center text-gray-300">
                    {originalTiedTeams.includes(team.team)
                      ? '⠿'
                      : <span className="opacity-30">⠿</span>
                    }
                  </td>
                )}

                <td className="px-2 py-2 text-center">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${
                    tiedUnresolved
                      ? 'bg-amber-400 text-amber-900'
                      : i === 2
                        ? (isThirdAdv ? 'bg-amber-400 text-amber-900' : 'bg-gray-200 text-gray-600')
                        : POS_COLORS[i]
                  }`}>
                    {tiedUnresolved ? '?' : i + 1}
                  </span>
                </td>

                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <Flag code={team.flag} size="sm" />
                    <span className={`font-medium ${i < 2 ? 'text-gray-900' : 'text-gray-600'}`}>
                      {team.team}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 text-center">
                  <span className={`font-black ${i < 2 || isThirdAdv ? 'text-gray-900' : 'text-gray-500'}`}>
                    {team.pts}
                  </span>
                </td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gp}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.w}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.d}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.l}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.gf}</td>
                <td className="px-1 py-2 text-center text-gray-500">{team.ga}</td>
                <td className={`px-1 py-2 text-center font-medium ${team.gd > 0 ? 'text-verde-600' : team.gd < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  {team.gd > 0 ? `+${team.gd}` : team.gd}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 bg-gray-50 px-3 py-2">
        <LegendItem color="bg-verde-600"   label="Classificado (1º)" />
        <LegendItem color="bg-azul-escuro" label="Classificado (2º)" />
        {thirdAdv && <LegendItem color="bg-amber-400" label="Melhor 3º" />}
      </div>
    </div>

    {/* Modal de confirmação de atualização do palpite formal */}
    {showModal && draftOrder && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-base font-bold text-gray-900">
            Atualizar palpite do Grupo {standing.group}?
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            Você já tem um palpite de classificados preenchido:
          </p>
          <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-verde-600 text-[10px] font-black text-white">1</span>
              <span className="font-medium text-gray-700">{formalBet!.first_place}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-azul-escuro text-[10px] font-black text-white">2</span>
              <span className="font-medium text-gray-700">{formalBet!.second_place}</span>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Deseja substituir pelo nova ordem?
          </p>
          <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-verde-600 text-[10px] font-black text-white">1</span>
              <span className="font-medium text-gray-700">{draftOrder[0]}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-azul-escuro text-[10px] font-black text-white">2</span>
              <span className="font-medium text-gray-700">{draftOrder[1]}</span>
            </div>
          </div>

          {confirmError && (
            <p className="mt-2 text-xs text-red-600">{confirmError}</p>
          )}

          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={handleConfirmNo}
              disabled={confirmPending}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Manter palpite atual
            </button>
            <button
              onClick={handleConfirmYes}
              disabled={confirmPending}
              className="rounded-lg bg-azul-escuro px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {confirmPending ? 'Salvando…' : 'Atualizar palpite'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}
