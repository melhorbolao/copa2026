import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { Navbar } from '@/components/layout/Navbar'
import { ACopaClient } from './ACopaClient'

export const metadata = { title: 'A Copa · Melhor Bolão' }

export default async function ACopaPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // participantId é usado para saber se pode editar; admins também podem
  const participantId = await getActiveParticipantId(supabase, user.id).catch(() => null)
  if (!participantId) redirect('/aguardando-aprovacao')

  const [{ data: rawMatches }, { data: profile }] = await Promise.all([
    supabase
      .from('matches')
      .select('*')
      .order('match_datetime', { ascending: true }),
    supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (rawMatches ?? []) as any[]
  const isAdmin = profile?.is_admin ?? false

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-black text-gray-900 mb-1">🌍 A Copa</h1>
          <p className="text-sm text-gray-500">
            Resultados oficiais · Copa do Mundo 2026 · Comum a todos os participantes
          </p>
          <p className="mt-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
            Qualquer participante pode registrar o placar de um jogo durante as <strong>4 horas</strong> após o início da partida.
            Fora desse intervalo, apenas administradores podem corrigir.
          </p>
        </div>

        <ACopaClient initialMatches={matches} isAdmin={isAdmin} />
      </div>
    </>
  )
}
