import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NavbarLinks } from './NavbarLinks'
import { ParticipantSelector } from './ParticipantSelector'
import { AlertBannerWrapper } from '@/components/AlertBannerWrapper'
import { getActiveParticipantId, getUserParticipants } from '@/lib/participant'

export async function Navbar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile = null
  let participants: Awaited<ReturnType<typeof getUserParticipants>> = []

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

  // Prazo da Rodada 1 — abas extras só aparecem após ele vencer
  const { data: r1Match } = await supabase
    .from('matches')
    .select('betting_deadline')
    .eq('phase', 'group')
    .eq('round', 1)
    .order('betting_deadline', { ascending: true })
    .limit(1)
    .single()

  const firstDeadlinePassed = r1Match
    ? new Date() > new Date(r1Match.betting_deadline)
    : false

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-verde-600 shadow-sm">
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
          <span className="hidden sm:block text-xs font-medium text-white/70 leading-tight">
            Copa do Mundo<br />EUA · Canadá · México<br />2026
          </span>
        </div>

        {/* Nav Links — client component com toggle de visão */}
        {user && (
          <NavbarLinks
            isAdmin={profile?.is_admin ?? false}
            firstDeadlinePassed={firstDeadlinePassed}
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
