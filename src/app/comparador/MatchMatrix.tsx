'use client'

import { useState, useMemo } from 'react'
import { Flag } from '@/components/ui/Flag'
import { formatBrasilia } from '@/utils/date'
import type { MatchDuelRow, DuelStatus } from './engine'
import { STATUS_LABEL, STATUS_ICON } from './engine'

const STATUS_COLOR: Record<DuelStatus, string> = {
  same_score:    'bg-verde-100 text-verde-800',
  same_column:   'bg-blue-100 text-blue-700',
  exact_vs_zero: 'bg-purple-100 text-purple-800',
  zebra_vs_fav:  'bg-orange-100 text-orange-800',
  diff_column:   'bg-gray-100 text-gray-600',
  concordant:    'bg-teal-50 text-teal-700',
  battlefield:   'bg-red-50 text-red-700',
  zebra_battle:  'bg-orange-50 text-orange-700',
  no_bets:       'bg-gray-50 text-gray-400',
  hidden:        'bg-gray-50 text-gray-300',
}

const PHASE_LABEL: Record<string, string> = {
  group:         'Grupos',
  round_of_32:   '16avos',
  round_of_16:   'Oitavas',
  quarterfinal:  'Quartas',
  semifinal:     'Semi',
  third_place:   '3º Lugar',
  final:         'Final',
}

type FilterType = 'all' | 'played' | 'future' | 'battlefield' | 'diff' | 'exact_vs_zero' | 'zebra'

interface Props {
  rows: MatchDuelRow[]
  nameA: string
  nameB: string
}

