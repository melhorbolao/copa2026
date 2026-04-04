'use client'

import { createContext, useContext, useState } from 'react'

export type AdminViewMode = 'admin' | 'user'

interface AdminViewCtx {
  viewMode: AdminViewMode
  toggle: () => void
}

const AdminViewContext = createContext<AdminViewCtx>({
  viewMode: 'admin',
  toggle: () => {},
})

export function AdminViewProvider({ children }: { children: React.ReactNode }) {
  const [viewMode, setViewMode] = useState<AdminViewMode>(() => {
    // Lê do localStorage na primeira renderização client-side (evita flash)
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('adminViewMode') as AdminViewMode) ?? 'admin'
    }
    return 'admin'
  })

  const toggle = () => {
    const next: AdminViewMode = viewMode === 'admin' ? 'user' : 'admin'
    setViewMode(next)
    localStorage.setItem('adminViewMode', next)
  }

  return (
    <AdminViewContext.Provider value={{ viewMode, toggle }}>
      {children}
    </AdminViewContext.Provider>
  )
}

export function useAdminView() {
  return useContext(AdminViewContext)
}
