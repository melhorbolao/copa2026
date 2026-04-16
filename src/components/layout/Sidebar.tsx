import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SidebarLinks } from './SidebarLinks'
import { ParticipantSelector } from './ParticipantSelector'
import { getActiveParticipantId, getUserParticipants } from '@/lib/participant'

export async function Sidebar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  let profile = null
  let participants: Awaited<ReturnType<typeof getUserParticipants>> = []

  const [{ data }, activeId] = await Promise.all([
    supabase.from('users').select('name, is_admin').eq('id', user.id).single(),
    getActiveParticipantId(supabase, user.id).catch(() => null),
  ])
  profile = data
  if (activeId) {
    participants = await getUserParticipants(supabase, user.id, activeId).catch(() => [])
  }

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
    <aside className="fixed left-0 top-0 hidden h-screen w-56 flex-col bg-verde-600 sm:flex">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
        <Link href="/">
          <img
            src="/logo.png"
            alt="Melhor Bolão"
            className="h-10 w-auto shrink-0"
            style={{ mixBlendMode: 'screen' }}
          />
        </Link>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold leading-tight text-white/70">
            Copa do Mundo
          </p>
          <p className="text-[10px] leading-tight text-white/50">
            EUA · Canadá · México
          </p>
          <p className="text-[10px] font-black leading-tight text-amarelo-300">
            2026
          </p>
        </div>
      </div>

      {/* Links de navegação */}
      <nav className="flex-1 overflow-y-auto py-2">
        <SidebarLinks
          isAdmin={profile?.is_admin ?? false}
          firstDeadlinePassed={firstDeadlinePassed}
        />
      </nav>

      {/* Rodapé: seletor + sair */}
      <div className="border-t border-white/10 px-3 py-3">
        {participants.length > 1 && (
          <div className="mb-2">
            <ParticipantSelector participants={participants} />
          </div>
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
