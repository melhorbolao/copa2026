import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CompletarPerfilForm } from './CompletarPerfilForm'

export const metadata = { title: 'Complete seu perfil — Melhor Bolão' }

export default async function CompletarPerfilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('name, whatsapp, padrinho')
    .eq('id', user.id)
    .single()

  // Já tem perfil completo → redireciona
  if (profile?.whatsapp && profile?.padrinho) redirect('/palpites')

  const initialName = profile?.name
    ?? user.user_metadata?.full_name
    ?? user.user_metadata?.name
    ?? ''

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #009c3b 0%, #002776 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 text-5xl">⚽</div>
          <h1 className="text-2xl font-black text-white">Complete seu perfil</h1>
          <p className="mt-1 text-sm text-white/75">
            Precisamos de mais algumas informações
          </p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <CompletarPerfilForm initialName={initialName} />
        </div>
      </div>
    </main>
  )
}
