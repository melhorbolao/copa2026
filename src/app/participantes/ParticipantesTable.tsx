'use client'

import { useState, useMemo } from 'react'

const STAGE_KEYS = ['r1','r2','r3','r32','r16','qf','sf','final'] as const
type StageKey = typeof STAGE_KEYS[number]

const STAGE_LABELS: Record<StageKey, string> = {
  r1:'R1', r2:'R2', r3:'R3', r32:'16av', r16:'Oit', qf:'Qrt', sf:'Semi', final:'Final',
}

export type StageKind = 'unavailable' | 'cut' | 'open'

export interface StageData {
  kind: StageKind
  pct: number
  lastSaved: string | null
  missingTip: string | null
}

export interface TableRow {
  id: string
  apelido: string
  paid: boolean
  eliminated: boolean
  g4Errors: string[] | null
  stages: StageData[]   // aligned with STAGE_KEYS order
}

interface StageMeta {
  label: string
  deadline: string | null  // already formatted by server
}

interface Props {
  rows: TableRow[]
  activeFilter: string   // view: ativos | todos
  paymentFilter: string  // pagamento: pago | pendente | ''
  fillFilter: string     // palpite: completo | incompleto | ''
  hasAnyEliminated: boolean
  nextStageIdx: number | null
  stageMeta: StageMeta[]
  stageTotals: number[]
  hasAnyError: boolean
}

type SortCol = 'nome' | 'pagamento' | 'erros' | number

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-0.5 text-[9px] text-gray-300">⇅</span>
  return <span className="ml-0.5 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

const fmtPct    = (v: number) => v === -1 ? '—' : `${v}%`
const pctCls = (v: number) =>
  v === -1  ? 'text-gray-300' :
  v === 100 ? 'text-verde-600 font-bold' :
  v > 0     ? 'text-amber-600' : 'text-red-400'

