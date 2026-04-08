'use client'

import { useState, useTransition } from 'react'
import { updatePhaseDeadline, updateMatchDeadline } from '@/app/admin/actions'
import type { PhaseGroup, MatchDeadlineRow } from './page'

// ── Helpers de fuso horário ──────────────────────────────────────────────────
// Brasil não usa horário de verão desde 2019: sempre UTC-3.

/** ISO UTC → string para input datetime-local (horário de Brasília) */
function isoToBRT(iso: string): string {
  const d = new Date(iso)
  // -3h em ms
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 16)
}

/** String do input datetime-local (BRT) → ISO UTC para o banco */
function brtToISO(local: string): string {
  return new Date(local + ':00-03:00').toISOString()
}

/** Formata para exibição: "11/06 14:30 (BRT)" */
function fmt(iso: string): string {
  const d = new Date(iso)
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())} BRT`
}

// ── Componente principal ─────────────────────────────────────────────────────

interface Props { phases: PhaseGroup[] }

export function PrazosClient({ phases }: Props) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        Todos os horários são exibidos e editados em <strong>horário de Brasília (BRT, UTC-3)</strong>.
        Salvar atualiza o prazo imediatamente para todos os participantes.
      </div>

      {phases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-400">
          Nenhuma partida cadastrada.
        </div>
      ) : (
        phases.map(phase => (
          <PhaseCard key={phase.phase} group={phase} />
        ))
      )}
    </div>
  )
}

// ── Card de fase ─────────────────────────────────────────────────────────────

function PhaseCard({ group }: { group: PhaseGroup }) {
  const [expanded, setExpanded] = useState(false)
  const [bulkValue, setBulkValue] = useState(
    isoToBRT(group.sharedDeadline ?? group.minDeadline)
  )
  const [bulkPending, startBulk] = useTransition()
  const [bulkError, setBulkError] = useState('')
  const [bulkSaved, setBulkSaved] = useState(false)

  const handleBulkSave = () => {
    if (!bulkValue) return
    setBulkError('')
    setBulkSaved(false)
    startBulk(async () => {
      try {
        await updatePhaseDeadline(group.phase, brtToISO(bulkValue))
        setBulkSaved(true)
        setTimeout(() => setBulkSaved(false), 3000)
      } catch (e) {
        setBulkError(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  const isVaried = group.sharedDeadline === null

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
        <div>
          <span className="text-sm font-bold text-gray-900">{group.label}</span>
          <span className="ml-2 text-xs text-gray-400">{group.matches.length} partida{group.matches.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isVaried ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Prazos variados
            </span>
          ) : (
            <span className="rounded-full bg-verde-100 px-2 py-0.5 text-[11px] font-semibold text-verde-700">
              {fmt(group.sharedDeadline!)}
            </span>
          )}
          {group.matches.length > 1 && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-azul-escuro underline hover:opacity-70"
            >
              {expanded ? 'Ocultar partidas' : 'Partida a partida'}
            </button>
          )}
        </div>
      </div>

      {/* Bulk edit */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-4">
        <div className="flex-1 min-w-48">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            {group.matches.length > 1
              ? `Prazo único para todas as ${group.matches.length} partidas`
              : 'Prazo da partida'}
          </label>
          <input
            type="datetime-local"
            value={bulkValue}
            onChange={e => { setBulkValue(e.target.value); setBulkSaved(false) }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-azul-escuro focus:outline-none focus:ring-1 focus:ring-azul-escuro"
          />
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={handleBulkSave}
            disabled={bulkPending || !bulkValue}
            className="rounded-lg bg-azul-escuro px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bulkPending ? 'Salvando…' : bulkSaved ? '✓ Salvo' : 'Salvar'}
          </button>
          {isVaried && (
            <span className="text-[10px] text-gray-400">
              {fmt(group.minDeadline)} → {fmt(group.maxDeadline)}
            </span>
          )}
        </div>
        {bulkError && (
          <p className="w-full text-xs text-red-600">{bulkError}</p>
        )}
      </div>

      {/* Tabela individual (expansível) */}
      {expanded && group.matches.length > 1 && (
        <div className="border-t border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-12">#</th>
                <th className="px-4 py-2 text-left font-medium">Partida</th>
                <th className="px-4 py-2 text-left font-medium">Prazo atual</th>
                <th className="px-4 py-2 text-left font-medium">Novo prazo</th>
                <th className="px-3 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {group.matches.map(match => (
                <MatchDeadlineRow key={match.id} match={match} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Linha de partida individual ───────────────────────────────────────────────

function MatchDeadlineRow({ match }: { match: MatchDeadlineRow }) {
  const [value, setValue] = useState(isoToBRT(match.betting_deadline))
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const isDirty = value !== isoToBRT(match.betting_deadline)

  const handleSave = () => {
    if (!value) return
    setError('')
    setSaved(false)
    start(async () => {
      try {
        await updateMatchDeadline(match.id, brtToISO(value))
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro')
      }
    })
  }

  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2.5 font-mono text-gray-400">{match.match_number}</td>
      <td className="px-4 py-2.5 text-gray-700">
        <span className="font-medium">{match.team_home}</span>
        <span className="mx-1 text-gray-300">×</span>
        <span className="font-medium">{match.team_away}</span>
      </td>
      <td className="px-4 py-2.5 text-gray-400">{fmt(match.betting_deadline)}</td>
      <td className="px-4 py-2.5">
        <input
          type="datetime-local"
          value={value}
          onChange={e => { setValue(e.target.value); setSaved(false) }}
          className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-azul-escuro focus:outline-none focus:ring-1 focus:ring-azul-escuro"
        />
        {error && <p className="mt-0.5 text-[10px] text-red-500">{error}</p>}
      </td>
      <td className="px-3 py-2.5">
        <button
          onClick={handleSave}
          disabled={pending || !isDirty}
          className="rounded-lg bg-azul-escuro px-3 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {pending ? '…' : saved ? '✓' : 'Salvar'}
        </button>
      </td>
    </tr>
  )
}
