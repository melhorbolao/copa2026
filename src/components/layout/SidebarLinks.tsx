'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAdminView } from '@/contexts/AdminViewContext'

interface Props {
  isAdmin: boolean
  firstDeadlinePassed: boolean
}

export function SidebarLinks({ isAdmin, firstDeadlinePassed }: Props) {
  const pathname = usePathname()
  const { viewMode, toggle } = useAdminView()

  const effectiveAdmin = isAdmin && viewMode === 'admin'
  const showAll = effectiveAdmin || firstDeadlinePassed

  const links = [
    { href: '/palpites',      label: 'Meus Palpites' },
    { href: '/tabela',        label: 'Minha Tabela'  },
    ...(effectiveAdmin ? [{ href: '/acopa',          label: 'A Copa'       }] : []),
    ...(showAll         ? [{ href: '/classificacao',  label: 'Ranking'      }] : []),
    { href: '/participantes', label: 'Participantes' },
    { href: '/pontuacao',     label: 'Pontuação'     },
    { href: '/regulamento',   label: 'Regulamento'   },
    ...(effectiveAdmin ? [{ href: '/admin', label: 'Admin', highlight: true }] : []),
  ]

  return (
    <div className="flex flex-col px-2 py-2">
      {links.map(l => {
        const active = pathname === l.href || pathname.startsWith(l.href + '/')
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-white/20 text-white'
                : l.highlight
                  ? 'font-bold text-amarelo-300 hover:bg-white/10'
                  : 'text-white/80 hover:bg-white/10 hover:text-white'
            }`}
          >
            {l.label}
          </Link>
        )
      })}

      {isAdmin && (
        <button
          onClick={toggle}
          title={viewMode === 'admin' ? 'Alternar para visão de usuário' : 'Alternar para modo admin'}
          className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition border-t border-white/10 pt-3 ${
            viewMode === 'admin'
              ? 'text-amarelo-200 hover:bg-white/10'
              : 'text-white/50 hover:bg-white/10 hover:text-white/80'
          }`}
        >
          {viewMode === 'admin' ? <ShieldIcon /> : <UserIcon />}
          {viewMode === 'admin' ? 'Visão admin' : 'Modo usuário'}
        </button>
      )}
    </div>
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
