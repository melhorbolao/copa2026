'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAdminView } from '@/contexts/AdminViewContext'
import type { PageVisibilityRow } from '@/lib/page-visibility'

interface Props {
  isAdmin: boolean
  visibility: PageVisibilityRow[]
}

export function SidebarLinks({ isAdmin, visibility }: Props) {
  const pathname = usePathname()
  const { viewMode, toggle } = useAdminView()

  const effectiveAdmin = isAdmin && viewMode === 'admin'

  const visiblePages = visibility.filter(row =>
    effectiveAdmin ? row.show_for_admin : row.show_for_users
  )

  const links = [
    ...visiblePages.map(row => ({ href: `/${row.page_name}`, label: row.label })),
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
                : (l as { highlight?: boolean }).highlight
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
          {viewMode === 'admin' ? 'Modo admin' : 'Modo usuário'}
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
