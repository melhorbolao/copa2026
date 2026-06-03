'use client'

import { useState, useMemo } from 'react'
import { useProgressTransition } from '@/hooks/useProgressTransition'
import { ParticipantRow } from './ParticipantRow'
import { CreateParticipantModal } from './CreateParticipantModal'
import { PagantesNote } from './PagantesNote'
import { getParticipantesSummaryText } from './actions'

type PaymentFilter = 'all' | 'paid' | 'pending'
type FillFilter    = 'all' | 'zerado' | 'parcial' | 'completo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Participant = any
type User = { id: string; name: string; apelido: string | null; whatsapp: string | null; padrinho: string | null }

interface Props {
  participants:    Participant[]
  users:           User[]
  pagantesNote:    string
  betFillByPid:    Record<string, 'zerado' | 'parcial' | 'completo'>
  currentStageName: string | null
}

export function ParticipantsClient({ participants, users, pagantesNote, betFillByPid, currentStageName }: Props) {
  const [paymentFilter,    setPaymentFilter]    = useState<PaymentFilter>('all')
  const [fillFilter,       setFillFilter]       = useState<FillFilter>('all')
  const [searchText,       setSearchText]       = useState('')
  const [selectedPadrinho, setSelectedPadrinho] = useState<string>('all')
  const [copied,           setCopied]           = useState(false)
  const [isPending,        startTransition]     = useProgressTransition()

  const handleCopyResumo = () => {
    startTransition(async () => {
      const text = await getParticipantesSummaryText()
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        // Fallback: user activation pode expirar durante a server action
        const el = document.createElement('textarea')
        el.value = text
        el.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
        document.body.appendChild(el)
        el.focus()
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  // Mapa user_id → padrinho para filtro eficiente
  const userPadrinhoMap = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const u of users) map.set(u.id, u.padrinho)
    return map
  }, [users])

  // Lista única de padrinhos existentes
  const padrinhos = useMemo(() => {
    const set = new Set<string>()
    for (const u of users) { if (u.padrinho) set.add(u.padrinho) }
    return [...set].sort()
  }, [users])

  const total           = participants.length
  const pagos           = participants.filter(p => p.paid).length
  const pendentes       = total - pagos
  const pagantesExtras  = pagantesNote ? pagantesNote.split('\n').filter(l => l.trim()).length : 0
  const totalArrecadado = (pagos + pagantesExtras) * 250

  // Contagens de preenchimento para os chips de filtro
  const zeradoCount   = currentStageName ? participants.filter(p => betFillByPid[p.id] === 'zerado').length   : 0
  const parcialCount  = currentStageName ? participants.filter(p => betFillByPid[p.id] === 'parcial').length  : 0
  const completoCount = currentStageName ? participants.filter(p => betFillByPid[p.id] === 'completo').length : 0

  const visible = participants
    .filter(p => {
      if (paymentFilter === 'paid')    return p.paid
      if (paymentFilter === 'pending') return !p.paid
      return true
    })
    .filter(p => {
      if (fillFilter === 'all') return true
      return betFillByPid[p.id] === fillFilter
    })
    .filter(p => {
      if (!searchText.trim()) return true
      const q = searchText.toLowerCase()
      if (p.apelido.toLowerCase().includes(q)) return true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return p.user_participants.some((up: any) => up.users?.name?.toLowerCase().includes(q))
    })
    .filter(p => {
      if (selectedPadrinho === 'all') return true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return p.user_participants.some((up: any) => userPadrinhoMap.get(up.user_id) === selectedPadrinho)
    })

  const hasActiveFilters =
    paymentFilter !== 'all' || fillFilter !== 'all' ||
    searchText.trim() !== '' || selectedPadrinho !== 'all'

  const clearAll = () => {
    setPaymentFilter('all')
    setFillFilter('all')
    setSearchText('')
    setSelectedPadrinho('all')
  }

  return (
    <div>
      {/* Cards-filtro de pagamento */}
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FilterCard
          label="Participantes" value={total} color="gray"
          active={paymentFilter === 'all' && fillFilter === 'all'}
          onToggle={clearAll}
        />
        <FilterCard
          label="Pagos" value={pagos} color="verde"
          active={paymentFilter === 'paid'}
          onToggle={() => setPaymentFilter(paymentFilter === 'paid' ? 'all' : 'paid')}
        />
        <FilterCard
          label="Pendentes" value={pendentes} color="orange"
          active={paymentFilter === 'pending'}
          onToggle={() => setPaymentFilter(paymentFilter === 'pending' ? 'all' : 'pending')}
        />
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-3xl font-black text-emerald-700">
            {totalArrecadado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
          </p>
          <p className="mt-0.5 text-xs font-medium text-emerald-700">Arrecadado</p>
          <p className="mt-1 text-[10px] text-emerald-500">
            {pagos} pagos + {pagantesExtras} sem cadastro
          </p>
        </div>
      </div>

      {/* Chips de filtro por preenchimento de palpites */}
      {currentStageName && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-400">
            Palpites {currentStageName}:
          </span>
          <FillChip
            label="Zerado" count={zeradoCount}
            color="red"
            active={fillFilter === 'zerado'}
            onToggle={() => setFillFilter(fillFilter === 'zerado' ? 'all' : 'zerado')}
          />
          <FillChip
            label="Parcial" count={parcialCount}
            color="amber"
            active={fillFilter === 'parcial'}
            onToggle={() => setFillFilter(fillFilter === 'parcial' ? 'all' : 'parcial')}
          />
          <FillChip
            label="Completo" count={completoCount}
            color="green"
            active={fillFilter === 'completo'}
            onToggle={() => setFillFilter(fillFilter === 'completo' ? 'all' : 'completo')}
          />
        </div>
      )}

      {/* Filtros de texto e padrinho */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Pesquisar por nome do participante ou usuário…"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-700 placeholder-gray-400 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 transition"
              aria-label="Limpar pesquisa"
            >
              ×
            </button>
          )}
        </div>

        {padrinhos.length > 0 && (
          <select
            value={selectedPadrinho}
            onChange={e => setSelectedPadrinho(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white py-1.5 px-3 text-sm text-gray-700 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            <option value="all">Todos os padrinhos</option>
            {padrinhos.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}

        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm hover:bg-gray-50 transition"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">
          {!hasActiveFilters
            ? <>Gerencie os participantes do bolão · ★ = usuário primário</>
            : <><span className="font-semibold">{visible.length}</span> de {total} participante{total !== 1 ? 's' : ''} · filtro ativo</>
          }
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={handleCopyResumo}
            disabled={isPending}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
          >
            {isPending ? 'Gerando…' : copied ? '✓ Copiado!' : 'Copiar resumo'}
          </button>
          <PagantesNote initialText={pagantesNote} />
          <CreateParticipantModal users={users} />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Nenhum participante encontrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Nome no Bolão</th>
                  <th className="px-3 py-3">Bio</th>
                  <th className="px-3 py-3">Pagamento</th>
                  <th className="px-3 py-3">Usuários com acesso</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p, i) => (
                  <ParticipantRow key={p.id} participant={p} index={i} allUsers={users} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {pagos}/{total} pagos
      </p>
    </div>
  )
}

// ── FilterCard ────────────────────────────────────────────────────────────────

interface FilterCardProps {
  label:    string
  value:    number
  color:    string
  active:   boolean
  onToggle: () => void
}

function FilterCard({ label, value, color, active, onToggle }: FilterCardProps) {
  const base: Record<string, string> = {
    gray:   'border-gray-200   text-gray-700',
    verde:  'border-verde-200  text-verde-700',
    orange: 'border-orange-200 text-orange-700',
  }
  const bg: Record<string, string> = {
    gray:   active ? 'bg-gray-200'   : 'bg-gray-50   hover:bg-gray-100',
    verde:  active ? 'bg-verde-200'  : 'bg-verde-50  hover:bg-verde-100',
    orange: active ? 'bg-orange-200' : 'bg-orange-50 hover:bg-orange-100',
  }

  return (
    <button
      onClick={onToggle}
      className={`rounded-xl border p-4 text-center transition w-full ${base[color]} ${bg[color]} ${active ? 'ring-2 ring-offset-1 ' + ringColor(color) : ''}`}
    >
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
      {active && <p className="mt-1 text-[10px] opacity-60">filtro ativo · clique para remover</p>}
    </button>
  )
}

function ringColor(color: string) {
  if (color === 'verde')  return 'ring-verde-400'
  if (color === 'orange') return 'ring-orange-400'
  return 'ring-gray-400'
}

// ── FillChip ──────────────────────────────────────────────────────────────────

interface FillChipProps {
  label:    string
  count:    number
  color:    'red' | 'amber' | 'green'
  active:   boolean
  onToggle: () => void
}

function FillChip({ label, count, color, active, onToggle }: FillChipProps) {
  const styles: Record<FillChipProps['color'], { on: string; off: string }> = {
    red:   { on: 'bg-red-600   text-white', off: 'bg-red-50   text-red-600   hover:bg-red-100'   },
    amber: { on: 'bg-amber-500 text-white', off: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
    green: { on: 'bg-green-600 text-white', off: 'bg-green-50 text-green-700 hover:bg-green-100' },
  }
  return (
    <button
      onClick={onToggle}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${active ? styles[color].on : styles[color].off}`}
    >
      {label} · {count}
    </button>
  )
}
