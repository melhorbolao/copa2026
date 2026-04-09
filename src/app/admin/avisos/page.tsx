import { createClient } from '@/lib/supabase/server'
import type { AdminAlertRow } from '@/types/database'
import { CreateAlertForm, AlertList } from './AvisosClient'

export const metadata = {}

export default async function AvisosPage() {
  const supabase = await createClient()

  const { data: allAlerts } = await supabase
    .from('admin_alerts')
    .select('*')
    .order('start_at', { ascending: false })

  const alerts = (allAlerts ?? []) as AdminAlertRow[]

  const now = new Date()

  // Ativos/programados: is_active=true e não expirados
  const upcoming = alerts.filter(a =>
    a.is_active && (a.end_at === null || new Date(a.end_at) >= now)
  )

  // Histórico: desativados ou expirados
  const historic = alerts.filter(a =>
    !a.is_active || (a.end_at !== null && new Date(a.end_at) < now)
  )

  return (
    <div className="space-y-8">
      <CreateAlertForm />

      <AlertList
        alerts={upcoming}
        title="Programados / Ativos"
      />

      <AlertList
        alerts={historic}
        title="Histórico"
        showActions={false}
      />
    </div>
  )
}
