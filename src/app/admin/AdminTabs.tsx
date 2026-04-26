'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/admin/usuarios',      label: 'Usuários'      },
  { href: '/admin/participantes', label: 'Participantes' },
  { href: '/admin/prazos',        label: 'Prazos'        },
  { href: '/admin/emails',        label: 'E-mails'       },
  { href: '/admin/avisos',        label: 'Avisos'        },
  { href: '/admin/artilheiros',   label: 'Artilheiros'   },
  { href: '/admin/equipes',       label: 'Equipes'       },
  { href: '/admin/paginas',        label: 'Páginas'       },
  { href: '/admin/classificacao', label: 'Classificação' },
  { href: '/admin/dados',         label: 'Dados'         },
]

export function AdminTabs() {
  const pathname = usePathname()

  return (
    <div className="mb-6 overflow-x-auto border-b border-gray-200">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                active
                  ? 'border-verde-600 text-verde-700'
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
