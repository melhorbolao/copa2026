'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Flag } from '@/components/ui/Flag'
import type { ZebraMatch, ZebraRankingEntry, ZebraScorer, PotentialUpset, PotentialGroupZebra, PotentialG4Zebra } from './types'

type SortKey = 'pts' | 'cravadas' | 'colunas'
type Tab = 'mitos' | 'almanaque' | 'radar'

interface Props {
  zebraMatches: ZebraMatch[]
  ranking: ZebraRankingEntry[]
  threshold: number
  potentialUpsets: PotentialUpset[]
  potentialGroupZebras: PotentialGroupZebra[]
  potentialG4Zebras: PotentialG4Zebra[]
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

function formatMatchDatetime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}


function phaseLabel(phase: string, round: number | null, groupName: string | null): string {
  if (phase === 'group') return `Grupo ${groupName ?? ''} · Rodada ${round ?? ''}`
  const map: Record<string, string> = {
    round_of_32: '16 avos de final',
    round_of_16: 'Oitavas de final',
    quarterfinal: 'Quartas de final',
    semifinal: 'Semifinal',
    third_place: '3º lugar',
    final: 'Final',
  }
  return map[phase] ?? phase
}

// ── Sub-componentes base ──────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-semibold transition border-b-2 whitespace-nowrap ${
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

// ── Distribuição: Almanaque ───────────────────────────────────────────────────

function DistributionBar({ match }: { match: ZebraMatch }) {
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
              isWinner ? 'border border-ouro/60 bg-amber-50 font-semibold' : 'bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-1">
              {col.flagCode && <Flag code={col.flagCode} size="xs" />}
              <span className={`max-w-[72px] truncate text-center text-[10px] ${isWinner ? 'text-gray-800' : 'text-gray-500'}`}>
                {col.label}
              </span>
              {isWinner && <Image src="/zebra.png" alt="Zebra" width={14} height={14} className="shrink-0" />}
            </div>
            <span className={`text-sm font-bold ${isWinner ? 'text-ouro' : 'text-gray-400'}`}>{p}%</span>
            <span className="text-[9px] text-gray-400">{col.count} apostas</span>
          </div>
        )
      })}
    </div>
  )
}

function ScorerBadge({ scorer }: { scorer: ZebraScorer }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
      scorer.isExact ? 'bg-ouro/15 text-yellow-800' : 'bg-gray-100 text-gray-700'
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
      <div className="space-y-3 px-4 py-3">
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
        {match.scorers.length > 0 ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800">
              <span className="transition group-open:rotate-90">▶</span>
              <span>Quem Mitou ({match.scorers.length} participante{match.scorers.length !== 1 ? 's' : ''})</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {match.scorers.map(s => <ScorerBadge key={s.participantId} scorer={s} />)}
            </div>
          </details>
        ) : (
          <p className="text-xs text-gray-300">Nenhum participante acertou essa zebra.</p>
        )}
      </div>
    </div>
  )
}

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
      {zebraMatches.map(match => <ZebraMatchCard key={match.id} match={match} />)}
    </div>
  )
}

// ── Aba 3: Possíveis Zebras (Radar) ──────────────────────────────────────────

