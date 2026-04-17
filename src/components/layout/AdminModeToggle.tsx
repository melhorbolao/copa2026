'use client'

import { useAdminView } from '@/contexts/AdminViewContext'

export function AdminModeToggle() {
  const { viewMode, toggle } = useAdminView()

  return (
    <button
      onClick={toggle}
      title={viewMode === 'admin' ? 'Alternar para visão de usuário' : 'Alternar para modo admin'}
      className={`mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        viewMode === 'admin'
          ? 'text-amarelo-200 hover:bg-white/10'
          : 'text-white/50 hover:bg-white/10 hover:text-white/80'
      }`}
    >
      {viewMode === 'admin' ? <ShieldIcon /> : <UserIcon />}
      {viewMode === 'admin' ? 'Modo admin' : 'Modo usuário'}
    </button>
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