export function MatchMatrix({ rows, nameA, nameB }: Props) {
  const [filter, setFilter] = useState<FilterType>('all')
  const [showGroup, setShowGroup] = useState(true)
  const [showKnockout, setShowKnockout] = useState(true)

  const filtered = useMemo(() => {
    // Linhas com status 'hidden' (prazo aberto) são exibidas com 🔒 em vez de omitidas
    let r = rows
    if (!showGroup)   r = r.filter(row => row.match.phase !== 'group')
    if (!showKnockout) r = r.filter(row => row.match.phase === 'group')
    switch (filter) {
      case 'played':        return r.filter(row => row.match.scoreHome !== null)
      case 'future':        return r.filter(row => row.match.scoreHome === null)
      case 'battlefield':   return r.filter(row => row.status === 'battlefield' || row.status === 'zebra_battle')
      case 'diff':          return r.filter(row => ['diff_column','zebra_vs_fav','battlefield','zebra_battle','exact_vs_zero'].includes(row.status))
      case 'exact_vs_zero': return r.filter(row => row.status === 'exact_vs_zero')
      case 'zebra':         return r.filter(row => row.status === 'zebra_vs_fav' || row.status === 'zebra_battle' || row.match.isZebra)
      default:              return r
    }
  }, [rows, filter, showGroup, showKnockout])

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all',          label: 'Todos' },
    { key: 'played',       label: 'Realizados' },
    { key: 'future',       label: 'Futuros' },
    { key: 'diff',         label: '⚔️ Batalhas' },
    { key: 'exact_vs_zero', label: '🎯 Cravou vs Zerou' },
    { key: 'zebra',        label: '⚡ Zebra' },
  ]

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              filter === f.key
                ? 'bg-azul-escuro text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showGroup} onChange={e => setShowGroup(e.target.checked)} className="rounded" />
            Grupos
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={showKnockout} onChange={e => setShowKnockout(e.target.checked)} className="rounded" />
            Mata-Mata
          </label>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-2">{filtered.length} jogos</p>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide text-[10px]">
            <tr>
              <th className="px-2 py-2 text-left w-6">#</th>
              <th className="px-2 py-2 text-right">Jogo</th>
              <th className="px-2 py-2 text-center w-12">Result.</th>
              <th className="px-2 py-2 text-center w-20">Palpite {nameA.split(' ')[0]}</th>
              <th className="px-2 py-2 text-center w-10 font-bold text-azul-escuro">Pts A</th>
              <th className="px-2 py-2 text-center w-10 font-bold text-red-500">Pts B</th>
              <th className="px-2 py-2 text-center w-20">Palpite {nameB.split(' ')[0]}</th>
              <th className="px-2 py-2 text-center">Status</th>
              <th className="px-2 py-2 text-center w-12">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  Nenhum jogo neste filtro.
                </td>
              </tr>
            )}
            {filtered.map(row => {
              const { match, betA, betB, ptsA, ptsB, delta, status } = row
              const played = match.scoreHome !== null
              const isHidden = status === 'hidden'

              return (
                <tr
                  key={match.id}
                  className={`hover:bg-gray-50 ${match.isBrazil ? 'bg-verde-50/20' : ''}`}
                >
                  {/* Match number + phase */}
                  <td className="px-2 py-1.5 text-gray-400 font-mono">
                    <div>{match.matchNumber}</div>
                    <div className="text-[9px] text-gray-300">{PHASE_LABEL[match.phase] ?? match.phase}</div>
                  </td>

                  {/* Teams */}
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <span className="text-gray-700">{match.teamHome}</span>
                      <Flag code={match.flagHome} size="xs" />
                    </div>
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap mt-0.5">
                      <span className="text-gray-700">{match.teamAway}</span>
                      <Flag code={match.flagAway} size="xs" />
                    </div>
                    {match.isZebra && played && (
                      <span className="text-[9px] text-orange-500">⚡ zebra</span>
                    )}
                  </td>

                  {/* Official result */}
                  <td className="px-2 py-1.5 text-center font-bold text-gray-800">
                    {played
                      ? `${match.scoreHome} – ${match.scoreAway}`
                      : <span className="text-gray-300 text-[10px]">{formatBrasilia(match.matchDatetime, 'dd/MM HH:mm')}</span>
                    }
                  </td>

                  {/* Bet A */}
                  <td className="px-2 py-1.5 text-center">
                    {betA
                      ? <span className={`font-mono ${row.colA === row.realCol && played ? 'text-verde-600 font-bold' : 'text-gray-600'}`}>
                          {betA.scoreHome}–{betA.scoreAway}
                          {row.aOnMinority && <span className="ml-0.5 text-orange-500">⚡</span>}
                        </span>
                      : isHidden
                        ? <span className="text-gray-300 text-[11px]" title="Prazo em aberto">🔒</span>
                        : <span className="text-gray-300">—</span>
                    }
                  </td>

                  {/* Pts A */}
                  <td className="px-2 py-1.5 text-center font-bold text-azul-escuro">
                    {played && betA ? (ptsA > 0 ? `+${ptsA}` : '0') : ''}
                  </td>

                  {/* Pts B */}
                  <td className="px-2 py-1.5 text-center font-bold text-red-500">
                    {played && betB ? (ptsB > 0 ? `+${ptsB}` : '0') : ''}
                  </td>

                  {/* Bet B */}
                  <td className="px-2 py-1.5 text-center">
                    {betB
                      ? <span className={`font-mono ${row.colB === row.realCol && played ? 'text-verde-600 font-bold' : 'text-gray-600'}`}>
                          {betB.scoreHome}–{betB.scoreAway}
                          {row.bOnMinority && <span className="ml-0.5 text-orange-500">⚡</span>}
                        </span>
                      : isHidden
                        ? <span className="text-gray-300 text-[11px]" title="Prazo em aberto">🔒</span>
                        : <span className="text-gray-300">—</span>
                    }
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLOR[status]}`}>
                      {STATUS_ICON[status]} {STATUS_LABEL[status]}
                    </span>
                  </td>

                  {/* Delta */}
                  <td className="px-2 py-1.5 text-center font-bold">
                    {played && (betA || betB) ? (
                      <span className={delta > 0 ? 'text-azul-escuro' : delta < 0 ? 'text-red-500' : 'text-gray-400'}>
                        {delta > 0 ? `+${delta}` : delta < 0 ? delta : '='}
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
