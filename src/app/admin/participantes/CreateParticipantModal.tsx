'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createParticipant } from './actions'

interface User { id: string; name: string; apelido: string | null }

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-verde-400 focus:outline-none'

export function CreateParticipantModal({ users }: { users: User[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [userId,       setUserId]       = useState('')
  const [userQuery,    setUserQuery]    = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [apelido,      setApelido]      = useState('')
  const [bio,          setBio]          = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => { setUserId(''); setUserQuery(''); setApelido(''); setBio(''); setError(''); setSuccess(false); setShowDropdown(false) }
  const handleClose = () => { setOpen(false); reset() }

  const filteredUsers = userQuery.trim()
    ? users.filter(u =>
        u.name.toLowerCase().includes(userQuery.toLowerCase()) ||
        (u.apelido ?? '').toLowerCase().includes(userQuery.toLowerCase())
      )
    : users

  const selectUser = (u: User) => {
    setUserId(u.id)
    setUserQuery(u.name + (u.apelido ? ` (${u.apelido})` : ''))
    setShowDropdown(false)
    if (!apelido) setApelido(u.apelido || u.name)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!userId)         { setError('Selecione um usuário.'); return }
    if (!apelido.trim()) { setError('Nome no Bolão é obrigatório.'); return }

    start(async () => {
      const result = await createParticipant({ userId, apelido, bio })
      if (result.error) { setError(result.error); return }
      setSuccess(true)
      router.refresh()
      setTimeout(handleClose, 1200)
    })
  }

  const selectedUser = users.find(u => u.id === userId)


  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition"
        style={{ backgroundColor: '#009c3b' }}
      >
        + Criar Participante
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl bg-gray-900 px-5 py-3">
              <span className="text-sm font-black uppercase tracking-wide text-white">Criar Participante</span>
              <button onClick={handleClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
              <div className="relative">
                <label className="mb-1 block text-xs font-semibold text-gray-500">Usuário *</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={userQuery}
                  onChange={e => {
                    setUserQuery(e.target.value)
                    setUserId('')
                    setShowDropdown(true)
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  placeholder="Digite para filtrar usuários…"
                  autoComplete="off"
                  className={inputCls + (userId ? ' border-verde-400' : '')}
                />
                {showDropdown && filteredUsers.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm">
                    {filteredUsers.map(u => (
                      <li
                        key={u.id}
                        onMouseDown={() => selectUser(u)}
                        className="cursor-pointer px-3 py-2 hover:bg-verde-50 hover:text-verde-800"
                      >
                        {u.name}{u.apelido ? <span className="ml-1 text-gray-400">({u.apelido})</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {showDropdown && filteredUsers.length === 0 && userQuery.trim() && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400 shadow-lg">
                    Nenhum usuário encontrado.
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Nome no Bolão *</label>
                <input
                  type="text"
                  required
                  value={apelido}
                  onChange={e => setApelido(e.target.value)}
                  placeholder={selectedUser ? selectedUser.name : 'Como será chamado no bolão'}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Bio (opcional)</label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Descrição curta..."
                  rows={2}
                  className={`${inputCls} resize-none`}
                />
              </div>

              <p className="text-xs text-gray-400">
                O participante será vinculado ao usuário selecionado. Se ele já tiver um participante primário, este será um participante adicional.
              </p>

              {error   && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              {success && <p className="rounded-lg bg-verde-50 px-3 py-2 text-xs text-verde-700 font-semibold">✓ Participante criado!</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={pending}
                  className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#009c3b' }}
                >
                  {pending ? 'Criando…' : 'Criar'}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
