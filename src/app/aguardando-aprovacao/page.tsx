import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function AguardandoAprovacaoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users')
    .select('approved')
    .eq('id', user.id)
    .single()

  if (profile?.approved) redirect('/palpites')

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #009c3b 0%, #002776 100%)' }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <div className="mb-4 text-5xl">⏳</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">
            Cadastro em análise
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            Seu cadastro foi recebido! Aguarde a aprovação do administrador
            para acessar os palpites.
          </p>
          <div
            className="rounded-lg p-3 text-sm font-medium"
            style={{ backgroundColor: '#fef9c3', color: '#854d0e' }}
          >
            📧 Você receberá uma notificação quando for aprovado.
          </div>
        </div>
        <form action="/auth/signout" method="post" className="mt-4">
          <button
            type="submit"
            className="text-sm text-white underline"
            style={{ opacity: 0.7 }}
          >
            Sair e usar outra conta
          </button>
        </form>
      </div>
    </main>
  )
}
