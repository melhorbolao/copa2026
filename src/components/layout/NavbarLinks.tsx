'use client'

import Link from 'next/link'
import { useAdminView } from '@/contexts/AdminViewContext'

interface Props {
  isAdmin: boolean
  firstDeadlinePassed: boolean
}

export function NavbarLinks({ isAdmin, firstDeadlinePassed }: Props) {
  const { viewMode, toggle } = useAdminView()

  // Admin efetivo: é admin E está no modo admin
  const effectiveAdmin = isAdmin && viewMode === 'admin'
  // Ranking: libera após prazo R1 ou se admin em modo admin
  const showAll = effectiveAdmin || firstDeadlinePassed

  return (
    <div className="flex items-center gap-1 text-sm">
      <NavLink href="/palpites">Meus Palpites</NavLink>
      <NavLink href="/tabela">Minha Tabela</NavLink>
      {showAll && <NavLink href="/classificacao">Ranking</NavLink>}
      <NavLink href="/participantes">Participantes</NavLink>
      <NavLink href="/pontuacao">Pontuação</NavLink>
      <NavLink href="/regulamento">Regulamento</NavLink>
      {effectiveAdmin && <NavLink href="/admin" highlight>Admin</NavLink>}

      {/* Toggle de visão — só para admins */}
      {isAdmin && (
        <button
          onClick={toggle}
          title={viewMode === 'admin' ? 'Alternar para visão de usuário' : 'Alternar para modo admin'}
          className={`ml-1 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
            viewMode === 'admin'
              ? 'bg-amarelo-400/20 text-amarelo-200 hover:bg-amarelo-400/30'
              : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white'
          }`}
        >
          {viewMode === 'admin' ? <ShieldIcon /> : <UserIcon />}
          <span className="hidden sm:inline">
            {viewMode === 'admin' ? 'Admin' : 'Usuário'}
          </span>
        </button>
      )}
    </div>
  )
}

function NavLink({
  href,
  children,
  highlight,
}: {
  href: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
        highlight
          ? 'bg-amarelo-400 text-verde-900 hover:bg-amarelo-300'
          : 'text-white/90 hover:bg-white/10 hover:text-white'
      }`}
    >
      {children}
    </Link>
  )
}

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}
