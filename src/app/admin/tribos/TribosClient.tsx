'use client'

import { useState, useMemo, useTransition } from 'react'
import {
  createTribo, deleteTribo, saveTribeMembers, getTribeMemberIds,
  type Tribe, type Participant,
} from './actions'

interface Props {
  initialTribes: Tribe[]
  participants: Participant[]
}

export function TribosClient({ initialTribes, participants }: Props) {
  const [tribes, setTribes]         = useState<Tribe[]>(initialTribes)
  const [newName, setNewName]       = useState('')
  const [selectedId, setSelectedId] = useState<string>('')

  // Transfer list state
  const [memberIds, setMemberIds]   = useState<Set<string>>(new Set())
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [leftSearch, setLeftSearch] = useState('')
  const [rightSearch, setRightSearch] = useState('')
  const [leftSel, setLeftSel]       = useState<Set<string>>(new Set())
  const [rightSel, setRightSel]     = useState<Set<string>>(new Set())

  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback]     = useState<{ ok: boolean; msg: string } | null>(null)

  function showMsg(ok: boolean, msg: string) {
    setFeedback({ ok, msg })
    setTimeout(() => setFeedback(null), 3000)
  }

  // ── Criar Tribo ────────────────────────────────────────────────────────────
  function handleCreate() {
    if (!newName.trim()) return
    startTransition(async () => {
      const res = await createTribo(newName)
      if (res.error) { showMsg(false, res.error); return }
      // Refetch tribes list via reload (simplest approach)
      const newTribes: Tribe[] = [
        ...tribes,
        { id: crypto.randomUUID(), name: newName.trim(), created_at: new Date().toISOString() },
      ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      setTribes(newTribes)
      setNewName('')
      showMsg(true, 'Tribo criada com sucesso.')
    })
  }

  // ── Excluir Tribo ──────────────────────────────────────────────────────────
  function handleDelete(id: string) {
    if (!confirm('Excluir esta tribo e todas as associações?')) return
    startTransition(async () => {
      const res = await deleteTribo(id)
      if (res.error) { showMsg(false, res.error); return }
      setTribes(prev => prev.filter(t => t.id !== id))
      if (selectedId === id) {
        setSelectedId('')
        setMemberIds(new Set())
      }
      showMsg(true, 'Tribo excluída.')
    })
  }

  // ── Selecionar Tribo ───────────────────────────────────────────────────────
  async function handleSelectTribe(id: string) {
    setSelectedId(id)
    setLeftSel(new Set())
    setRightSel(new Set())
    setLeftSearch('')
    setRightSearch('')
    if (!id) { setMemberIds(new Set()); return }
    setLoadingMembers(true)
    const ids = await getTribeMemberIds(id)
    setMemberIds(new Set(ids))
    setLoadingMembers(false)
  }

  // ── Transfer List helpers ──────────────────────────────────────────────────
  const available = useMemo(
    () => participants.filter(p => !memberIds.has(p.id) &&
      p.apelido.toLowerCase().includes(leftSearch.toLowerCase())),
    [participants, memberIds, leftSearch],
  )
  const inTribe = useMemo(
    () => participants.filter(p => memberIds.has(p.id) &&
      p.apelido.toLowerCase().includes(rightSearch.toLowerCase())),
    [participants, memberIds, rightSearch],
  )

  function toggleLeft(id: string) {
    setLeftSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function toggleRight(id: string) {
    setRightSel(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  function moveToTribe() {
    setMemberIds(prev => new Set([...prev, ...leftSel]))
    setLeftSel(new Set())
  }
  function removeFromTribe() {
    setMemberIds(prev => { const s = new Set(prev); rightSel.forEach(id => s.delete(id)); return s })
    setRightSel(new Set())
  }

  // ── Salvar membros ─────────────────────────────────────────────────────────
  function handleSaveMembers() {
    if (!selectedId) return
    startTransition(async () => {
      const res = await saveTribeMembers(selectedId, [...memberIds])
      if (res.error) showMsg(false, res.error)
      else showMsg(true, 'Membros salvos com sucesso.')
    })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Tribos</h2>
        <p className="mt-1 text-sm text-gray-500">
          Crie grupos de participantes para destaque visual na Classificação Detalhada.
        </p>
      </div>

      {feedback && (
        <div className={`rounded-lg px-4 py-3 text-sm ${feedback.ok ? 'bg-verde-50 border border-verde-300 text-verde-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {feedback.msg}
        </div>
      )}

      {/* ── Seção A: Criar Tribo ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Criar Tribo</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Nome da Tribo (ex: Pessoal do Trabalho)"
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-verde-400 focus:outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={isPending || !newName.trim()}
            className="rounded-lg bg-verde-600 px-4 py-2 text-sm font-medium text-white hover:bg-verde-700 disabled:opacity-50 transition"
          >
            Criar Tribo
          </button>
        </div>

        {tribes.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {tribes.map(t => (
              <li key={t.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <span className="text-sm font-medium text-gray-800">{t.name}</span>
                <button
                  onClick={() => handleDelete(t.id)}
                  disabled={isPending}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition"
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Seção B: Gerenciador de Associação ──────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Gerenciar Membros</h3>

        <div className="mb-4 flex items-center gap-3">
          <select
            value={selectedId}
            onChange={e => handleSelectTribe(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-verde-400 focus:outline-none"
          >
            <option value="">Selecione uma Tribo…</option>
            {tribes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {selectedId && (
            <button
              onClick={handleSaveMembers}
              disabled={isPending}
              className="rounded-lg bg-azul-escuro px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition"
            >
              {isPending ? 'Salvando…' : 'Salvar Membros'}
            </button>
          )}
        </div>

        {!selectedId ? (
          <p className="text-sm text-gray-400">Selecione uma tribo para gerenciar os membros.</p>
        ) : loadingMembers ? (
          <p className="text-sm text-gray-400">Carregando membros…</p>
        ) : (
          <div className="flex gap-3">
            {/* Lista Esquerda: Disponíveis */}
            <div className="flex-1 min-w-0">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Disponíveis ({available.length})
                </span>
                {leftSel.size > 0 && (
                  <span className="text-xs text-gray-400">{leftSel.size} selecionado(s)</span>
                )}
              </div>
              <input
                type="text"
                value={leftSearch}
                onChange={e => setLeftSearch(e.target.value)}
                placeholder="Buscar…"
                className="mb-1.5 w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-verde-400 focus:outline-none"
              />
              <div className="h-72 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50">
                {available.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400 text-center">Nenhum participante disponível</p>
                ) : (
                  available.map(p => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-0 hover:bg-white transition ${leftSel.has(p.id) ? 'bg-verde-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={leftSel.has(p.id)}
                        onChange={() => toggleLeft(p.id)}
                        className="h-3.5 w-3.5 accent-verde-600"
                      />
                      <span className="truncate">{p.apelido}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {/* Botões centrais */}
            <div className="flex flex-col items-center justify-center gap-2 pt-8">
              <button
                onClick={moveToTribe}
                disabled={leftSel.size === 0}
                title="Adicionar à tribo"
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-600 hover:border-verde-400 hover:text-verde-600 disabled:opacity-30 transition"
              >
                →
              </button>
              <button
                onClick={removeFromTribe}
                disabled={rightSel.size === 0}
                title="Remover da tribo"
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm font-bold text-gray-600 hover:border-red-300 hover:text-red-500 disabled:opacity-30 transition"
              >
                ←
              </button>
            </div>

            {/* Lista Direita: Na Tribo */}
            <div className="flex-1 min-w-0">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Na Tribo ({inTribe.length})
                </span>
                {rightSel.size > 0 && (
                  <span className="text-xs text-gray-400">{rightSel.size} selecionado(s)</span>
                )}
              </div>
              <input
                type="text"
                value={rightSearch}
                onChange={e => setRightSearch(e.target.value)}
                placeholder="Buscar…"
                className="mb-1.5 w-full rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-verde-400 focus:outline-none"
              />
              <div className="h-72 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50">
                {inTribe.length === 0 ? (
                  <p className="p-3 text-xs text-gray-400 text-center">Nenhum participante na tribo</p>
                ) : (
                  inTribe.map(p => (
                    <label
                      key={p.id}
                      className={`flex cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-xs last:border-0 hover:bg-white transition ${rightSel.has(p.id) ? 'bg-red-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={rightSel.has(p.id)}
                        onChange={() => toggleRight(p.id)}
                        className="h-3.5 w-3.5 accent-red-500"
                      />
                      <span className="truncate">{p.apelido}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
