'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useAdminView } from '@/contexts/AdminViewContext'

interface Props {
  isAdmin: boolean
  firstDeadlinePassed: boolean
}

export function NavbarLinks({ isAdmin, firstDeadlinePassed }: Props) {
  const { viewMode, toggle } = useAdminView()
  const [open, setOpen] = useState(false)

  // Admin efetivo: é admin E está no modo admin
  const effectiveAdmin = isAdmin && viewMode === 'admin'
  // Ranking: libera após prazo R1 ou se admin em modo admin
  const showAll = effectiveAdmin || firstDeadlinePassed

  const links = [
    { href: '/palpites',      label: 'Meus Palpites' },
    { href: '/tabela',        label: 'Minha Tabela'  },
    { href: '/acopa',         label: 'A Copa'        },
    ...(showAll ? [{ href: '/classificacao', label: 'Ranking' }] : []),
    { href: '/participantes', label: 'Participantes' },
    { href: '/pontuacao',     label: 'Pontuação'     },
    { href: '/regulamento',   label: 'Regulamento'   },
    ...(effectiveAdmin ? [{ href: '/admin', label: 'Admin', highlight: true }] : []),
  ]

  return (
    <>
      {/* ── Desktop: links em linha ── */}
      <div className="hidden items-center gap-1 text-sm sm:flex">
        {links.map(l => (
          <NavLink key={l.href} href={l.href} highlight={l.highlight}>
            {l.label}
          </NavLink>
        ))}

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

      {/* ── Mobile: hambúrguer ── */}
      <div className="relative sm:hidden">
        <button
          onClick={() => setOpen(v => !v)}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-white hover:bg-white/10"
        >
          {open ? <XIcon /> : <MenuIcon />}
        </button>

        {open && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            {/* Dropdown */}
            <div className="fixed right-4 top-14 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-verde-800 shadow-xl">
              {links.map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-3 text-sm font-medium transition hover:bg-white/10 ${
                    l.highlight ? 'font-bold text-amarelo-300' : 'text-white/90'
                  }`}
                >
                  {l.label}
                </Link>
              ))}

              {isAdmin && (
                <button
                  onClick={() => { toggle(); setOpen(false) }}
                  className="flex w-full items-center gap-2 border-t border-white/10 px-4 py-3 text-sm font-medium text-white/60 transition hover:bg-white/10"
                >
                  {viewMode === 'admin' ? <UserIcon /> : <ShieldIcon />}
                  {viewMode === 'admin' ? 'Visão de usuário' : 'Modo admin'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
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

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6"  x2="21" y2="6"  />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6"  x2="6"  y2="18" />
      <line x1="6"  y1="6"  x2="18" y2="18" />
    </svg>
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
