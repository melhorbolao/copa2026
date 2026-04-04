import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'
import { AdminTabs } from './AdminTabs'

export const metadata = { title: 'Admin — Melhor Bolão' }

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/')

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Cabeçalho */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">Painel Administrativo</h1>
          <p className="mt-1 text-sm text-gray-500">
            Gerencie usuários, pagamentos e resultados das partidas.
          </p>
        </div>

        {/* Tabs de navegação */}
        <AdminTabs />

        {/* Conteúdo */}
        {children}
      </div>
    </>
  )
}