export function ParticipantesTable({
  rows, activeFilter, paymentFilter, fillFilter, hasAnyEliminated, nextStageIdx, stageMeta, stageTotals, hasAnyError,
}: Props) {
  const [nameQuery, setNameQuery] = useState('')
  const [sortCol, setSortCol]     = useState<SortCol | null>(null)
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const display = useMemo(() => {
    const isActivesView =
      activeFilter === 'ativos' ||
      (activeFilter === '' && hasAnyEliminated)

    let result = rows.filter(r => {
      // View: ativos / todos
      if (isActivesView && r.eliminated) return false

      // Pagamento (combinável)
      if (paymentFilter === 'pendente' && r.paid)  return false
      if (paymentFilter === 'pago'    && !r.paid)  return false

      // Preenchimento da rodada (combinável)
      if (fillFilter && nextStageIdx !== null) {
        const pct = r.stages[nextStageIdx].pct
        if (fillFilter === 'zerado')    { if (pct !== 0)                   return false }
        if (fillFilter === 'parcial')   { if (!(pct > 0 && pct < 100))     return false }
        if (fillFilter === 'completo')  { if (pct !== 100)                  return false }
        if (fillFilter === 'incompleto'){ if (!(pct !== -1 && pct < 100))   return false }
      }

      return true
    })

    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase()
      result = result.filter(r => r.apelido.toLowerCase().includes(q))
    }

    if (sortCol !== null) {
      result = [...result].sort((a, b) => {
        let cmp = 0
        if (sortCol === 'nome') {
          cmp = a.apelido.localeCompare(b.apelido, 'pt-BR', { sensitivity: 'base' })
        } else if (sortCol === 'pagamento') {
          cmp = (a.paid === b.paid ? 0 : a.paid ? -1 : 1)
        } else if (sortCol === 'erros') {
          cmp = (b.g4Errors ? 1 : 0) - (a.g4Errors ? 1 : 0)
        } else {
          const pa = a.stages[sortCol as number]?.pct ?? -1
          const pb = b.stages[sortCol as number]?.pct ?? -1
          cmp = pb - pa
        }
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [rows, activeFilter, paymentFilter, fillFilter, hasAnyEliminated, nextStageIdx, nameQuery, sortCol, sortDir])

  const displayPaidCount  = display.filter(r => r.paid).length
  const displayFullPct    = stageTotals.map((total, i) =>
    total > 0 ? display.filter(r => r.stages[i].pct === 100).length : -1
  )
  const totalCount = rows.length

  const Th = ({ col, children, className }: { col: SortCol; children: React.ReactNode; className?: string }) => (
    <button
      type="button"
      onClick={() => handleSort(col)}
      className={`inline-flex items-center gap-0 cursor-pointer select-none hover:text-gray-800 transition-colors ${
        sortCol === col ? 'text-gray-900 font-bold' : ''
      } ${className ?? ''}`}
    >
      {children}
      <SortIcon active={sortCol === col} dir={sortDir} />
    </button>
  )

  return (
    <>
      {/* Campo de busca por nome */}
      <div className="mb-4">
        <div className="relative w-full sm:max-w-xs">
          <input
            type="text"
            value={nameQuery}
            onChange={e => setNameQuery(e.target.value)}
            placeholder="Filtrar por nome…"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-azul-escuro focus:outline-none"
          />
          {nameQuery && (
            <button
              type="button"
              onClick={() => setNameQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-base leading-none"
              aria-label="Limpar busca"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-3 w-8">#</th>
                <th className="px-3 py-3">
                  <Th col="nome">Nome</Th>
                </th>
                <th className="px-3 py-3 text-center">
                  <Th col="pagamento">Pagamento</Th>
                </th>
                <th className="px-2 py-3 text-center w-8" title="Erros de lógica">
                  {hasAnyError ? <Th col="erros">⚠️</Th> : '⚠️'}
                </th>
                {stageMeta.map((s, i) => (
                  <th key={`${STAGE_KEYS[i]}-header`} className="px-2 py-3 text-center">
                    <Th col={i}>{s.label}</Th>
                    {s.deadline && (
                      <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-gray-400">
                        {s.deadline}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Linha de totais */}
            <tbody>
              <tr className="border-b-2 border-gray-200 bg-gray-50/80 text-xs font-semibold text-gray-600">
                <td className="px-3 py-2" />
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                  {display.length === totalCount
                    ? `${totalCount} inscritos`
                    : `${display.length} de ${totalCount}`}
                </td>
                <td className="px-3 py-2 text-center">
                  <span className="text-verde-700">{displayPaidCount} pagos</span>
                  {displayPaidCount < display.length && (
                    <span className="ml-1 text-red-400">/ {display.length - displayPaidCount} pend.</span>
                  )}
                </td>
                <td className="px-2 py-2" />
                {stageTotals.map((total, i) => (
                  <td key={`${STAGE_KEYS[i]}-total`} className="px-2 py-2 text-center">
                    {total > 0 ? (
                      <span className={displayFullPct[i] === display.length ? 'text-verde-600' : 'text-gray-500'}>
                        {displayFullPct[i]}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>

            <tbody>
              {display.map((r, i) => (
                <tr
                  key={r.id}
                  className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${r.eliminated ? 'bg-gray-50/70' : ''}`}
                >
                  <td className="px-3 py-2.5 text-xs text-gray-400">{i + 1}</td>
                  <td className={`px-3 py-2.5 whitespace-nowrap font-medium ${r.eliminated ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-900'}`}>
                    <span className="inline-flex items-center gap-1.5">
                      {r.apelido}
                      {r.eliminated && (
                        <span
                          title="Eliminado: não classificado para a fase atual (regulamento 27–30)"
                          className="inline-block rounded-full bg-gray-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-600"
                        >
                          Cortado
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {r.paid ? (
                      <span className="inline-block rounded-full bg-verde-100 px-2.5 py-0.5 text-xs font-semibold text-verde-700">✓ Pago</span>
                    ) : (
                      <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">✗ Pendente</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    {r.g4Errors ? (
                      <span title={r.g4Errors.join('\n')} className="cursor-help text-sm text-red-500">⚠️</span>
                    ) : (
                      <span className="text-xs text-gray-200">✓</span>
                    )}
                  </td>
                  {r.stages.map((s, si) => {
                    if (s.kind === 'unavailable') {
                      return (
                        <td key={si} className="px-2 py-2 text-center">
                          <div className="text-xs tabular-nums text-gray-300" title="Etapa ainda não disponível para preenchimento">—</div>
                        </td>
                      )
                    }
                    if (s.kind === 'cut') {
                      return (
                        <td key={si} className="px-2 py-2 text-center">
                          <div className="text-xs tabular-nums text-gray-400" title="Participante cortado nesta fase (regulamento 27–30)">✗</div>
                        </td>
                      )
                    }
                    return (
                      <td key={si} className="px-2 py-2 text-center">
                        <div
                          className={`text-xs tabular-nums ${pctCls(s.pct)}${s.missingTip ? ' cursor-help underline decoration-dotted underline-offset-2' : ''}`}
                          title={s.missingTip ?? undefined}
                        >
                          {fmtPct(s.pct)}
                        </div>
                        {s.lastSaved && (
                          <div className="text-[10px] text-gray-300 tabular-nums leading-tight">{s.lastSaved}</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {display.length === 0 && (
                <tr>
                  <td colSpan={4 + stageMeta.length} className="px-4 py-8 text-center text-sm text-gray-400">
                    Nenhum participante encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {display.length === totalCount
          ? `${totalCount} participantes`
          : `${display.length} de ${totalCount} participantes`}
      </p>
    </>
  )
}
