'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AdminAlertRow } from '@/types/database'

function isAlertActive(alert: AdminAlertRow): boolean {
  if (!alert.is_active) return false
  const now = Date.now()
  if (new Date(alert.start_at).getTime() > now) return false
  if (alert.end_at && new Date(alert.end_at).getTime() < now) return false
  return true
}

export function AlertBanner() {
  const [alerts, setAlerts]   = useState<AdminAlertRow[]>([])
  const [loggedIn, setLoggedIn] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const supabase = createClient()

    // Verifica sessão
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setLoggedIn(true)
    })

    // Busca alertas ativos
    supabase
      .from('admin_alerts')
      .select('*')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setAlerts(data)
      })

    // Realtime: escuta mudanças na tabela
    const channel = supabase
      .channel('admin_alerts_banner')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'admin_alerts' },
        () => {
          // Re-busca ao receber qualquer mudança
          supabase
            .from('admin_alerts')
            .select('*')
            .eq('is_active', true)
            .then(({ data }) => {
              if (data) setAlerts(data)
            })
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  if (!loggedIn) return null

  const visible = alerts.filter(a => isAlertActive(a) && !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div className="w-full">
      {visible.map(alert => (
        <div
          key={alert.id}
          className="flex items-center justify-between gap-3 bg-yellow-400 px-4 py-2.5 text-sm font-medium text-yellow-900"
        >
          <span className="flex-1 text-center">{alert.message}</span>
          <button
            onClick={() => setDismissed(prev => new Set([...prev, alert.id]))}
            className="shrink-0 rounded p-0.5 hover:bg-yellow-500 transition"
            aria-label="Fechar aviso"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
