import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAdminsWithPermissions } from '../actions'
import { AcessosClient } from './AcessosClient'

export const metadata = { title: 'Controle de Acessos' }

export default async function AcessosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'master') redirect('/acesso-negado')

  const admins = await getAdminsWithPermissions()

  return <AcessosClient admins={admins} />
}
