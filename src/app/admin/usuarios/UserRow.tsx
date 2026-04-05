'use client'

import { useTransition, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { toggleApproved, togglePaid, deleteUser, updateObservacao, updateApelido, updatePadrinho } from '../actions'
import { getDisplayName } from '@/utils/display'
import { formatBrasilia } from '@/utils/date'

type Status = 'email_pendente' | 'aprovacao_pendente' | 'aprovado'

interface UserRowProps {
  user: {
    id: string
    name: string
    email: string
    whatsapp: string | null
    padrinho: string | null
    apelido: string | null
    bio: string | null
    observacao: string | null
    provider: string
    approved: boolean
    paid: boolean
    status: Status
    is_manual: boolean
    created_at: string
  }
  index: number
}

export function UserRow({ user, index }: UserRowProps) {
  const router = useRouter()

  const [pendingApproved, startApproved] = useTransition()
  const [pendingPaid,     startPaid]     = useTransition()
  const [pendingDelete,   startDelete]   = useTransition()
  const [pendingObs,      startObs]      = useTransition()
  const [pendingApelido,  startApelido]  = useTransition()
  const [pendingPadrinho, startPadrinho] = useTransition()

  const [confirming,     setConfirming]     = useState(false)
  const [editingObs,     setEditingObs]     = useState(false)
  const [editingApelido, setEditingApelido] = useState(false)
  const [showBio,        setShowBio]        = useState(false)

  const [obsValue,      setObsValue]      = useState(user.observacao ?? '')      // eslint-disable-line @typescript-eslint/no-unused-vars
  const [apelidoValue,  setApelidoValue]  = useState(user.apelido ?? '')         // eslint-disable-line @typescript-eslint/no-unused-vars
  const [padrinhoValue, setPadrinhoValue] = useState(user.padrinho ?? '')

  const obsRef      = useRef<HTMLInputElement>(null)
  const apelidoRef  = useRef<HTMLInputElement>(null)

  // Refs para capturar o valor mais recente no onBlur (evita closure stale)
  const obsLatest     = useRef(user.observacao ?? '')
  const apelidoLatest = useRef(user.apelido ?? '')

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
        .catch(() => toast.error('Erro ao salvar apelido'))
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

  const handleToggleApproved = (current: boolean) => {
    startApproved(() => {
      void toggleApproved(user.id, current)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao alterar aprovação'))
    })
  }

  const handleTogglePaid = () => {
    startPaid(() => {
      void togglePaid(user.id, user.paid)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao alterar pagamento'))
    })
  }

  const handleDelete = () => {
    startDelete(() => {
      void deleteUser(user.id)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao excluir usuário'))
    })
  }

  return (
    <>
    <tr className={`border-b ${showBio ? '' : 'border-gray-100'} last:border-0 hover:bg-gray-50 text-sm`}>
      <td className="px-3 py-2.5 text-gray-400 text-xs">{index + 1}</td>

      {/* Nome / e-mail */}
      <td className="px-3 py-2.5">
        <p className="font-medium text-gray-900 whitespace-nowrap">
          {getDisplayName(user)}
          {user.is_manual && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-xs text-gray-500">manual</span>}
        </p>
        <p className="text-xs text-gray-500">{user.email}</p>
        {user.apelido && <p className="text-xs text-gray-400">{user.name}</p>}
      </td>

      {/* WhatsApp */}
      <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
        {user.whatsapp ?? <span className="text-gray-300">—</span>}
      </td>

      {/* Padrinho — select inline */}
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

      {/* Provider */}
      <td className="hidden px-3 py-2.5 sm:table-cell">
        <ProviderBadge provider={user.provider} />
      </td>

      {/* Cadastro */}
      <td className="hidden px-3 py-2.5 text-xs text-gray-500 lg:table-cell whitespace-nowrap">
        {formatBrasilia(user.created_at, 'dd/MM/yy HH:mm')}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StatusBadge status={user.status} />
      </td>

      {/* Pago */}
      <td className="px-3 py-2.5">
        <button
          onClick={handleTogglePaid}
          disabled={pendingPaid}
          className={`inline-flex min-w-[72px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            user.paid
              ? 'bg-verde-100 text-verde-700 hover:bg-verde-200'
              : 'bg-red-100 text-red-700 hover:bg-red-200'
          }`}
        >
          {pendingPaid ? '…' : user.paid ? '✓ Pago' : '✗ Não pago'}
        </button>
      </td>

      {/* Apelido inline */}
      <td className="px-3 py-2.5 min-w-[110px]">
        {editingApelido ? (
          <input
            ref={apelidoRef}
            defaultValue={apelidoValue}
            onChange={e => { apelidoLatest.current = e.target.value }}
            onBlur={handleApelidoSave}
            onKeyDown={e => {
              if (e.key === 'Enter') apelidoRef.current?.blur()
              if (e.key === 'Escape') {
                apelidoLatest.current = user.apelido ?? ''
                setEditingApelido(false)
              }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => {
              apelidoLatest.current = apelidoValue
              setEditingApelido(true)
            }}
            title="Clique para editar"
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-gray-100 transition ${
              pendingApelido ? 'opacity-50' : ''
            } ${apelidoValue ? 'text-gray-700' : 'text-gray-300 italic'}`}
          >
            {apelidoValue || '(sem apelido)'}
          </button>
        )}
      </td>

      {/* Observação inline */}
      <td className="px-3 py-2.5 min-w-[120px]">
        {editingObs ? (
          <input
            ref={obsRef}
            defaultValue={obsValue}
            onChange={e => { obsLatest.current = e.target.value }}
            onBlur={handleObsSave}
            onKeyDown={e => {
              if (e.key === 'Enter') obsRef.current?.blur()
              if (e.key === 'Escape') {
                obsLatest.current = user.observacao ?? ''
                setEditingObs(false)
              }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => {
              obsLatest.current = obsValue
              setEditingObs(true)
            }}
            title="Clique para editar"
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-gray-100 transition ${
              pendingObs ? 'opacity-50' : ''
            } ${obsValue ? 'text-gray-700' : 'text-gray-300 italic'}`}
          >
            {obsValue || 'adicionar…'}
          </button>
        )}
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
              disabled={pendingDelete}
              className="rounded px-2 py-1 text-xs font-bold bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              Não
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {user.status === 'aprovacao_pendente' && (
              <span title={!canApprove ? 'Usuário não informou o padrinho' : undefined}>
                <button
                  onClick={() => canApprove && handleToggleApproved(user.approved)}
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
                onClick={() => handleToggleApproved(user.approved)}
                disabled={pendingApproved}
                className="rounded-full px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-500 hover:bg-yellow-100 hover:text-yellow-700 disabled:opacity-50 transition whitespace-nowrap"
              >
                {pendingApproved ? '…' : 'Revogar'}
              </button>
            )}
            {user.bio && (
              <button
                onClick={() => setShowBio(v => !v)}
                title={showBio ? 'Ocultar apresentação' : 'Ver apresentação para resenha'}
                className={`rounded p-1.5 transition ${showBio ? 'bg-amber-100 text-amber-600' : 'text-gray-300 hover:bg-amber-50 hover:text-amber-500'}`}
              >
                📝
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
    {showBio && user.bio && (
      <tr className="border-b border-gray-100">
        <td colSpan={11} className="px-4 py-3 bg-amber-50">
          <p className="text-xs font-semibold text-amber-700 mb-1">📝 Apresentação para resenha — {getDisplayName(user)}</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{user.bio}</p>
        </td>
      </tr>
    )}
    </>
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
  const map: Record<string, string> = { google: 'Google', apple: 'Apple', facebook: 'Facebook', email: 'E-mail', manual: 'Manual' }
  return (
    <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      {map[provider] ?? provider}
    </span>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
