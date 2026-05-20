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
  { href: '/admin/gestao',        label: 'Gestão'        },
]

export function AdminTabs() {
  const pathname = usePathname()

  return (
    <div className="mb-6 border-b border-ouro/30">
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition ${
                active
                  ? 'border-ouro text-ouro'
                  : 'border-transparent text-white/60 hover:text-white hover:border-white/30'
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
