'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Flag } from '@/components/ui/Flag'
import type { ZebraMatch, ZebraRankingEntry, ZebraScorer } from './types'

type SortKey = 'pts' | 'cravadas' | 'colunas'

interface Props {
  zebraMatches: ZebraMatch[]
  ranking: ZebraRankingEntry[]
  threshold: number
}

// ── Utilitários ──────────────────────────────────────────────────────────────

function pct(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100)
}

function avatarColor(name: string): string {
  const palette = [
    'bg-blue-600', 'bg-emerald-600', 'bg-purple-600',
    'bg-orange-500', 'bg-pink-600', 'bg-teal-600',
    'bg-red-600', 'bg-indigo-600',
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-semibold transition border-b-2 ${
        active
          ? 'border-ouro text-ouro'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

function SortHeader({
  label, sortKey, activeKey, asc, onClick,
}: {
  label: string; sortKey: SortKey; activeKey: SortKey; asc: boolean; onClick: (k: SortKey) => void
}) {
  const active = sortKey === activeKey
  return (
    <th
      onClick={() => onClick(sortKey)}
      className="cursor-pointer select-none whitespace-nowrap px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-ouro hover:text-yellow-300"
    >
      {label}{active ? (asc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

function ParticipantAvatar({ name }: { name: string }) {
  return (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(name)}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

// ── Aba 1: Mitos das Zebras ──────────────────────────────────────────────────

function MitosTab({
  ranking, sortKey, sortAsc, onSort,
}: {
  ranking: (ZebraRankingEntry & { zebraRank: number })[]
  sortKey: SortKey
  sortAsc: boolean
  onSort: (k: SortKey) => void
}) {
  if (ranking.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-gray-400">
        <Image src="/zebra.png" alt="" width={48} height={48} className="opacity-30" />
        <p className="text-sm">Nenhum participante pontuou em zebras ainda.</p>
        <p className="text-xs">Acompanhe os jogos — as surpresas estão por vir!</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ouro/30 shadow-md">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-azul-dark">
            <th className="w-10 px-3 py-2.5 text-center text-xs font-bold uppercase tracking-wide text-ouro">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-ouro">Participante</th>
            <SortHeader label="🦓 Cravadas" sortKey="cravadas" activeKey={sortKey} asc={sortAsc} onClick={onSort} />
            <SortHeader label="Colunas" sortKey="colunas" activeKey={sortKey} asc={sortAsc} onClick={onSort} />
            <SortHeader label="PTS Zebras" sortKey="pts" activeKey={sortKey} asc={sortAsc} onClick={onSort} />
          </tr>
        </thead>
        <tbody>
          {ranking.map((entry, idx) => (
            <tr
              key={entry.participantId}
              className={`border-b border-ouro/10 transition hover:bg-blue-100/40 ${
                idx % 2 === 0 ? 'bg-blue-50/40' : 'bg-blue-100/25'
              }`}
            >
              <td className="px-3 py-2 text-center text-xs font-semibold text-gray-500">
                {entry.zebraRank}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <ParticipantAvatar name={entry.apelido} />
                  <span className="font-semibold text-gray-800">{entry.apelido}</span>
                  {entry.position !== null && (
                    <span className="text-xs text-gray-400">({entry.position}º)</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-center font-bold text-gray-800">
                {entry.cravadas > 0
                  ? <span className="rounded bg-ouro/10 px-1.5 py-0.5 text-ouro">{entry.cravadas}</span>
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="px-3 py-2 text-center text-gray-600">{entry.colunas || '—'}</td>
              <td className="px-3 py-2 text-center">
                <span className="rounded bg-azul-dark px-2 py-0.5 text-xs font-bold text-ouro">
                  +{entry.pts}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Distribuição de apostas ──────────────────────────────────────────────────

function DistributionBar({
  match,
}: {
  match: ZebraMatch
}) {
  const { teamHome, teamAway, totalBets, homeCount, drawCount, awayCount, actualResult } = match

  const cols = [
    { key: 'H' as const, label: teamHome,  flagCode: match.flagHome, count: homeCount },
    { key: 'D' as const, label: 'Empate',  flagCode: '',              count: drawCount },
    { key: 'A' as const, label: teamAway,  flagCode: match.flagAway, count: awayCount },
  ]

  return (
    <div className="flex gap-1 text-xs">
      {cols.map(col => {
        const p = pct(col.count, totalBets)
        const isWinner = col.key === actualResult
        return (
          <div
            key={col.key}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 ${
              isWinner
                ? 'border border-ouro/60 bg-amber-50 font-semibold'
                : 'bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-1">
              {col.flagCode && <Flag code={col.flagCode} size="xs" />}
              <span className={`max-w-[72px] truncate text-center text-[10px] ${isWinner ? 'text-gray-800' : 'text-gray-500'}`}>
                {col.label}
              </span>
              {isWinner && (
                <Image src="/zebra.png" alt="Zebra" width={14} height={14} className="shrink-0" />
              )}
            </div>
            <span className={`text-sm font-bold ${isWinner ? 'text-ouro' : 'text-gray-400'}`}>
              {p}%
            </span>
            <span className="text-[9px] text-gray-400">{col.count} aposda{col.count !== 1 ? 's' : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Card de cada zebra ───────────────────────────────────────────────────────

function ScorerBadge({ scorer }: { scorer: ZebraScorer }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      scorer.isExact
        ? 'bg-ouro/15 text-yellow-800'
        : 'bg-gray-100 text-gray-700'
    }`}>
      <span>{scorer.apelido}</span>
      {scorer.position !== null && <span className="text-gray-400">({scorer.position}º)</span>}
      <span className="text-gray-500">·</span>
      <span className={scorer.isExact ? 'font-bold text-yellow-700' : ''}>+{scorer.pts} PTS</span>
      {scorer.isExact && <span className="text-yellow-600">(Cravou)</span>}
    </span>
  )
}

function ZebraMatchCard({ match }: { match: ZebraMatch }) {
  const resultLabel =
    match.actualResult === 'H' ? `${match.teamHome} venceu` :
    match.actualResult === 'A' ? `${match.teamAway} venceu` :
    'Empate'

  return (
    <div className="overflow-hidden rounded-xl border border-ouro/20 bg-white shadow-sm">
      {/* Cabeçalho do card */}
      <div className="flex items-center justify-between gap-3 border-b border-ouro/15 bg-azul-dark/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <Flag code={match.flagHome} size="xs" />
          <span>{match.teamHome}</span>
          <span className="rounded bg-azul-dark px-2 py-0.5 text-sm font-black text-ouro">
            {match.scoreHome} × {match.scoreAway}
          </span>
          <span>{match.teamAway}</span>
          <Flag code={match.flagAway} size="xs" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Image src="/zebra.png" alt="Zebra" width={18} height={18} />
          <span className="text-[10px] font-semibold text-gray-400">{formatDate(match.matchDatetime)}</span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Resultado + distribuição */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {resultLabel} · apenas {pct(
              match.actualResult === 'H' ? match.homeCount :
              match.actualResult === 'A' ? match.awayCount :
              match.drawCount,
              match.totalBets
            )}% apostaram nisso
          </p>
          <DistributionBar match={match} />
        </div>

        {/* Acordeão: Quem Mitou */}
        {match.scorers.length > 0 ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800">
              <span className="transition group-open:rotate-90">▶</span>
              <span>Quem Mitou ({match.scorers.length} participante{match.scorers.length !== 1 ? 's' : ''})</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {match.scorers.map(s => (
                <ScorerBadge key={s.participantId} scorer={s} />
              ))}
            </div>
          </details>
        ) : (
          <p className="text-xs text-gray-300">Nenhum participante acertou essa zebra.</p>
        )}
      </div>
    </div>
  )
}

// ── Aba 2: Almanaque das Zebras ──────────────────────────────────────────────

function AlmanaqueTab({ zebraMatches }: { zebraMatches: ZebraMatch[] }) {
  if (zebraMatches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-gray-400">
        <Image src="/zebra.png" alt="" width={48} height={48} className="opacity-30" />
        <p className="text-sm">Nenhuma zebra confirmada ainda.</p>
        <p className="text-xs">Os resultados surpreendentes aparecerão aqui conforme os jogos avançarem.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {zebraMatches.map(match => (
        <ZebraMatchCard key={match.id} match={match} />
      ))}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export function ZebrasClient({ zebraMatches, ranking, threshold }: Props) {
  const [tab, setTab] = useState<'mitos' | 'almanaque'>('mitos')
  const [sortKey, setSortKey] = useState<SortKey>('pts')
  const [sortAsc, setSortAsc] = useState(false)
  const router = useRouter()

  // Sincronização em tempo real: atualiza quando scores ou apostas mudam
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('zebras-realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => {
        router.refresh()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => {
        router.refresh()
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [router])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortedRanking = [...ranking]
    .sort((a, b) => {
      const diff = b[sortKey] - a[sortKey]
      return sortAsc ? -diff : diff
    })
    .map((entry, i) => ({ ...entry, zebraRank: i + 1 }))

  const totalZebras = zebraMatches.length

  return (
    <main className="min-h-screen bg-gray-50 pb-12">
      {/* Cabeçalho */}
      <div className="bg-azul-dark py-5 text-center shadow">
        <div className="flex items-center justify-center gap-2">
          <Image src="/zebra.png" alt="" width={28} height={28} className="shrink-0" />
          <h1 className="text-xl font-black tracking-tight text-ouro sm:text-2xl">Zebras</h1>
          <Image src="/zebra.png" alt="" width={28} height={28} className="shrink-0 scale-x-[-1]" />
        </div>
        <p className="mt-1 text-xs text-white/60 sm:text-sm">
          O raio-x dos palpites improváveis · resultados apostados por ≤ {threshold}%
        </p>
        {totalZebras > 0 && (
          <p className="mt-0.5 text-xs font-semibold text-ouro/80">
            {totalZebras} zebra{totalZebras !== 1 ? 's' : ''} confirmada{totalZebras !== 1 ? 's' : ''} até agora
          </p>
        )}
      </div>

      {/* Abas */}
      <div className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl px-4">
          <TabButton active={tab === 'mitos'} onClick={() => setTab('mitos')}>
            🏆 Mitos das Zebras
          </TabButton>
          <TabButton active={tab === 'almanaque'} onClick={() => setTab('almanaque')}>
            📖 Almanaque
          </TabButton>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="mx-auto max-w-4xl px-4 pt-6">
        {tab === 'mitos' && (
          <MitosTab
            ranking={sortedRanking}
            sortKey={sortKey}
            sortAsc={sortAsc}
            onSort={handleSort}
          />
        )}
        {tab === 'almanaque' && (
          <AlmanaqueTab zebraMatches={zebraMatches} />
        )}
      </div>
    </main>
  )
}
