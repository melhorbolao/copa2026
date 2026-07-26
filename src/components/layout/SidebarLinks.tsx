'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAdminView } from '@/contexts/AdminViewContext'
import type { PageVisibilityRow } from '@/lib/page-visibility'

interface Props {
  role: string
  visibility: PageVisibilityRow[]
}

export function SidebarLinks({ role, visibility }: Props) {
  const pathname = usePathname()
  const { viewMode } = useAdminView()

  const isAdmin = role === 'admin' || role === 'master'
  const effectiveAdmin = isAdmin && viewMode !== 'user'

  const visiblePages = visibility.filter(row => {
    if (!effectiveAdmin) return row.show_for_users
    if (role === 'master' && viewMode === 'master') return true
    return row.show_for_admin
  })

  const links = [
    ...visiblePages.map(row => ({ href: `/copa2026/${row.page_name}`, label: row.label })),
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
                ? 'bg-azul-mid text-white'
                : (l as { highlight?: boolean }).highlight
                  ? 'font-bold text-ouro hover:bg-azul-mid'
                  : 'text-ouro hover:bg-azul-mid hover:text-white'
            }`}
          >
            {l.label}
          </Link>
        )
      })}
    </div>
  )
}
