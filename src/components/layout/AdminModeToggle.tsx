'use client'

import { useEffect } from 'react'
import { useAdminView, type AdminViewMode } from '@/contexts/AdminViewContext'

interface Props {
  isMaster: boolean
}

export function AdminModeToggle({ isMaster }: Props) {
  const { viewMode, setMode } = useAdminView()

  // Na primeira visita do master, inicia em 'master' (não 'admin')
  useEffect(() => {
    if (isMaster && !localStorage.getItem('adminViewMode')) {
      setMode('master')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClick() {
    if (isMaster) {
      const cycle: AdminViewMode[] = ['master', 'admin', 'user']
      const next = cycle[(cycle.indexOf(viewMode as AdminViewMode) + 1) % cycle.length]
      setMode(next)
    } else {
      setMode(viewMode === 'admin' ? 'user' : 'admin')
    }
  }

  const config = {
    master: { label: 'Modo master',   dim: false,  icon: <CrownIcon /> },
    admin:  { label: 'Modo admin',    dim: false,  icon: <ShieldIcon /> },
    user:   { label: 'Modo usuário',  dim: true,   icon: <UserIcon /> },
  }[viewMode] ?? { label: 'Modo admin', dim: false, icon: <ShieldIcon /> }

  return (
    <button
      onClick={handleClick}
      title="Alternar modo de visualização"
      className={`mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        config.dim
          ? 'text-ouro/50 hover:bg-azul-mid hover:text-ouro/80'
          : 'text-ouro hover:bg-azul-mid'
      }`}
    >
      {config.icon}
      {config.label}
    </button>
  )
}

function CrownIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M2 19h20v2H2v-2zm2-3l2-8 4 4 4-7 4 7 4-4 2 8H4z" />
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