function UpsetDistBar({ upset }: { upset: PotentialUpset }) {
  const cols = [
    { key: 'H' as const, label: upset.teamHome, flag: upset.flagHome, p: upset.homePct },
    { key: 'D' as const, label: 'Empate',        flag: '',              p: upset.drawPct },
    { key: 'A' as const, label: upset.teamAway,  flag: upset.flagAway,  p: upset.awayPct },
  ]
  return (
    <div className="space-y-1.5">
      {/* Colunas de percentual */}
      <div className="flex gap-1">
        {cols.map(col => {
          const isZebra = upset.zebraColumns.includes(col.key)
          return (
            <div
              key={col.key}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5 ${
                isZebra
                  ? 'border border-ouro/60 bg-amber-50'
                  : 'bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-1">
                {col.flag && <Flag code={col.flag} size="xs" />}
                <span className={`max-w-[60px] truncate text-[10px] ${isZebra ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>
                  {col.label}
                </span>
                {isZebra && (
                  <Image src="/zebra.png" alt="alerta zebra" width={12} height={12} className="shrink-0 animate-pulse" />
                )}
              </div>
              <span className={`text-sm font-bold ${isZebra ? 'text-ouro' : 'text-gray-400'}`}>
                {col.p}%
              </span>
            </div>
          )
        })}
      </div>
      {/* Barra horizontal empilhada */}
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-200">
        {cols.map((col, i) => (
          <div
            key={col.key}
            style={{ width: `${col.p}%` }}
            className={`transition-all duration-700 ${
              upset.zebraColumns.includes(col.key)
                ? 'bg-ouro'
                : i === 0 ? 'bg-blue-700' : i === 1 ? 'bg-gray-500' : 'bg-blue-400'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

function PotentialUpsetCard({ upset }: { upset: PotentialUpset }) {
  const pctOf = (c: 'H' | 'D' | 'A') => c === 'H' ? upset.homePct : c === 'A' ? upset.awayPct : upset.drawPct
  const hasZeroBet = upset.zebraColumns.every(c => pctOf(c) === 0)

  return (
    <div className={`overflow-hidden rounded-xl border shadow-sm ${
      hasZeroBet
        ? 'border-gray-200 bg-gray-50 opacity-50'
        : 'border-ouro/40 bg-white'
    }`}>
      <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${
        hasZeroBet
          ? 'border-gray-200 bg-gray-100'
          : 'border-ouro/20 bg-azul-dark/5'
      }`}>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            {phaseLabel(upset.phase, upset.round, upset.groupName)}
            {upset.city ? ` · ${upset.city}` : ''}
          </p>
          <p className="text-[10px] text-gray-400">{formatMatchDatetime(upset.matchDatetime)}</p>
        </div>
        {hasZeroBet && (
          <span className="shrink-0 text-[10px] italic text-gray-400">nenhum apostou</span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <UpsetDistBar upset={upset} />
      </div>
    </div>
  )
}

function PotentialG4Card({ z }: { z: PotentialG4Zebra }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ouro/25 bg-white px-3 py-2.5 shadow-sm">
      <Flag code={z.flagCode} size="xs" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-gray-800">{z.teamName}</p>
        <p className="text-[10px] text-gray-400">qualquer posição G4</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-black text-ouro">{z.pct}%</p>
        <p className="text-[10px] text-gray-400">{z.count}/{z.total}</p>
      </div>
      <Image src="/zebra.png" alt="" width={16} height={16} className="shrink-0 animate-pulse" />
    </div>
  )
}

function PotentialGroupCard({ z }: { z: PotentialGroupZebra }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ouro/25 bg-white px-3 py-2.5 shadow-sm">
      <Flag code={z.flagCode} size="xs" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-gray-800">{z.teamName}</p>
        <p className="text-[10px] text-gray-400">1º do Grupo {z.groupName}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-black text-ouro">{z.pct}%</p>
        <p className="text-[10px] text-gray-400">{z.count}/{z.total}</p>
      </div>
      <Image src="/zebra.png" alt="" width={16} height={16} className="shrink-0 animate-pulse" />
    </div>
  )
}

function PotentialUpsetsTab({
  upsets, groupZebras, g4Zebras,
}: {
  upsets: PotentialUpset[]
  groupZebras: PotentialGroupZebra[]
  g4Zebras: PotentialG4Zebra[]
}) {
  const total = upsets.length + groupZebras.length + g4Zebras.length

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-gray-400">
        <Image src="/zebra.png" alt="" width={48} height={48} className="opacity-30" />
        <p className="text-sm">Nenhuma possível zebra no momento.</p>
        <p className="text-xs">
          Aparecem aqui apostas (jogos, 1º do grupo ou G4) com prazo encerrado,
          jogo/resultado ainda não definido, e algum resultado apostado por ≤ 15%.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-400">
        Apostas com prazo <strong>já encerrado</strong> e resultado <strong>ainda não definido</strong> onde alguma coluna tem ≤ 15% das apostas.
        Distribuição final — apostas bloqueadas.
      </p>

      {upsets.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">⚽ Jogos</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {upsets.map(u => <PotentialUpsetCard key={u.id} upset={u} />)}
          </div>
        </div>
      )}

      {groupZebras.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">🏆 1º do Grupo</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...groupZebras].sort((a, b) => a.groupName.localeCompare(b.groupName)).map(z => <PotentialGroupCard key={`${z.groupName}-${z.teamName}`} z={z} />)}
          </div>
        </div>
      )}

      {g4Zebras.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">🌟 G4 da Copa</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {g4Zebras.map(z => <PotentialG4Card key={z.teamName} z={z} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export function ZebrasClient({ zebraMatches, ranking, threshold, potentialUpsets, potentialGroupZebras, potentialG4Zebras }: Props) {
  const [tab, setTab] = useState<Tab>('mitos')
  const [sortKey, setSortKey] = useState<SortKey>('pts')
  const [sortAsc, setSortAsc] = useState(false)
  const router = useRouter()

  // Realtime: atualiza Almanaque e Mitos quando scores/apostas passadas mudam
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

  // Radar: refresh quando um jogo ganha placar (e desaparece da lista)
  // Não precisamos de polling periódico pois apostas já estão bloqueadas

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
        <h1 className="text-xl font-black tracking-tight text-ouro sm:text-2xl">Zebras</h1>
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
        <div className="mx-auto flex max-w-4xl overflow-x-auto px-4">
          <TabButton active={tab === 'mitos'} onClick={() => setTab('mitos')}>
            🏆 Mitos das Zebras
          </TabButton>
          <TabButton active={tab === 'almanaque'} onClick={() => setTab('almanaque')}>
            📖 Almanaque
          </TabButton>
          <TabButton active={tab === 'radar'} onClick={() => setTab('radar')}>
            📡 Possíveis Zebras
            {(potentialUpsets.length + potentialGroupZebras.length + potentialG4Zebras.length) > 0 && (
              <span className="ml-1.5 rounded-full bg-ouro/20 px-1.5 py-0.5 text-[10px] font-bold text-ouro">
                {potentialUpsets.length + potentialGroupZebras.length + potentialG4Zebras.length}
              </span>
            )}
          </TabButton>
        </div>
      </div>

      {/* Conteúdo */}
      <div className="mx-auto max-w-4xl px-4 pt-6">
        {tab === 'mitos' && (
          <MitosTab ranking={sortedRanking} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
        )}
        {tab === 'almanaque' && (
          <AlmanaqueTab zebraMatches={zebraMatches} />
        )}
        {tab === 'radar' && (
          <PotentialUpsetsTab upsets={potentialUpsets} groupZebras={potentialGroupZebras} g4Zebras={potentialG4Zebras} />
        )}
      </div>
    </main>
  )
}
