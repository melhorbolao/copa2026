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
      supabase.from('users').select('name, is_admin, role').eq('id', user.id).single(),
      getActiveParticipantId(supabase, user.id).catch(() => null),
    ])
    profile = data
    if (activeId) {
      participants = await getUserParticipants(supabase, user.id, activeId).catch(() => [])
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-ouro/20 bg-azul-dark shadow-sm sm:hidden">
      <AlertBannerWrapper />
      <nav className="relative mx-auto flex h-14 max-w-6xl items-center px-4">
        {/* Logo — centralizada absolutamente */}
        <div className="absolute left-1/2 -translate-x-1/2">
          <Link href="/">
            <img
              src="/logo_azul_amarelo_ret.png"
              alt="Melhor Bolão"
              className="h-9 w-auto"
            />
          </Link>
        </div>

        {/* Esquerda: hambúrguer */}
        <div className="flex flex-1 items-center">
          {user && (
            <NavbarLinks
              isAdmin={profile?.is_admin ?? false}
              isMaster={profile?.role === 'master'}
              visibility={visibility}
            />
          )}
        </div>

        {/* Direita: seletor + logout/login */}
        <div className="flex flex-1 items-center justify-end gap-2">
          {participants.length > 1 && (
            <ParticipantSelector participants={participants} />
          )}
          {user ? (
            <div className="flex flex-col items-end gap-0.5">
              {user.email && (
                <span className="max-w-[120px] truncate text-[9px] text-white/40" title={user.email}>
                  {user.email}
                </span>
              )}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="rounded-lg border border-ouro/40 px-3 py-1.5 text-xs font-medium text-ouro transition hover:bg-azul-mid"
                >
                  Sair
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-ouro px-3 py-1.5 text-xs font-bold text-azul-dark transition hover:bg-ouro/80"
            >
              Entrar
            </Link>
          )}
        </div>
      </nav>
    </header>
  )
}
