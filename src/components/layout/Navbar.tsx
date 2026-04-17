import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NavbarLinks } from './NavbarLinks'
import { ParticipantSelector } from './ParticipantSelector'
import { AlertBannerWrapper } from '@/components/AlertBannerWrapper'
import { getActiveParticipantId, getUserParticipants } from '@/lib/participant'
import { getPageVisibility } from '@/lib/page-visibility'

export async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile = null
  let participants: Awaited<ReturnType<typeof getUserParticipants>> = []
  let visibility = await getPageVisibility()

  if (user) {
    const [{ data }, activeId] = await Promise.all([
      supabase.from('users').select('name, is_admin').eq('id', user.id).single(),
      getActiveParticipantId(supabase, user.id).catch(() => null),
    ])
    profile = data
    if (activeId) {
      participants = await getUserParticipants(supabase, user.id, activeId).catch(() => [])
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-verde-600 shadow-sm sm:hidden">
      <AlertBannerWrapper />
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Link href="/">
            <img
              src="/logo.png"
              alt="Melhor Bolão"
              className="h-10 w-auto"
              style={{ mixBlendMode: 'screen' }}
            />
          </Link>
        </div>

        {/* Nav Links — client component com toggle de visão */}
        {user && (
          <NavbarLinks
            isAdmin={profile?.is_admin ?? false}
            visibility={visibility}
          />
        )}

        {/* Seletor de participante + Logout / Login */}
        <div className="flex items-center gap-2">
          {participants.length > 1 && (
            <ParticipantSelector participants={participants} />
          )}
          {user ? (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-white/30 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
              >
                Sair
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-amarelo-400 px-3 py-1.5 text-xs font-bold text-verde-900 transition hover:bg-amarelo-300"
            >
              Entrar
            </Link>
          )}
        </div>
      </nav>
    </header>
  )
}
