import { createAdminClient } from '@/lib/supabase/server'
import { EmailSettingCard } from './EmailSettingsClient'

const CRON_KEYS  = new Set(['alert_24h', 'alert_6h', 'receipt'])
const KEY_ORDER  = ['alert_24h', 'alert_6h', 'receipt', 'notify_approved', 'notify_new_user']

const DEFAULTS: Record<string, { label: string; description: string }> = {
  alert_24h:       { label: 'Aviso 24h antes do prazo',      description: 'Enviado a todos (completos e incompletos) 24h antes do prazo de cada etapa, com o Excel de palpites em anexo.' },
  alert_6h:        { label: 'Aviso 6h antes do prazo',       description: 'Enviado apenas a participantes com palpites incompletos 6h antes do prazo.' },
  receipt:         { label: 'Comprovante no prazo',           description: 'Enviado a todos ao vencer o prazo, com o Excel dos palpites como comprovante.' },
  notify_approved: { label: 'Boas-vindas na aprovação',       description: 'Enviado ao participante quando o admin aprova a sua conta.' },
  notify_new_user: { label: 'Notificação de novo cadastro',   description: 'Enviado ao admin quando um novo usuário conclui o cadastro.' },
}

export default async function AdminEmailsPage() {
  const supabase = await createAdminClient()

  const [{ data: settingsRows }, { data: logRows }] = await Promise.all([
    supabase.from('email_settings').select('key, enabled, label, description, updated_at'),
    supabase.from('email_logs')
      .select('job_type, status, sent_at')
      .gte('sent_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
      .order('sent_at', { ascending: false }),
  ])

  // Monta mapa de settings (com fallback nos defaults)
  const settingsMap = new Map(
    (settingsRows ?? []).map(s => [s.key, s])
  )

  // Monta stats por job_type
  const statsMap = new Map<string, { sent: number; errors: number; lastSent: string | null }>()
  for (const row of (logRows ?? [])) {
    const key = row.job_type
    if (!statsMap.has(key)) statsMap.set(key, { sent: 0, errors: 0, lastSent: null })
    const s = statsMap.get(key)!
    if (row.status === 'sent')  { s.sent++;   if (!s.lastSent) s.lastSent = row.sent_at }
    if (row.status === 'error') s.errors++
  }

  const settings = KEY_ORDER.map(key => {
    const row = settingsMap.get(key)
    const def = DEFAULTS[key] ?? { label: key, description: '' }
    return {
      key,
      label:       row?.label       ?? def.label,
      description: row?.description ?? def.description,
      enabled:     row?.enabled     ?? true,
    }
  })

  const cronSettings  = settings.filter(s => CRON_KEYS.has(s.key))
  const eventSettings = settings.filter(s => !CRON_KEYS.has(s.key))

  // Últimos 20 logs para o historial
  const recentLogs = (logRows ?? []).slice(0, 20)

  return (
    <div className="space-y-8">

      {/* ── Automáticos (cron) ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Automáticos — Cron Jobs</h2>
        <div className="space-y-3">
          {cronSettings.map(s => (
            <EmailSettingCard
              key={s.key}
              setting={s}
              stats={statsMap.get(s.key) ?? { sent: 0, errors: 0, lastSent: null }}
              isCron={true}
            />
          ))}
        </div>
      </section>

      {/* ── Por evento ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Por Evento</h2>
        <div className="space-y-3">
          {eventSettings.map(s => (
            <EmailSettingCard
              key={s.key}
              setting={s}
              stats={statsMap.get(s.key) ?? { sent: 0, errors: 0, lastSent: null }}
              isCron={false}
            />
          ))}
        </div>
      </section>

      {/* ── Histórico recente ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">Histórico recente (30 dias)</h2>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhum envio registrado nos últimos 30 dias.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Data/hora</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-2 font-mono text-gray-600">{log.job_type}</td>
                    <td className="px-3 py-2 text-gray-500">{log.etapa_key}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-[180px]">{log.email}</td>
                    <td className="px-3 py-2">
                      {log.status === 'sent'
                        ? <span className="text-verde-600 font-semibold">✓ enviado</span>
                        : <span className="text-red-500 font-semibold">✗ erro</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {new Date(log.sent_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                        timeZone: 'America/Sao_Paulo',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  )
}
