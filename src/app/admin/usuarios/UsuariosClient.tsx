'use client'

import { useState, useMemo } from 'react'
import { UserRow } from './UserRow'

type StatusFilter = 'all' | 'aprovado' | 'aprovacao_pendente' | 'email_pendente'
type SortField    = 'num' | 'name'
type SortDir      = 'asc' | 'desc'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type User = any

interface Props { users: User[] }

const STATUS_OPTIONS: { value: StatusFilter; label: string; active: string; inactive: string }[] = [
  { value: 'all',               label: 'Todos',               active: 'bg-gray-800 text-white',        inactive: 'bg-gray-100 text-gray-600 hover:bg-gray-200' },
  { value: 'aprovado',          label: '🟢 Aprovado',         active: 'bg-verde-600 text-white',       inactive: 'bg-verde-50 text-verde-700 border border-verde-200 hover:bg-verde-100' },
  { value: 'aprovacao_pendente',label: '🟠 Aguard. aprovação',active: 'bg-orange-600 text-white',      inactive: 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100' },
  { value: 'email_pendente',    label: '🟡 E-mail pendente',  active: 'bg-yellow-500 text-white',      inactive: 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100' },
]

export function UsuariosClient({ users }: Props) {
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortField,    setSortField]    = useState<SortField>('num')
  const [sortDir,      setSortDir]      = useState<SortDir>('desc')

  // Número sequencial por ordem de criação (mais antigo = #1)
  const usersWithNum = useMemo(() => {
    const sorted = [...users].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
    return sorted.map((u, i) => ({ ...u, num: i + 1 }))
  }, [users])

  const counts = useMemo(() => ({
    all:               usersWithNum.length,
    aprovado:          usersWithNum.filter(u => u.status === 'aprovado').length,
    aprovacao_pendente:usersWithNum.filter(u => u.status === 'aprovacao_pendente').length,
    email_pendente:    usersWithNum.filter(u => u.status === 'email_pendente').length,
  }), [usersWithNum])

  const filtered = useMemo(() => {
    let result = usersWithNum

    if (statusFilter !== 'all')
      result = result.filter(u => u.status === statusFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.apelido ?? '').toLowerCase().includes(q)
      )
    }

    return [...result].sort((a, b) => {
      const cmp = sortField === 'num'
        ? a.num - b.num
        : a.name.localeCompare(b.name, 'pt-BR')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [usersWithNum, search, statusFilter, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'num' ? 'desc' : 'asc')
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="ml-0.5 text-gray-300 text-[10px]">↕</span>
    return <span className="ml-0.5 text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <>
      {/* Busca + Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Buscar nome, e-mail ou apelido…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-56 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-verde-400 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                statusFilter === opt.value ? opt.active : opt.inactive
              }`}
            >
              {opt.label}
              <span className="ml-1 opacity-70">({counts[opt.value]})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Nenhum usuário encontrado.</div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto max-h-[68vh] min-h-[200px]">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-3 hover:bg-gray-100 active:bg-gray-200"
                    onClick={() => toggleSort('num')}
                  >
                    #<SortIcon field="num" />
                  </th>
                  <th
                    className="cursor-pointer select-none whitespace-nowrap px-3 py-3 hover:bg-gray-100 active:bg-gray-200"
                    onClick={() => toggleSort('name')}
                  >
                    Nome<SortIcon field="name" />
                  </th>
                  <th className="px-3 py-3">WhatsApp</th>
                  <th className="px-3 py-3">E-mail</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Login</th>
                  <th className="hidden whitespace-nowrap px-3 py-3 lg:table-cell">Cadastro</th>
                  <th className="px-3 py-3">Padrinho</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="whitespace-nowrap px-3 py-3">Nome no Bolão</th>
                  <th className="px-3 py-3">Obs.</th>
                  <th className="px-3 py-3">Participantes</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(user => (
                  <UserRow
                    key={user.id}
                    user={user}
                    index={user.num - 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-2 text-right text-xs text-gray-400">
        {filtered.length !== usersWithNum.length
          ? `${filtered.length} de ${usersWithNum.length} usuários`
          : `${counts.aprovado}/${counts.all} aprovados`}
      </p>
    </>
  )
}
