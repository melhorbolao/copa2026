'use client'

import { useTransition, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { toggleParticipantPaid, deleteParticipant, updateParticipantApelido, updateParticipantBio } from './actions'
import { PalpitesModal } from '../usuarios/PalpitesModal'

interface LinkedUser {
  user_id: string
  is_primary: boolean
  users: { id: string; name: string; email: string } | null
}

interface ParticipantRowProps {
  participant: {
    id: string
    apelido: string
    bio: string | null
    paid: boolean
    created_at: string
    user_participants: LinkedUser[]
  }
  index: number
}

export function ParticipantRow({ participant, index }: ParticipantRowProps) {
  const router = useRouter()

  const [pendingPaid,    startPaid]    = useTransition()
  const [pendingDelete,  startDelete]  = useTransition()
  const [pendingApelido, startApelido] = useTransition()
  const [pendingBio,     startBio]     = useTransition()

  const [confirming,     setConfirming]     = useState(false)
  const [editingApelido, setEditingApelido] = useState(false)
  const [editingBio,     setEditingBio]     = useState(false)

  const apelidoRef = useRef<HTMLInputElement>(null)
  const bioRef     = useRef<HTMLInputElement>(null)
  const apelidoLatest = useRef(participant.apelido)
  const bioLatest     = useRef(participant.bio ?? '')

  const primaryLink = participant.user_participants.find(up => up.is_primary)
  const primaryUser = primaryLink?.users
  const allUsers    = participant.user_participants.map(up => up.users).filter(Boolean)

  const handleTogglePaid = () => {
    startPaid(() => {
      void toggleParticipantPaid(participant.id, participant.paid)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao alterar pagamento'))
    })
  }

  const handleDelete = () => {
    startDelete(() => {
      void deleteParticipant(participant.id)
        .then(() => router.refresh())
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Erro ao excluir'))
    })
  }

  const handleApelidoSave = () => {
    setEditingApelido(false)
    const val = apelidoLatest.current.trim()
    if (!val || val === participant.apelido) return
    startApelido(() => {
      void updateParticipantApelido(participant.id, val)
        .then(() => router.refresh())
        .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Erro ao salvar nome'))
    })
  }

  const handleBioSave = () => {
    setEditingBio(false)
    const val = bioLatest.current
    if (val === (participant.bio ?? '')) return
    startBio(() => {
      void updateParticipantBio(participant.id, val)
        .then(() => router.refresh())
        .catch(() => toast.error('Erro ao salvar bio'))
    })
  }

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50 text-sm">
      <td className="px-3 py-2.5 text-gray-400 text-xs">{index + 1}</td>

      {/* Nome do usuário principal */}
      <td className="px-3 py-2.5">
        {primaryUser ? (
          <>
            <p className="font-medium text-gray-900 whitespace-nowrap">{primaryUser.name}</p>
            <p className="text-xs text-gray-400">{primaryUser.email}</p>
          </>
        ) : (
          <span className="text-xs text-gray-300 italic">sem usuário</span>
        )}
      </td>

      {/* Nome no Bolão — editável inline */}
      <td className="px-3 py-2.5 min-w-[130px]">
        {editingApelido ? (
          <input
            ref={apelidoRef}
            defaultValue={participant.apelido}
            onChange={e => { apelidoLatest.current = e.target.value }}
            onBlur={handleApelidoSave}
            onKeyDown={e => {
              if (e.key === 'Enter') apelidoRef.current?.blur()
              if (e.key === 'Escape') { apelidoLatest.current = participant.apelido; setEditingApelido(false) }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => { apelidoLatest.current = participant.apelido; setEditingApelido(true) }}
            title="Clique para editar"
            className={`w-full text-left text-xs font-medium rounded px-1.5 py-1 hover:bg-gray-100 transition ${pendingApelido ? 'opacity-50' : 'text-gray-800'}`}
          >
            {participant.apelido}
          </button>
        )}
      </td>

      {/* Bio — editável inline */}
      <td className="px-3 py-2.5 min-w-[130px]">
        {editingBio ? (
          <input
            ref={bioRef}
            defaultValue={participant.bio ?? ''}
            onChange={e => { bioLatest.current = e.target.value }}
            onBlur={handleBioSave}
            onKeyDown={e => {
              if (e.key === 'Enter') bioRef.current?.blur()
              if (e.key === 'Escape') { bioLatest.current = participant.bio ?? ''; setEditingBio(false) }
            }}
            autoFocus
            className="w-full rounded border border-verde-300 px-1.5 py-1 text-xs focus:outline-none"
          />
        ) : (
          <button
            onClick={() => { bioLatest.current = participant.bio ?? ''; setEditingBio(true) }}
            title="Clique para editar"
            className={`w-full text-left text-xs rounded px-1.5 py-1 hover:bg-gray-100 transition ${
              pendingBio ? 'opacity-50' : ''
            } ${participant.bio ? 'text-gray-600' : 'text-gray-300 italic'}`}
          >
            {participant.bio || 'adicionar…'}
          </button>
        )}
      </td>

      {/* Pagamento */}
      <td className="px-3 py-2.5">
        <button
          onClick={handleTogglePaid}
          disabled={pendingPaid}
          className={`inline-flex min-w-[80px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
            participant.paid
              ? 'bg-verde-100 text-verde-700 hover:bg-verde-200'
              : 'bg-red-100 text-red-700 hover:bg-red-200'
          }`}
        >
          {pendingPaid ? '…' : participant.paid ? '✓ Pago' : '✗ Pendente'}
        </button>
      </td>

      {/* Usuários com acesso */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          {allUsers.length === 0 && <span className="text-xs text-gray-300 italic">nenhum</span>}
          {allUsers.map((u, i) => (
            <span key={i} className="text-xs text-gray-600 whitespace-nowrap">
              {u!.name}
              {participant.user_participants[i]?.is_primary && (
                <span className="ml-1 text-[10px] text-verde-600 font-bold">★</span>
              )}
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
          <div className="flex items-center gap-1.5">
            {primaryUser && (
              <PalpitesModal userId={primaryUser.id} userName={participant.apelido} />
            )}
            <button
              onClick={() => setConfirming(true)}
              title="Excluir participante"
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

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}
