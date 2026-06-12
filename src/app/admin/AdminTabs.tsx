'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { canAccessPage, type UserRole } from '@/lib/permissions'
import { useAdminView } from '@/contexts/AdminViewContext'

const ALL_TABS = [
  { href: '/admin/usuarios',      label: 'Usuários',            key: 'usuarios'      },
  { href: '/admin/participantes', label: 'Participantes',       key: 'participantes' },
  { href: '/admin/prazos',        label: 'Prazos',              key: 'prazos'        },
  { href: '/admin/emails',        label: 'E-mails',             key: 'emails'        },
  { href: '/admin/avisos',        label: 'Avisos',              key: 'avisos'        },
  { href: '/admin/artilheiros',   label: 'Artilheiros',         key: 'artilheiros'   },
  { href: '/admin/equipes',       label: 'Equipes',             key: 'equipes'       },
  { href: '/admin/paginas',       label: 'Páginas',             key: 'paginas'       },
  { href: '/admin/classificacao', label: 'Classificação',       key: 'classificacao' },
  { href: '/admin/gestao',        label: 'Gestão',              key: 'gestao'        },
  { href: '/admin/telemetria',    label: 'Telemetria',          key: 'telemetria'    },
  { href: '/admin/tribos',        label: 'Tribos',              key: 'tribos'        },
  { href: '/admin/acessos',       label: 'Controle de Acessos', key: 'acessos'       },
]

interface Props {
  role: UserRole
  allowedGroups: string[]
}

export function AdminTabs({ role, allowedGroups }: Props) {
  const pathname = usePathname()
  const { viewMode } = useAdminView()

  const tabs = ALL_TABS.filter(tab => {
    if (tab.key === 'acessos') return role === 'master' && viewMode === 'master'
    return canAccessPage(role, allowedGroups, tab.key)
  })

  return (
    <div className="mb-6 border-b border-gray-200">
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                active
                  ? 'border-verde-600 text-verde-700'
                  : tab.key === 'acessos'
                    ? 'border-transparent text-amber-600 hover:border-amber-300 hover:text-amber-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
