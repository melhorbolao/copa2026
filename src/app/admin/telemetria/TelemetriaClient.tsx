'use client'

import { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
} from 'recharts'
import type { TelemetriaStats } from './page'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Props {
  fullStats: TelemetriaStats
  filteredStats: TelemetriaStats
  masterEmail: string
  hasMasterUser: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PATH_LABELS: Record<string, string> = {
  '/jogos':             'Jogos',
  '/classificacaoMB':  'Classificação MB',
  '/tabelaMB':         'Tabela MB',
  '/palpites':         'Palpites',
  '/comparador':       'Comparador MB',
  '/minhaPanela':      'Minha Panela',
  '/participantes':    'Participantes',
  '/estatisticas':     'Estatísticas',
  '/zebras':           'Zebras',
  '/simulador':        'Simulador',
  '/artilharia':       'Artilharia',
  '/apostas-especiais':'Apostas Especiais',
  '/acopa':            'A Copa',
  '/premiacaoMB':      'Premiação MB',
  '/ia-no-mb':         'IA no MB',
}

function pathLabel(path: string): string {
  return PATH_LABELS[path] ?? path
}

function formatLastAction(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${day}/${month} às ${hh}:${mm}`
}

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0]?.toUpperCase() ?? '')
    .join('')
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string
  value: string | number
  sub?: string
  icon: string
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-[#002776]/20 bg-[#001F5B] p-5 shadow-md">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#FFD700]/10 text-xl">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-[#FFD700]/70">{label}</p>
        <p className="mt-0.5 truncate text-2xl font-black text-white">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-white/50">{sub}</p>}
      </div>
    </div>
  )
}

// ── Tooltip customizado ───────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-[#FFD700]/30 bg-[#001133] px-3 py-2 text-xs text-white shadow-xl">
      <p className="mb-1 font-semibold text-[#FFD700]">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i}>
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

// ── Toggle de exclusão do admin ───────────────────────────────────────────────

function AdminToggle({
  excluded,
  onChange,
  email,
}: {
  excluded: boolean
  onChange: (v: boolean) => void
  email: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={excluded}
        onClick={() => onChange(!excluded)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#002776] focus:ring-offset-1 ${
          excluded ? 'bg-[#002776]' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
            excluded ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-xs text-gray-600">
        Excluir admin{' '}
        <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-500">{email}</code>{' '}
        das estatísticas
      </span>
      <span
        className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          excluded
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-200 text-gray-500'
        }`}
      >
        {excluded ? 'EXCLUÍDO' : 'INCLUÍDO'}
      </span>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function TelemetriaClient({
  fullStats,
  filteredStats,
  masterEmail,
  hasMasterUser,
}: Props) {
  const [excludeAdmin, setExcludeAdmin] = useState(true)
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol]   = useState<'rank' | 'name' | 'clicks' | 'desktop' | 'favorite' | 'last'>('rank')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')

  const data = excludeAdmin ? filteredStats : fullStats

  const { kpis, pageStats, userEngagement, temporalData, dailyData } = data

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'rank' || col === 'clicks' ? 'asc' : 'asc') }
  }

  const sortedUsers = [...(search
    ? userEngagement.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        (u.apelido ?? '').toLowerCase().includes(search.toLowerCase()))
    : userEngagement
  )].sort((a, b) => {
    let cmp = 0
    if (sortCol === 'rank' || sortCol === 'clicks') cmp = b.totalClicks - a.totalClicks
    else if (sortCol === 'name')     cmp = (a.apelido ?? a.name).localeCompare(b.apelido ?? b.name, 'pt-BR')
    else if (sortCol === 'desktop')  cmp = a.desktopPct - b.desktopPct
    else if (sortCol === 'favorite') cmp = (a.favoritePage).localeCompare(b.favoritePage)
    else if (sortCol === 'last')     cmp = a.lastAction.localeCompare(b.lastAction)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const filteredUsers = sortedUsers

  const isEmpty = kpis.totalViews === 0

  const topPages = pageStats.slice(0, 15).map(s => ({
    ...s,
    label: pathLabel(s.path),
  }))

  const BAR_GOLD   = '#FFD700'
  const BAR_NAVY   = '#002776'
  const LINE_GOLD  = '#FEDD00'
  const GRID_COLOR = '#1e3a6e'

  return (
    <div className="space-y-8">
      {/* ── Toggle excluir admin ──────────────────────────────────────────── */}
      {hasMasterUser && (
        <AdminToggle
          excluded={excludeAdmin}
          onChange={setExcludeAdmin}
          email={masterEmail}
        />
      )}

      {isEmpty && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
          <p className="text-3xl">📊</p>
          <p className="mt-2 font-semibold text-gray-600">Ainda sem dados de telemetria</p>
          <p className="mt-1 text-sm text-gray-400">
            Os registros aparecerão aqui conforme os participantes navegarem pelo bolão.
          </p>
        </div>
      )}

      {/* ── 1. KPI Cards ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Métricas Gerais
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <KpiCard
            label="Visualizações totais"
            value={kpis.totalViews.toLocaleString('pt-BR')}
            icon="👁️"
          />
          <KpiCard
            label="Usuários ativos únicos"
            value={kpis.uniqueUsers.toLocaleString('pt-BR')}
            icon="👤"
          />
          <KpiCard
            label="Média de páginas/usuário"
            value={kpis.avgPagesPerUser.toLocaleString('pt-BR')}
            icon="📄"
          />
          <KpiCard
            label="Acessos via desktop"
            value={isEmpty ? '—' : `${kpis.desktopPct}%`}
            sub={isEmpty ? undefined : `${100 - kpis.desktopPct}% mobile`}
            icon="🖥️"
          />
          <KpiCard
            label="Pico de acesso"
            value={isEmpty ? '—' : `${kpis.peakHour.toString().padStart(2, '0')}h`}
            sub={isEmpty ? undefined : `${kpis.peakHourCount} acessos nesse horário`}
            icon="🔥"
          />
        </div>
      </section>

      {/* ── 2. Ranking de Páginas ─────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Ranking de Páginas
        </h3>

        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {topPages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Nenhum dado disponível</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(topPages.length * 36, 120)}>
              <BarChart
                data={topPages}
                layout="vertical"
                margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={130}
                  tick={{ fontSize: 11, fill: '#374151' }}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f9fafb' }} />
                <Bar dataKey="total_views" name="Acessos" radius={[0, 4, 4, 0]}>
                  {topPages.map((_, i) => (
                    <Cell key={i} fill={i < 3 ? BAR_GOLD : BAR_NAVY} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {pageStats.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-[#001F5B] text-left text-xs font-semibold uppercase tracking-wider text-[#FFD700]">
                  <th className="px-4 py-3">Rota / Página</th>
                  <th className="px-4 py-3 text-right">Acessos</th>
                  <th className="px-4 py-3 text-right">% do Tráfego</th>
                  <th className="px-4 py-3 text-center">Dispositivo</th>
                </tr>
              </thead>
              <tbody>
                {pageStats.map((s, i) => {
                  const predominant =
                    s.mobile_views >= s.desktop_views ? 'Mobile' : 'Desktop'
                  const pctMobile =
                    s.total_views > 0
                      ? Math.round((s.mobile_views / s.total_views) * 100)
                      : 0
                  return (
                    <tr
                      key={s.path}
                      className={
                        i % 2 === 0
                          ? 'bg-white hover:bg-gray-50'
                          : 'bg-gray-50 hover:bg-gray-100'
                      }
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-800">
                        <span className="block font-semibold">{pathLabel(s.path)}</span>
                        <span className="text-xs text-gray-400">{s.path}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                        {s.total_views.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {s.pct_traffic.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            predominant === 'Mobile'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {predominant === 'Mobile' ? '📱' : '🖥️'} {predominant}{' '}
                          <span className="opacity-60">({pctMobile}%)</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 3. Leaderboard de Engajamento ─────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Leaderboard de Engajamento
          </h3>
          <input
            type="text"
            placeholder="Filtrar por participante..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm outline-none focus:border-[#002776] focus:ring-1 focus:ring-[#002776] sm:w-56"
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#002776]/20 shadow-md">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[#FFD700]/30 bg-[#001F5B] text-left text-xs font-semibold uppercase tracking-wider text-[#FFD700]">
                {(
                  [
                    { col: 'rank',     label: '#',              cls: 'px-3 py-3 text-center w-10' },
                    { col: 'name',     label: 'Participante',   cls: 'px-4 py-3' },
                    { col: 'clicks',   label: 'Cliques',        cls: 'px-4 py-3 text-right' },
                    { col: 'desktop',  label: '% Desktop',      cls: 'px-4 py-3 text-right' },
                    { col: 'favorite', label: 'Página Favorita',cls: 'px-4 py-3' },
                    { col: 'last',     label: 'Última Ação',    cls: 'px-4 py-3' },
                  ] as { col: typeof sortCol; label: string; cls: string }[]
                ).map(({ col, label, cls }) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className={`${cls} cursor-pointer select-none hover:bg-[#002D80] transition-colors`}
                  >
                    {label}
                    {sortCol === col
                      ? <span className="ml-1 opacity-80">{sortDir === 'asc' ? '▲' : '▼'}</span>
                      : <span className="ml-1 opacity-30">↕</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-400">
                    {search ? 'Nenhum participante encontrado' : 'Nenhum dado disponível'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u, i) => (
                  <tr
                    key={u.userId}
                    className={
                      i % 2 === 0
                        ? 'bg-[#002D80]/5 hover:bg-[#002D80]/10'
                        : 'bg-[#001F5B]/5 hover:bg-[#001F5B]/10'
                    }
                    style={{ borderBottom: '1px solid rgba(255,215,0,0.08)' }}
                  >
                    <td className="px-3 py-3 text-center text-xs font-bold text-gray-400">
                      {i + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#002776] text-xs font-bold text-[#FFD700]">
                          {initials(u.name)}
                        </div>
                        <div className="min-w-0">
                          <a
                            href={`/admin/usuarios`}
                            className="block truncate font-semibold text-[#002776] hover:underline"
                            title={u.name}
                          >
                            {u.apelido ?? u.name}
                          </a>
                          {u.rankingPosition != null && (
                            <span className="text-xs text-gray-400">
                              {u.rankingPosition}º no bolão
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-gray-900">
                      {u.totalClicks.toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {u.totalClicks > 0 ? `${u.desktopPct}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium">
                        {pathLabel(u.favoritePage)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatLastAction(u.lastAction)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 4. Distribuição Temporal por Hora ─────────────────────────────── */}
      <section>
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Volume de acessos por hora do dia
        </h3>
        <p className="mb-3 text-xs text-gray-400">Horário de Brasília</p>
        <div className="rounded-xl border border-gray-200 bg-[#001133] p-5 shadow-sm">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={temporalData}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone" dataKey="count" name="Acessos"
                stroke={LINE_GOLD} strokeWidth={2}
                dot={{ fill: LINE_GOLD, r: 3 }}
                activeDot={{ r: 5, fill: '#fff', stroke: LINE_GOLD }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── 5. Volume por dia ─────────────────────────────────────────────── */}
      {dailyData.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Volume de acessos por dia
          </h3>
          <p className="mb-3 text-xs text-gray-400">Total de page views por dia</p>
          <div className="rounded-xl border border-gray-200 bg-[#001133] p-5 shadow-sm overflow-x-auto">
            <div style={{ minWidth: Math.max(dailyData.length * 32, 400) }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dailyData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" name="Acessos" fill={BAR_GOLD} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* ── 6. Usuários únicos por dia ────────────────────────────────────── */}
      {dailyData.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Volume de acessos únicos por dia
          </h3>
          <p className="mb-3 text-xs text-gray-400">Usuários distintos que acessaram o bolão</p>
          <div className="rounded-xl border border-gray-200 bg-[#001133] p-5 shadow-sm overflow-x-auto">
            <div style={{ minWidth: Math.max(dailyData.length * 32, 400) }}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dailyData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone" dataKey="unique" name="Usuários únicos"
                    stroke={LINE_GOLD} strokeWidth={2}
                    dot={{ fill: LINE_GOLD, r: 3 }}
                    activeDot={{ r: 5, fill: '#fff', stroke: LINE_GOLD }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
