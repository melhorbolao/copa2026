'use client'

import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

interface Entry {
  participant_id: string
  apelido: string
  pts_total: number
  pts_matches: number
  pts_groups: number
  pts_thirds: number
  pts_tournament: number
  position: number
  tied: boolean
}

interface Props {
  entries: Entry[]
  activeParticipantId: string
}

const ROW_HEIGHT = 44

export function RankingTable({ entries, activeParticipantId }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const paddingTop    = items.length > 0 ? items[0].start : 0
  const paddingBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
        <p className="text-sm text-gray-400">Nenhuma pontuação registrada ainda.</p>
      </div>
    )
  }

  const medal = (pos: number) =>
    pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : null

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div
        ref={parentRef}
        className="overflow-y-auto"
        style={{ maxHeight: '72vh' }}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-12 px-3 py-3 text-center">#</th>
              <th className="px-3 py-3 text-left">Participante</th>
              <th className="hidden px-3 py-3 text-right sm:table-cell" title="Placares">Placares</th>
              <th className="hidden px-3 py-3 text-right sm:table-cell" title="Classificados de grupo">Class.</th>
              <th className="hidden px-3 py-3 text-right sm:table-cell" title="Terceiros classificados">3ºs</th>
              <th className="hidden px-3 py-3 text-right sm:table-cell" title="Torneio (G4 + artilheiro)">Torn.</th>
              <th className="px-3 py-3 text-right font-bold text-gray-700">Pts</th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr><td colSpan={7} style={{ height: paddingTop }} /></tr>
            )}
            {items.map(virtualRow => {
              const e = entries[virtualRow.index]
              const isMe = e.participant_id === activeParticipantId
              const m = medal(e.position)

              return (
                <tr
                  key={e.participant_id}
                  style={{ height: ROW_HEIGHT }}
                  className={`border-b border-gray-100 last:border-0 ${
                    isMe ? 'bg-verde-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="w-12 px-3 py-2.5 text-center">
                    {m ? (
                      <span className="text-base leading-none">{m}</span>
                    ) : (
                      <span className={`tabular-nums text-xs ${e.tied ? 'text-gray-300' : 'text-gray-400'}`}>
                        {e.tied ? '=' : ''}{e.position}º
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-medium ${isMe ? 'text-verde-800' : 'text-gray-900'}`}>
                      {e.apelido}
                    </span>
                    {isMe && (
                      <span className="ml-1.5 rounded-full bg-verde-100 px-1.5 py-0.5 text-[10px] font-semibold text-verde-700">
                        você
                      </span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-gray-500 sm:table-cell">
                    {e.pts_matches}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-gray-500 sm:table-cell">
                    {e.pts_groups}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-gray-500 sm:table-cell">
                    {e.pts_thirds}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-gray-500 sm:table-cell">
                    {e.pts_tournament}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-gray-900">
                    {e.pts_total}
                  </td>
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr><td colSpan={7} style={{ height: paddingBottom }} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
