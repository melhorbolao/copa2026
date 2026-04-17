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
  const { viewMode } = useAdminView()

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

    </div>
  )
}
