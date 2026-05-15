'use client'

import { useTransition, useState, useEffect } from 'react'
import { saveGroupBet, deleteGroupBet } from './actions'
import { Flag } from '@/components/ui/Flag'
import { formatBrasilia, isDeadlinePassed } from '@/utils/date'
import { useThirdPlace } from './ThirdPlaceContext'

interface Team { team: string; flag: string }

const CONFLICT_TITLE = 'Alerta informativo: o palpite de classificado(s) está divergente da classificação decorrente dos palpites dos jogos. A regra do Melhor Bolão permite essa "incoerência".'

function ConflictDot() {
  return (
    <span
      title={CONFLICT_TITLE}
      className="ml-1 inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white"
    >!</span>
  )
}

interface Props {
  groupName: string
  teams: Team[]
  deadline: string
  existingBet: { first_place: string; second_place: string; points?: number | null } | null
  calculatedTop?: { first: string; second: string; third: string; tiedTeams: string[] }
  /** participantId — usado para ler a ordem manual salva no localStorage (mesma chave do GroupCard) */
  userId: string
}

export function GroupBetRow({ groupName, teams, deadline, existingBet, calculatedTop, userId }: Props) {
  const [pending, startTransition] = useTransition()
  const [first,  setFirst]  = useState(existingBet?.first_place  ?? '')
  const [second, setSecond] = useState(existingBet?.second_place ?? '')
  const [error,  setError]  = useState('')
  const [manualOrder, setManualOrder] = useState<string[] | null>(null)

  const { thirdSelections } = useThirdPlace()
  const thirdTeam = thirdSelections[groupName] ?? ''

  const deadlinePassed = isDeadlinePassed(deadline)

  // Chave do rascunho local — persiste o pick parcial (só 1º, ou ambos)
  // para recuperar caso o usuário navegue para outra tela antes do save.
  const draftKey = `gbet_${userId}_${groupName}`

  // Lê a ordem manual do localStorage (mesma chave usada pelo GroupCard em Minha Tabela)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`tie_order_${userId}_${groupName}`)
      if (stored) setManualOrder(JSON.parse(stored) as string[])
    } catch { /* ignore */ }
  }, [userId, groupName])

  // Sincroniza estado local com existingBet vindo do servidor (ex: revalidação)
  useEffect(() => {
    if (existingBet) { setFirst(existingBet.first_place); setSecond(existingBet.second_place) }
  }, [existingBet?.first_place, existingBet?.second_place])

  // Na montagem: se não há palpite salvo no servidor, tenta restaurar o
  // rascunho do localStorage e, se ambos os times estiverem presentes,
  // dispara o save automaticamente (cobre o caso de navegação antes do save).
  useEffect(() => {
    if (existingBet) return            // servidor já tem dados — não precisa do rascunho
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const { f, s } = JSON.parse(raw) as { f?: string; s?: string }
      if (f) setFirst(f)
      if (s) setSecond(s)
      if (f && s && f !== s) {
        // Ambos os times estavam no rascunho → salva no servidor agora
        startTransition(async () => {
          try {
            await saveGroupBet(groupName, f, s)
            localStorage.removeItem(draftKey)
          } catch { /* ignora — tentará novamente na próxima montagem */ }
        })
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])  // só na montagem

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Persiste o rascunho parcial no localStorage imediatamente. */
  const saveDraft = (f: string, s: string) => {
    try {
      if (f || s) localStorage.setItem(draftKey, JSON.stringify({ f, s }))
      else        localStorage.removeItem(draftKey)
    } catch { /* ignore */ }
  }

  /** Salva no servidor (requer os dois campos preenchidos e distintos). */
  const doSave = (f: string, s: string) => {
    if (!f || !s || f === s) return
    setError('')
    startTransition(async () => {
      try {
        await saveGroupBet(groupName, f, s)
        localStorage.removeItem(draftKey)          // rascunho cumprido
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro')
      }
    })
  }

  const doClear = (clearFirst: boolean) => {
    setError('')
    const otherValue = clearFirst ? second : first
    if (clearFirst) { setFirst('');  saveDraft('', second) }
    else            { setSecond(''); saveDraft(first, '') }
    startTransition(async () => {
      const r = await deleteGroupBet(groupName, clearFirst ? 'first' : 'second', otherValue)
      if (r.error) setError(r.error)
    })
  }

  const handleFirst = (val: string) => {
    // Se o usuário escolher o time que já está em 2º, faz o swap automaticamente
    // (isso é impedido pelo disabled da <option> sem este tratamento especial)
    const newFirst  = val
    const newSecond = val === second ? first : second   // troca se conflito
    setFirst(newFirst)
    setSecond(newSecond)
    saveDraft(newFirst, newSecond)
    if (newFirst && newSecond && newFirst !== newSecond) doSave(newFirst, newSecond)
  }

  const handleSecond = (val: string) => {
    // Se o usuário escolher o time que já está em 1º, faz o swap automaticamente
    const newSecond = val
    const newFirst  = val === first ? second : first    // troca se conflito
    setFirst(newFirst)
    setSecond(newSecond)
    saveDraft(newFirst, newSecond)
    if (newFirst && newSecond && newFirst !== newSecond) doSave(newFirst, newSecond)
  }

  // ── Conflitos ────────────────────────────────────────────────────────────────

  const calcFirst    = calculatedTop?.first  ?? ''
  const calcSecond   = calculatedTop?.second ?? ''
  const manualFirst  = manualOrder?.[0] ?? ''
  const manualSecond = manualOrder?.[1] ?? ''

  const firstConflict  = !!first  && (
    (!!calcFirst   && first  !== calcFirst)  ||
    (!!manualFirst && first  !== manualFirst)
  )
  const secondConflict = !!second && (
    (!!calcSecond   && second !== calcSecond) ||
    (!!manualSecond && second !== manualSecond)
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <tr className="border-b border-gray-100 bg-blue-50/30 hover:bg-blue-50/50">
      <td colSpan={7} className="px-2 py-2 sm:px-3">
        {/*
          Mobile (< sm): duas linhas — rótulo+bandeiras em cima, seletores embaixo.
          Desktop (sm+): uma linha — rótulo+times (flex-1) e seletores (shrink-0) à direita.
        */}
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">

          {/* Linha 1 / início desktop: rótulo + times */}
          <div className="flex min-w-0 items-center gap-2 sm:flex-1">
            <span className="w-8 shrink-0 text-xs font-bold text-gray-500">
              Gr. {groupName}
            </span>
            {/* Desktop: bandeira + nome */}
            <div className="hidden sm:flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              {teams.map(t => (
                <span key={t.team} className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-600">
                  <Flag code={t.flag} size="xs" className="shrink-0" />
                  <span>{t.team}</span>
                </span>
              ))}
            </div>
            {/* Mobile: só bandeiras */}
            <div className="flex sm:hidden min-w-0 flex-1 flex-wrap items-center gap-1">
              {teams.map(t => (
                <Flag key={t.team} code={t.flag} size="xs" className="shrink-0" title={t.team} />
              ))}
            </div>
          </div>

          {/* Linha 2 / fim desktop: seletores ou leitura */}
          {deadlinePassed ? (
            <div className="flex shrink-0 items-center gap-3">
              {existingBet ? (
                <>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥇 {existingBet.first_place}
                    {((!!calcFirst && existingBet.first_place !== calcFirst) || (!!manualFirst && existingBet.first_place !== manualFirst)) && <ConflictDot />}
                  </span>
                  <span className="inline-flex items-center text-xs font-semibold text-gray-700">
                    🥈 {existingBet.second_place}
                    {((!!calcSecond && existingBet.second_place !== calcSecond) || (!!manualSecond && existingBet.second_place !== manualSecond)) && <ConflictDot />}
                  </span>
                  <GroupPointsBadge points={existingBet.points} />
                </>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">

              {/* 1º lugar — native <select> (sem teclado virtual no mobile) */}
              <div className="flex flex-1 sm:w-36 sm:flex-none items-center gap-1">
                <select
                  value={first}
                  onChange={e => handleFirst(e.target.value)}
                  className="flex-1 min-w-0 rounded border border-gray-200 bg-white py-1.5 pl-1.5 pr-5 text-xs focus:border-verde-400 focus:outline-none"
                >
                  <option value="">1º lugar</option>
                  {teams.map(t => (
                    <option
                      key={t.team}
                      value={t.team}
                      // Não bloqueia o time do 2º (selecionar ele faz swap automático).
                      // Só bloqueia o time apostado como 3º colocado avançante —
                      // ele não pode ser simultaneamente 1º ou 2º do grupo.
                      disabled={!!thirdTeam && t.team === thirdTeam && t.team !== first && t.team !== second}
                    >
                      {t.team}
                    </option>
                  ))}
                </select>
                {firstConflict && <ConflictDot />}
                {first && (
                  <button
                    type="button"
                    onClick={() => doClear(true)}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* 2º lugar — native <select> */}
              <div className="flex flex-1 sm:w-36 sm:flex-none items-center gap-1">
                <select
                  value={second}
                  onChange={e => handleSecond(e.target.value)}
                  className="flex-1 min-w-0 rounded border border-gray-200 bg-white py-1.5 pl-1.5 pr-5 text-xs focus:border-verde-400 focus:outline-none"
                >
                  <option value="">2º lugar</option>
                  {teams.map(t => (
                    <option
                      key={t.team}
                      value={t.team}
                      // Não bloqueia o time do 1º (selecionar ele faz swap automático).
                      disabled={!!thirdTeam && t.team === thirdTeam && t.team !== first && t.team !== second}
                    >
                      {t.team}
                    </option>
                  ))}
                </select>
                {secondConflict && <ConflictDot />}
                {second && (
                  <button
                    type="button"
                    onClick={() => doClear(false)}
                    className="shrink-0 text-sm leading-none text-gray-300 hover:text-gray-500"
                    tabIndex={-1}
                    title="Limpar"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Status / pontos */}
              <div className="shrink-0 text-right">
                {pending
                  ? <span className="text-xs text-gray-400">…</span>
                  : existingBet?.points != null
                    ? <GroupPointsBadge points={existingBet.points} />
                    : null
                }
              </div>
            </div>
          )}

        </div>
        {error && <p className="mt-0.5 pl-10 text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  )
}

function GroupPointsBadge({ points }: { points: number | null | undefined }) {
  if (points === undefined) return null
  if (points === null) return <span className="text-xs text-gray-300">⌛</span>
  if (points > 0) return <span className="text-xs font-bold text-verde-600">+{points} pts</span>
  return <span className="text-xs text-gray-400">0 pts</span>
}
