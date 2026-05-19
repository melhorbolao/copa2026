import { createAuthAdminClient } from '@/lib/supabase/server'
import { ParticipantsClient } from './ParticipantsClient'
import { getPagantesNote } from './actions'

export default async function AdminParticipantesPage() {
  const supabase = createAuthAdminClient()

  const [{ data: rawParticipants }, { data: approvedUsers }, pagantesNote] = await Promise.all([
    supabase
      .from('participants')
      .select('id, apelido, bio, paid, created_at, user_participants(user_id, is_primary, users(id, name, email))')
      .order('apelido'),
    supabase
      .from('users')
      .select('id, name, apelido, whatsapp, padrinho')
      .eq('status', 'aprovado')
      .order('name'),
    getPagantesNote(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participants = (rawParticipants ?? []) as any[]
  const users        = (approvedUsers ?? []) as { id: string; name: string; apelido: string | null; whatsapp: string | null; padrinho: string | null }[]

  return <ParticipantsClient participants={participants} users={users} pagantesNote={pagantesNote} />
}
