import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/palpites')
  }

  const { error } = await searchParams

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #009c3b 0%, #002776 100%)' }}
    >
      <div className="w-full max-w-sm">

        {/* Card de login */}
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          {/* Cabeçalho do card */}
          <div className="mb-6 flex items-center justify-center rounded-xl bg-azul-dark px-4 py-3">
            <img
              src="/logo_azul_amarelo_ret.png"
              alt="Melhor Bolão"
              className="h-12 w-auto"
            />
          </div>
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error === 'auth_error'
                ? 'Erro ao autenticar. Tente novamente.'
                : `Erro: ${error}`}
            </div>
          )}
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-white/85">
          Após o cadastro, aguarde aprovação do administrador para acessar os palpites.
        </p>
        <p className="mt-3 text-center text-xs text-white/60">
          <a href="/privacidade" className="text-white/60 underline hover:text-white">Política de Privacidade</a>
          {' · '}
          <a href="/termos" className="text-white/60 underline hover:text-white">Termos de Uso</a>
        </p>
      </div>
    </main>
  )
}
