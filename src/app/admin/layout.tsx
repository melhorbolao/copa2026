import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'
import { AdminTabs } from './AdminTabs'
import type { UserRole } from '@/lib/permissions'

export const metadata = {}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()

  const role = (profile?.role ?? 'user') as UserRole
  if (role !== 'admin' && role !== 'master') redirect('/')

  // allowed_pages lidos do app_metadata (cacheado no JWT, zero queries extras)
  const allowedGroups = role === 'master'
    ? []
    : (authUser.app_metadata?.allowed_pages as string[] | undefined) ?? []

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">Painel Administrativo</h1>
        </div>

        <AdminTabs role={role} allowedGroups={allowedGroups} />

        {children}
      </div>
    </>
  )
}
