'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { switchParticipant } from '@/app/actions/participant'

interface Participant {
  id: string
  apelido: string
  is_primary: boolean
  is_active: boolean
}

export function ParticipantSelector({ participants }: { participants: Participant[] }) {
  const [pending, start] = useTransition()
  const router = useRouter()

  if (participants.length <= 1) return null

  const active = participants.find(p => p.is_active)

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    start(async () => {
      await switchParticipant(id)
      router.refresh()
    })
  }

  return (
    <select
      value={active?.id ?? ''}
      onChange={handleChange}
      disabled={pending}
      className="rounded border border-white/30 bg-white/10 px-2 py-1 text-xs font-medium text-white focus:outline-none focus:ring-1 focus:ring-white/50 disabled:opacity-50 cursor-pointer"
      title="Trocar participante ativo"
    >
      {participants.map(p => (
        <option key={p.id} value={p.id} className="bg-verde-800 text-white">
          {p.apelido}
        </option>
      ))}
    </select>
  )
}
