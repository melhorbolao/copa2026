'use client'

import { createContext, useContext, useState } from 'react'

export type AdminViewMode = 'admin' | 'user' | 'master'

interface AdminViewCtx {
  viewMode: AdminViewMode
  setMode: (mode: AdminViewMode) => void
}

const AdminViewContext = createContext<AdminViewCtx>({
  viewMode: 'admin',
  setMode: () => {},
})

export function AdminViewProvider({ children }: { children: React.ReactNode }) {
  const [viewMode, setViewMode] = useState<AdminViewMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('adminViewMode') as AdminViewMode | null
      if (stored && ['admin', 'user', 'master'].includes(stored)) return stored
    }
    return 'admin'
  })

  const setMode = (mode: AdminViewMode) => {
    setViewMode(mode)
    localStorage.setItem('adminViewMode', mode)
  }

  return (
    <AdminViewContext.Provider value={{ viewMode, setMode }}>
      {children}
    </AdminViewContext.Provider>
  )
}

export function useAdminView() {
  return useContext(AdminViewContext)
}
