'use client'

import { useTransition, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { toggleApproved, deleteUser, updateObservacao, updateApelido, updatePadrinho, toggleAdmin } from '../actions'
import { formatBrasilia } from '@/utils/date'

type Status = 'email_pendente' | 'aprovacao_pendente' | 'aprovado'

interface LinkedParticipant {
  participant_id: string
  is_primary: boolean
  participants: { id: string; apelido: string } | null
}

interface UserRowProps {
  user: {
    id: string
    name: string
    email: string
    whatsapp: string | null
    padrinho: string | null
    apelido: string | null
    observacao: string | null
    provider: string
    approved: boolean
    paid: boolean
    status: Status
    is_manual: boolean
    is_admin: boolean
    created_at: string
    user_participants: LinkedParticipant[]
  }
  index: number
}

export function UserRow({ user, index }: UserRowProps) {
  const router = useRouter()

  const [pendingApproved, startApproved] = useTransition()
  const [pendingDelete,   startDelete]   = useTransition()
  const [pendingObs,      startObs]      = useTransition()
  const [pendingApelido,  startApelido]  = useTransition()
  const [pendingPadrinho, startPadrinho] = useTransition()
  const [pendingAdmin,    startAdmin]    = useTransition()

  const [confirming,     setConfirming]     = useState(false)
  const [editingObs,     setEditingObs]     = useState(false)
  const [editingApelido, setEditingApelido] = useState(false)

  const obsRef     = useRef<HTMLInputElement>(null)
  const apelidoRef = useRef<HTMLInputElement>(null)

  const obsLatest     = useRef(user.observacao ?? '')
  const apelidoLatest = useRef(user.apelido ?? '')

  const [padrinhoValue, setPadrinhoValue] = useState(user.padrinho ?? '')
  const canApprove = !!padrinhoValue

  const handleObsSave = () => {
    setEditingObs(false)
    const val = obsLatest.current
    if (val === (user.observacao ?? '')) return
    startObs(() => {
      void updateObservacao(user.id, val)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao salvar observação'))
    })
  }

  const handleApelidoSave = () => {
    setEditingApelido(false)
    const val = apelidoLatest.current
    if (val === (user.apelido ?? '')) return
    startApelido(() => {
      void updateApelido(user.id, val)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao salvar nome no bolão'))
    })
  }

  const handlePadrinhoChange = (val: string) => {
    setPadrinhoValue(val)
    if (val === (user.padrinho ?? '')) return
    startPadrinho(() => {
      void updatePadrinho(user.id, val)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao salvar padrinho'))
    })
  }

  const handleToggleApproved = () => {
    startApproved(() => {
      void toggleApproved(user.id, user.approved)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao alterar aprovação'))
    })
  }

  const handleDelete = () => {
    startDelete(() => {
      void deleteUser(user.id)
        .then(() => router.refresh())
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Erro ao excluir usuário'))
    })
  }

  const handleToggleAdmin = () => {
    startAdmin(() => {
      void toggleAdmin(user.id, user.is_admin)
        .then(() => router.refresh())
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Erro ao alterar admin'))
    })
  }

  const isMaster = user.email === 'gmousinho@gmail.com'

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 text-sm">
      <td className="px-3 py-2.5 text-gray-400 text-xs">{index + 1}</td>

      {/* Nome */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <p className="font-medium text-gray-900 whitespace-nowrap">
            {user.name}
            {user.is_manual && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-xs text-gray-500">manual</span>}
            {user.is_admin  && <span className="ml-1.5 rounded bg-purple-100 px-1 py-0.5 text-xs text-purple-600">admin</span>}
          </p>
        </div>
      </td>

      {/* WhatsApp */}
      <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
        {user.whatsapp ? (
          <a
            href={whatsappLink(user.whatsapp)}
            target="_blank" rel="noopener noreferrer"
            className="text-[#25D366] hover:underline"
          >
            {user.whatsapp}
          </a>
        ) : <span className="text-gray-300">—</span>}
      </td>

      {/* E-mail */}
      <td className="px-3 py-2.5 text-xs text-gray-600">{user.email}</td>

      {/* Login */}
      <td className="hidden px-3 py-2.5 sm:table-cell">
        <ProviderBadge provider={user.provider} />
      </td>

      {/* Cadastro */}
      <td className="hidden px-3 py-2.5 text-xs text-gray-500 lg:table-cell whitespace-nowrap">
        {formatBrasilia(user.created_at, 'dd/MM/yy HH:mm')}
      </td>

      {/* Padrinho */}
      <td className="px-3 py-2.5">
        <select
          value={padrinhoValue}
          onChange={e => handlePadrinhoChange(e.target.value)}
          disabled={pendingPadrinho}
          className={`rounded border py-0.5 px-1 text-xs focus:outline-none focus:border-verde-400 transition ${
            padrinhoValue ? 'border-gray-200 text-gray-700' : 'border-red-200 text-red-400'
          } disabled:opacity-50`}
        >
          <option value="">— sem padrinho —</option>
          {PADRINHOS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StatusBadge status={user.status} />
      </td>

      {/* Nome no Bolão — editável inline */}
      <td className="px-3 py-2.5 min-w-[110px]">
        {editingApelido ? (
          <input
            ref={apelidoRef}
            defaultValue={user.apelido ?? ''}
            onChange={e => { apelidoLatest.current = e.target.value }}
            onBlur={handleApelidoSave}
            onKeyDown={e => {
              if (e.key === 'Enter') apelidoRef.current?.blur()
              if (e.key === 'Escape') { apelidoLatest.current = user.apelido ?? ''; setEditingApelido(false) }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => { apelidoLatest.current = user.apelido ?? ''; setEditingApelido(true) }}
            title="Clique para editar"
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-gray-100 transition ${
              pendingApelido ? 'opacity-50' : ''
            } ${user.apelido ? 'text-gray-700' : 'text-gray-300 italic'}`}
          >
            {user.apelido || '(sem nome)'}
          </button>
        )}
      </td>

      {/* Obs — editável inline */}
      <td className="px-3 py-2.5 min-w-[120px]">
        {editingObs ? (
          <input
            ref={obsRef}
            defaultValue={user.observacao ?? ''}
            onChange={e => { obsLatest.current = e.target.value }}
            onBlur={handleObsSave}
            onKeyDown={e => {
              if (e.key === 'Enter') obsRef.current?.blur()
              if (e.key === 'Escape') { obsLatest.current = user.observacao ?? ''; setEditingObs(false) }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => { obsLatest.current = user.observacao ?? ''; setEditingObs(true) }}
            title="Clique para editar"
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-gray-100 transition ${
              pendingObs ? 'opacity-50' : ''
            } ${user.observacao ? 'text-gray-700' : 'text-gray-300 italic'}`}
          >
            {user.observacao || 'adicionar…'}
          </button>
        )}
      </td>

      {/* Participantes vinculados */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          {user.user_participants.length === 0 && (
            <span className="text-xs text-gray-300 italic">nenhum</span>
          )}
          {user.user_participants.map((up, i) => (
            <span key={i} className="text-xs text-gray-600 whitespace-nowrap">
              {up.participants?.apelido ?? '?'}
              {up.is_primary && <span className="ml-1 text-[10px] text-verde-600 font-bold">★</span>}
            </span>
          ))}
        </div>
      </td>

      {/* Ações */}
      <td className="px-3 py-2.5">
        {confirming ? (
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-red-600 whitespace-nowrap">Tem certeza?</span>
            <button
              onClick={handleDelete}
              disabled={pendingDelete}
              className="rounded px-2 py-1 text-xs font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pendingDelete ? '…' : 'Sim'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              Não
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            {user.status === 'aprovacao_pendente' && (
              <span title={!canApprove ? 'Selecione o padrinho primeiro' : undefined}>
                <button
                  onClick={() => canApprove && handleToggleApproved()}
                  disabled={pendingApproved || !canApprove}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                    canApprove
                      ? 'bg-verde-100 text-verde-700 hover:bg-verde-200 disabled:opacity-50'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {pendingApproved ? '…' : '✓ Aprovar'}
                </button>
              </span>
            )}
            {user.status === 'aprovado' && (
              <button
                onClick={handleToggleApproved}
                disabled={pendingApproved}
                className="rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-500 hover:bg-yellow-100 hover:text-yellow-700 disabled:opacity-50 transition whitespace-nowrap"
              >
                {pendingApproved ? '…' : 'Revogar'}
              </button>
            )}
            {!isMaster && (
              <button
                onClick={handleToggleAdmin}
                disabled={pendingAdmin}
                title={user.is_admin ? 'Remover admin' : 'Tornar admin'}
                className={`rounded p-1.5 transition disabled:opacity-50 ${
                  user.is_admin
                    ? 'bg-purple-100 text-purple-600 hover:bg-purple-200'
                    : 'text-gray-300 hover:bg-purple-50 hover:text-purple-400'
                }`}
              >
                <ShieldIcon />
              </button>
            )}
            <button
              onClick={() => setConfirming(true)}
              title="Excluir"
              className="rounded p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition"
            >
              <TrashIcon />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

const PADRINHOS = ['Bruninho','Cadu','Daniel','Guga','Luizinho','Medel','Nando "Sapo"','Teixeira']

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    email_pendente:     { label: '🟡 E-mail pendente',   cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    aprovacao_pendente: { label: '🟠 Aguard. aprovação', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    aprovado:           { label: '🟢 Aprovado',          cls: 'bg-verde-50 text-verde-700 border-verde-200'    },
  }
  const { label, cls } = map[status]
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const map: Record<string, string> = { google: 'Google', apple: 'Apple', email: 'E-mail', manual: 'Manual' }
  return (
    <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      {map[provider] ?? provider}
    </span>
  )
}

function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `https://wa.me/${digits.length <= 11 ? '55' + digits : digits}`
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
