import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canAccessPage, type UserRole } from '@/lib/permissions'
import { getTribos, getParticipantsForTribos } from './actions'
import { TribosClient } from './TribosClient'

export const metadata = { title: 'Tribos' }

export default async function TribosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  const role = (profile?.role ?? 'user') as UserRole

  const allowedGroups: string[] =
    role === 'master'
      ? []
      : (user.app_metadata?.allowed_pages as string[] | undefined) ?? []

  if (!canAccessPage(role, allowedGroups, 'tribos')) redirect('/acesso-negado')

  const [tribes, participants] = await Promise.all([
    getTribos(),
    getParticipantsForTribos(),
  ])

  return (
    <TribosClient
      initialTribes={tribes}
      participants={participants}
    />
  )
}
