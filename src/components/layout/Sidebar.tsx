import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SidebarLinks } from './SidebarLinks'
import { AdminModeToggle } from './AdminModeToggle'
import { ParticipantSelector } from './ParticipantSelector'
import { getActiveParticipantId, getUserParticipants } from '@/lib/participant'
import { getPageVisibility } from '@/lib/page-visibility'

export async function Sidebar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  let profile = null
  let participants: Awaited<ReturnType<typeof getUserParticipants>> = []

  const [[{ data }, activeId], visibility] = await Promise.all([
    Promise.all([
      supabase.from('users').select('name, is_admin').eq('id', user.id).single(),
      getActiveParticipantId(supabase, user.id).catch(() => null),
    ]),
    getPageVisibility(),
  ])
  profile = data
  if (activeId) {
    participants = await getUserParticipants(supabase, user.id, activeId).catch(() => [])
  }

  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-56 flex-col bg-azul-dark sm:flex">
      {/* Logo */}
      <div className="border-b border-white/10 px-4 py-5">
        <Link href="/" className="block">
          <img
            src="/logo_azul_amarelo_ret.png"
            alt="Melhor Bolão"
            className="mx-auto block h-auto w-4/5"
          />
        </Link>
      </div>

      {/* Links de navegação */}
      <nav className="flex-1 overflow-y-auto py-2">
        <SidebarLinks
          isAdmin={profile?.is_admin ?? false}
          visibility={visibility}
        />
      </nav>

      {/* Rodapé: seletor + sair */}
      <div className="border-t border-ouro/20 px-3 py-3">
        {participants.length > 1 && (
          <div className="mb-2">
            <ParticipantSelector participants={participants} />
          </div>
        )}
        {profile?.is_admin && <AdminModeToggle />}
        {user.email && (
          <p className="mb-1.5 truncate px-1 text-[10px] text-white/40" title={user.email}>
            {user.email}
          </p>
        )}
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full rounded-lg border border-white/30 px-3 py-1.5 text-left text-xs font-medium text-white transition hover:bg-white/10"
          >
            Sair
          </button>
        </form>
      </div>
    </aside>
  )
}
