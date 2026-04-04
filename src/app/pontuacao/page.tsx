import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'
import { ScoringTable } from './ScoringTable'

export const metadata = { title: 'Pontuação — Melhor Bolão' }

export default async function PontuacaoPage() {
  const supabase = await createClient()

  const [
    { data: { user } },
    { data: rules },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('scoring_rules').select('*'),
  ])

  let isAdmin = false
  if (user) {
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    isAdmin = profile?.is_admin ?? false
  }

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-black text-gray-900 mb-1">Pontuação</h1>
            <p className="text-sm text-gray-500">Tabela de referência — Melhor Bolão · Copa 2026</p>
          </div>
          {/* Badge renderizado dentro de ScoringTable (client) para respeitar viewMode */}
        </div>

        <ScoringTable rules={rules ?? []} isAdmin={isAdmin} />
      </div>
    </>
  )
}
