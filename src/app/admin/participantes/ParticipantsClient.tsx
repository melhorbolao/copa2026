'use client'

import { useState } from 'react'
import { ParticipantRow } from './ParticipantRow'
import { CreateParticipantModal } from './CreateParticipantModal'
import { PagantesNote } from './PagantesNote'

type Filter = 'all' | 'paid' | 'pending'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Participant = any
type User = { id: string; name: string; apelido: string | null; whatsapp: string | null; padrinho: string | null }

interface Props {
  participants: Participant[]
  users: User[]
  pagantesNote: string
}

export function ParticipantsClient({ participants, users, pagantesNote }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const total    = participants.length
  const pagos    = participants.filter(p => p.paid).length
  const pendentes = total - pagos

  const visible = filter === 'paid'    ? participants.filter(p => p.paid)
                : filter === 'pending' ? participants.filter(p => !p.paid)
                : participants

  return (
    <div>
      {/* Cards-filtro */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FilterCard label="Participantes" value={total}    color="gray"   active={filter === 'all'}     onClick={() => setFilter(filter === 'all'     ? 'all' : 'all')}     onToggle={() => setFilter('all')}     />
        <FilterCard label="Pagos"         value={pagos}    color="verde"  active={filter === 'paid'}    onToggle={() => setFilter(filter === 'paid'    ? 'all' : 'paid')}    />
        <FilterCard label="Pendentes"     value={pendentes} color="orange" active={filter === 'pending'} onToggle={() => setFilter(filter === 'pending' ? 'all' : 'pending')} />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">
          {filter === 'all'
            ? <>Gerencie os participantes do bolão · ★ = usuário primário</>
            : <><span className="font-semibold">{visible.length}</span> de {total} participante{total !== 1 ? 's' : ''} · clique no card para remover filtro</>
          }
        </p>
        <div className="flex items-center gap-4">
          <PagantesNote initialText={pagantesNote} />
          <CreateParticipantModal users={users} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Nenhum participante encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Nome no Bolão</th>
                  <th className="px-3 py-3">Bio</th>
                  <th className="px-3 py-3">Pagamento</th>
                  <th className="px-3 py-3">Usuários com acesso</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <ParticipantRow key={p.id} participant={p} index={i} allUsers={users} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {pagos}/{total} pagos
      </p>
    </div>
  )
}

interface FilterCardProps {
  label: string
  value: number
  color: string
  active: boolean
  onToggle: () => void
  onClick?: () => void
}

function FilterCard({ label, value, color, active, onToggle }: FilterCardProps) {
  const base: Record<string, string> = {
    gray:   'border-gray-200   text-gray-700',
    verde:  'border-verde-200  text-verde-700',
    orange: 'border-orange-200 text-orange-700',
  }
  const bg: Record<string, string> = {
    gray:   active ? 'bg-gray-200'   : 'bg-gray-50   hover:bg-gray-100',
    verde:  active ? 'bg-verde-200'  : 'bg-verde-50  hover:bg-verde-100',
    orange: active ? 'bg-orange-200' : 'bg-orange-50 hover:bg-orange-100',
  }

  return (
    <button
      onClick={onToggle}
      className={`rounded-xl border p-4 text-center transition w-full ${base[color]} ${bg[color]} ${active ? 'ring-2 ring-offset-1 ' + ringColor(color) : ''}`}
    >
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
      {active && <p className="mt-1 text-[10px] opacity-60">filtro ativo · clique para remover</p>}
    </button>
  )
}

function ringColor(color: string) {
  if (color === 'verde')  return 'ring-verde-400'
  if (color === 'orange') return 'ring-orange-400'
  return 'ring-gray-400'
}
