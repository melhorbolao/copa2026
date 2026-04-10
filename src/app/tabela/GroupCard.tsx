'use client'

import { useState, useRef, useTransition } from 'react'
import { Flag } from '@/components/ui/Flag'
import { updateGroupBetFromReorder, getGroupBets } from './actions'
import type { CalcGroupStanding, TeamRow } from '@/lib/bracket/engine'

interface Props {
  standing:          CalcGroupStanding
  advancingGroups:   Set<string>
  userId:            string
  /** Times em empate real segundo critérios FIFA (antes de qualquer override) */
  originalTiedTeams: string[]
  /** Palpite formal de 1º/2º já salvo pelo usuário (null se não preenchido) */
  formalBet:         { first_place: string; second_place: string } | null
  /** Palpite de terceiro classificado deste grupo (null se não apostou) */
  thirdPlaceBet:     { team: string } | null
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
  thirdPlaceBet,
  manualOrder,
  onOrderChange,
  onOrderReset,
}: Props) {
  const storageKey = `tie_order_${userId}_${standing.group}`

  const hasTie = originalTiedTeams.length > 0

  const [draftOrder,     setDraftOrder]     = useState<string[] | null>(null)
  const [dragOver,       setDragOver]       = useState<number | null>(null)
  const [showModal,      setShowModal]      = useState(false)
  const [confirmPending, startConfirm]      = useTransition()
  const [checkPending,   startCheck]        = useTransition()
  const [confirmError,   setConfirmError]   = useState('')
  const [saveSuccess,    setSaveSuccess]    = useState(false)

  // Estado local dos palpites — atualiza após "Atualizar palpites" sem precisar recarregar
  const [localFormalBet,    setLocalFormalBet]    = useState(formalBet)
  const [localThirdPlaceBet, setLocalThirdPlaceBet] = useState(thirdPlaceBet)

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

  // ── Detecção de conflitos ─────────────────────────────────────
  const newFirst  = draftOrder?.[0] ?? ''
  const newSecond = draftOrder?.[1] ?? ''
  const newThird  = draftOrder?.[2] ?? ''

  const groupBetConflict = !!draftOrder && !!localFormalBet && (
    localFormalBet.first_place !== newFirst || localFormalBet.second_place !== newSecond
  )
  const thirdBetConflict = !!draftOrder && !!localThirdPlaceBet && localThirdPlaceBet.team !== newThird

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

  // ── Commit: aplica a ordem no estado/localStorage sem tocar no banco ──
  const doCommit = (order: string[]) => {
    onOrderChange(order)
    try { localStorage.setItem(storageKey, JSON.stringify(order)) } catch { /* ignore */ }
    setDraftOrder(null)
  }

  // ── Salvar: busca palpites frescos do servidor antes de checar conflito ──
  const handleSaveClick = () => {
    if (!draftOrder) return
    const capturedDraft = draftOrder
    startCheck(async () => {
      const { groupBet, thirdBet } = await getGroupBets(standing.group)
      // Atualiza estado local com dados frescos
      setLocalFormalBet(groupBet)
      setLocalThirdPlaceBet(thirdBet)

      const first  = capturedDraft[0] ?? ''
      const second = capturedDraft[1] ?? ''
      const third  = capturedDraft[2] ?? ''

      const grpConflict  = !!groupBet && (groupBet.first_place !== first || groupBet.second_place !== second)
      const thrdConflict = !!thirdBet  && thirdBet.team !== third

      if (!grpConflict && !thrdConflict) {
        doCommit(capturedDraft)
        return
      }
      setConfirmError('')
      setShowModal(true)
    })
  }

  // ── Modal: Manter palpites ─────────────────────────────────────
  // Salva o desempate localmente; não altera palpites no banco.
  const handleKeepBets = () => {
    if (draftOrder) doCommit(draftOrder)
    setShowModal(false)
  }

  // ── Modal: Atualizar palpites ──────────────────────────────────
  // Salva o desempate localmente E corrige os palpites conflitantes no banco.
  const handleUpdateBets = () => {
    if (!draftOrder) return
    const capturedDraft   = draftOrder
    const capturedFirst   = newFirst
    const capturedSecond  = newSecond
    const capturedThird   = newThird
    const capturedGrpConf = groupBetConflict
    const capturedThrdConf= thirdBetConflict
    setConfirmError('')
    startConfirm(async () => {
      try {
        await updateGroupBetFromReorder(
          standing.group,
          capturedGrpConf  ? { firstPlace: capturedFirst, secondPlace: capturedSecond } : null,
          capturedThrdConf ? { team: capturedThird } : null,
        )
        // Atualiza estado local para refletir os novos palpites sem recarregar
        if (capturedGrpConf) {
          setLocalFormalBet({ first_place: capturedFirst, second_place: capturedSecond })
        }
        if (capturedThrdConf) {
          setLocalThirdPlaceBet({ team: capturedThird })
        }
        doCommit(capturedDraft)
        setShowModal(false)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      } catch (e) {
        setConfirmError(e instanceof Error ? e.message : 'Erro ao atualizar palpite')
      }
    })
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
              disabled={checkPending}
              className="rounded-full bg-verde-500 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-verde-600 disabled:opacity-60"
            >
              {checkPending ? '…' : '💾 Salvar ordem'}
            </button>
          </div>
        )}


        {isManuallyOrdered && !hasDraft && (
          <div className="ml-auto flex items-center gap-2">
            {saveSuccess && (
              <span className="text-[10px] font-semibold text-green-300">✓ Palpites atualizados</span>
            )}
            <button
              onClick={resetOrder}
              className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/30"
            >
              ↺ Resetar ordem
            </button>
          </div>
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

    {/* Modal de conflito de palpites */}
    {showModal && draftOrder && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-base font-bold text-gray-900">
            Conflito nos palpites — Grupo {standing.group}
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            A nova classificação difere dos seus palpites:
          </p>

          {groupBetConflict && localFormalBet && (
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm space-y-1">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Classificados do grupo</p>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-verde-600 text-[10px] font-black text-white">1</span>
                <span className="text-gray-500 line-through">{localFormalBet.first_place}</span>
                <span className="text-gray-400">→</span>
                <span className="font-semibold text-gray-800">{newFirst}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-azul-escuro text-[10px] font-black text-white">2</span>
                <span className="text-gray-500 line-through">{localFormalBet.second_place}</span>
                <span className="text-gray-400">→</span>
                <span className="font-semibold text-gray-800">{newSecond}</span>
              </div>
            </div>
          )}

          {thirdBetConflict && localThirdPlaceBet && (
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm space-y-1">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">3º classificado</p>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 line-through">{localThirdPlaceBet.team}</span>
                <span className="text-gray-400">→</span>
                <span className="font-semibold text-gray-800">{newThird}</span>
              </div>
            </div>
          )}

          {confirmError && (
            <p className="mt-3 text-xs text-red-600">{confirmError}</p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={handleUpdateBets}
              disabled={confirmPending}
              className="w-full rounded-lg bg-azul-escuro px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {confirmPending ? 'Salvando…' : 'Atualizar palpites conflitantes'}
            </button>
            <button
              onClick={handleKeepBets}
              disabled={confirmPending}
              className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Manter palpites atuais
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
