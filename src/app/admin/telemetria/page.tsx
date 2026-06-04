import { createAuthAdminClient } from '@/lib/supabase/server'
import { TelemetriaClient } from './TelemetriaClient'

export const dynamic = 'force-dynamic'

const MASTER_EMAIL = 'gmousinho@gmail.com'

// ── Tipos internos ─────────────────────────────────────────────────────────────

interface PageStat {
  path: string
  total_views: number
  unique_users: number
  mobile_views: number
  desktop_views: number
  pct_traffic: number
}

interface UserEngagementEntry {
  userId: string
  name: string
  apelido: string | null
  totalClicks: number
  desktopPct: number
  favoritePage: string
  lastAction: string
  rankingPosition: number | null
}

interface TemporalPoint {
  label: string
  count: number
}

export interface TelemetriaStats {
  kpis: {
    totalViews: number
    uniqueUsers: number
    avgPagesPerUser: number
    peakHour: number
    peakHourCount: number
  }
  pageStats: PageStat[]
  userEngagement: UserEngagementEntry[]
  temporalData: TemporalPoint[]
}

// ── Monta stats a partir de dados pré-agregados pelas views SQL ────────────────

function buildStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageCounters: any[],   // vw_analytics_page_counters → ~15 linhas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  userStats: any[],      // vw_analytics_user_stats   → ~60 linhas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hourlyRows: any[],     // vw_analytics_hourly       → 24 linhas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  up: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scores: any[],
): TelemetriaStats {
  // KPIs — derivados dos contadores de página
  const totalViews = pageCounters.reduce((s, r) => s + (r.total_views as number), 0)
  const uniqueUsers = userStats.length
  const avgPagesPerUser = uniqueUsers > 0
    ? Math.round((totalViews / uniqueUsers) * 10) / 10
    : 0

  // Pico de acesso por hora (já em BRT)
  let peakHour = 0, peakHourCount = 0
  for (const row of hourlyRows) {
    if ((row.cnt as number) > peakHourCount) {
      peakHourCount = row.cnt as number
      peakHour      = row.hour_brt as number
    }
  }

  // Page stats — view já agrega por path
  const pageStats: PageStat[] = pageCounters.map(r => ({
    path:         r.path         as string,
    total_views:  r.total_views  as number,
    unique_users: r.unique_users as number,
    mobile_views: r.mobile_views as number,
    desktop_views:r.desktop_views as number,
    pct_traffic:  Number(r.pct_traffic),
  }))

  // Ranking e mapa de usuários (tabelas pequenas — processamento em JS)
  const rankingPositions = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scores.forEach((s: any, i: number) => {
    if (s.participant_id) rankingPositions.set(s.participant_id, i + 1)
  })
  const userToPrimary = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  up.forEach((r: any) => userToPrimary.set(r.user_id, r.participant_id))
  const usersMap = new Map<string, { name: string; apelido: string | null }>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    users.map((u: any) => [u.id, { name: u.name, apelido: u.apelido }])
  )

  // Engajamento por usuário — view retorna 1 linha por user
  const userEngagement: UserEngagementEntry[] = userStats
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any) => {
      const info       = usersMap.get(row.user_id as string)
      const primaryPId = userToPrimary.get(row.user_id as string)
      const total      = (row.total_views as number) || 0
      const desktop    = (row.desktop_views as number) || 0
      return {
        userId:          row.user_id as string,
        name:            info?.name ?? 'Desconhecido',
        apelido:         info?.apelido ?? null,
        totalClicks:     total,
        desktopPct:      total > 0 ? Math.round((desktop / total) * 100) : 0,
        favoritePage:    (row.favorite_page as string) ?? '/',
        lastAction:      row.last_action as string,
        rankingPosition: primaryPId ? (rankingPositions.get(primaryPId) ?? null) : null,
      }
    })
    .sort((a: UserEngagementEntry, b: UserEngagementEntry) => b.totalClicks - a.totalClicks)

  // Distribuição horária — preenche horas sem registros com zero
  const hourMap = new Map<number, number>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hourlyRows.map((r: any) => [r.hour_brt as number, r.cnt as number])
  )
  const temporalData: TemporalPoint[] = Array.from({ length: 24 }, (_, h) => ({
    label: `${h.toString().padStart(2, '0')}h`,
    count: hourMap.get(h) ?? 0,
  }))

  return {
    kpis: { totalViews, uniqueUsers, avgPagesPerUser, peakHour, peakHourCount },
    pageStats,
    userEngagement,
    temporalData,
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TelemetriaAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [pageCountersRes, userStatsRes, hourlyRes, usersRes, upRes, scoresRes, masterRes] =
    await Promise.all([
      // ~15 linhas (era: 36.000 linhas brutas de page_views)
      admin.from('vw_analytics_page_counters')
        .select('path, total_views, unique_users, mobile_views, desktop_views, pct_traffic'),

      // ~60 linhas — uma por usuário, agregação feita no banco
      admin.from('vw_analytics_user_stats')
        .select('user_id, total_views, desktop_views, mobile_views, last_action, favorite_page'),

      // 24 linhas — uma por hora do dia
      admin.from('vw_analytics_hourly')
        .select('hour_brt, cnt'),

      admin.from('users').select('id, name, apelido').eq('status', 'aprovado'),
      admin.from('user_participants').select('user_id, participant_id').eq('is_primary', true),
      admin.from('participant_scores')
        .select('participant_id, pts_total')
        .order('pts_total', { ascending: false }),
      admin.from('users').select('id').eq('email', MASTER_EMAIL).maybeSingle(),
    ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageCounters: any[] = pageCountersRes.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userStats: any[]    = userStatsRes.data  ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hourlyRows: any[]   = hourlyRes.data      ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users: any[]        = usersRes.data        ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const up: any[]           = upRes.data           ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scores: any[]       = scoresRes.data       ?? []
  const masterUserId: string | null = masterRes.data?.id ?? null

  const fullStats = buildStats(pageCounters, userStats, hourlyRows, users, up, scores)

  // Stats filtrados excluem o dono do bolão (master user)
  let filteredStats = fullStats
  if (masterUserId) {
    const filteredUserStats = userStats.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.user_id !== masterUserId
    )
    // Para pageStats filtrados: subtrai as visitas do master usando query indexada.
    // Pagina manualmente para não truncar em 1000 linhas (PostgREST default).
    const masterPageRows: { path: string; device_type: string }[] = []
    for (let from = 0;;) {
      const { data, error } = await admin
        .from('page_views')
        .select('path, device_type')
        .eq('user_id', masterUserId)
        .range(from, from + 999)
      if (error || !data || data.length === 0) break
      masterPageRows.push(...data)
      if (data.length < 1000) break
      from += 1000
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masterPathMap: Record<string, { total: number; mobile: number; desktop: number }> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of masterPageRows as any[]) {
      if (!masterPathMap[row.path]) masterPathMap[row.path] = { total: 0, mobile: 0, desktop: 0 }
      masterPathMap[row.path].total++
      if (row.device_type === 'mobile') masterPathMap[row.path].mobile++
      else masterPathMap[row.path].desktop++
    }

    const filteredPageCounters = pageCounters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => {
        const m = masterPathMap[r.path as string]
        if (!m) return r
        return {
          ...r,
          total_views:   (r.total_views  as number) - m.total,
          mobile_views:  (r.mobile_views  as number) - m.mobile,
          desktop_views: (r.desktop_views as number) - m.desktop,
          unique_users:  (r.unique_users  as number) - (m.total > 0 ? 1 : 0),
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r: any) => (r.total_views as number) > 0)

    // Recalcula pct_traffic sobre o total filtrado
    const filteredTotal = filteredPageCounters.reduce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: number, r: any) => s + (r.total_views as number), 0
    )
    const filteredPageCountersWithPct = filteredPageCounters.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => ({
        ...r,
        pct_traffic: filteredTotal > 0
          ? Math.round(((r.total_views as number) / filteredTotal) * 1000) / 10
          : 0,
      })
    )

    filteredStats = buildStats(
      filteredPageCountersWithPct,
      filteredUserStats,
      hourlyRows,
      users,
      up,
      scores,
    )
  }

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Telemetria</h2>
      <p className="mb-6 text-sm text-gray-500">
        Análise de acessos e comportamento dos participantes — acumulado da Copa.
      </p>
      <TelemetriaClient
        fullStats={fullStats}
        filteredStats={filteredStats}
        masterEmail={MASTER_EMAIL}
        hasMasterUser={masterUserId !== null}
      />
    </>
  )
}
