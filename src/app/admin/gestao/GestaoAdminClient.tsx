'use client'

import { useState, useRef, useTransition } from 'react'
import { setProductionMode, setRoundReleased, clearAllBets, clearAllResults } from './actions'
import type { RoundInfo } from '@/lib/production-mode'

interface Props {
  productionMode: boolean
  releasedRounds: string[]
  availableRounds: RoundInfo[]
}

type Msg = { type: 'ok' | 'error'; text: string }
type ConflictState = { conflicts: string[]; file: File }

export function GestaoAdminClient({ productionMode: initProdMode, releasedRounds: initReleased, availableRounds }: Props) {
  const [productionMode, setMode]       = useState(initProdMode)
  const [releasedRounds, setReleased]   = useState<Set<string>>(new Set(initReleased))
  const [modePending, startModeTransition]   = useTransition()
  const [roundPending, startRoundTransition] = useTransition()

  // ── Clear bets ────────────────────────────────────────────────
  const [confirmBets, setConfirmBets]   = useState(false)
  const [clearingBets, setClearingBets] = useState(false)
  const [clearBetsMsg, setClearBetsMsg] = useState<Msg | null>(null)

  // ── Clear results ─────────────────────────────────────────────
  const [confirmResults, setConfirmResults]   = useState(false)
  const [clearingResults, setClearingResults] = useState(false)
  const [clearResultsMsg, setClearResultsMsg] = useState<Msg | null>(null)

  // ── Import ────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting]       = useState(false)
  const [importMsg, setImportMsg]       = useState<Msg | null>(null)
  const [conflict, setConflict]         = useState<ConflictState | null>(null)
  const [execResolution, setExecResolution] = useState<'overwrite' | 'skip' | null>(null)

  // ── Mode toggle ───────────────────────────────────────────────

  const handleToggleMode = () => {
    const next = !productionMode
    startModeTransition(async () => {
      setMode(next)
      await setProductionMode(next)
    })
  }

  // ── Round release toggle ──────────────────────────────────────

  const handleToggleRound = (roundKey: string, currentlyReleased: boolean) => {
    const next = !currentlyReleased
    startRoundTransition(async () => {
      setReleased(prev => {
        const s = new Set(prev)
        next ? s.add(roundKey) : s.delete(roundKey)
        return s
      })
      await setRoundReleased(roundKey, next)
    })
  }

  // ── Data management ───────────────────────────────────────────

  const handleClearBets = async () => {
    setClearingBets(true)
    setClearBetsMsg(null)
    try {
      await clearAllBets()
      setClearBetsMsg({ type: 'ok', text: 'Todos os palpites foram removidos e pontuações zeradas.' })
      setConfirmBets(false)
    } catch (e) {
      setClearBetsMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally { setClearingBets(false) }
  }

  const handleClearResults = async () => {
    setClearingResults(true)
    setClearResultsMsg(null)
    try {
      await clearAllResults()
      setClearResultsMsg({ type: 'ok', text: 'Todos os resultados foram apagados e pontuações zeradas.' })
      setConfirmResults(false)
    } catch (e) {
      setClearResultsMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally { setClearingResults(false) }
  }

  const handleExport = async () => {
    try {
      const res = await fetch('/api/admin/dados/export')
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'palpites.xlsx'
      Object.assign(document.createElement('a'), { href: url, download: name }).click()
      URL.revokeObjectURL(url)
    } catch (e) { alert('Erro ao exportar: ' + (e instanceof Error ? e.message : 'desconhecido')) }
  }

  const resetImport = () => {
    setImportMsg(null); setConflict(null); setExecResolution(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFileChange = async (file: File) => {
    setImporting(true); setImportMsg(null); setConflict(null)
    const form = new FormData()
    form.append('file', file); form.append('mode', 'check')
    try {
      const res  = await fetch('/api/admin/dados/import', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setImportMsg({ type: 'error', text: data.error ?? `HTTP ${res.status}` }); return }
      if (data.conflicts?.length > 0) setConflict({ conflicts: data.conflicts, file })
      else await runImport(file, 'overwrite')
    } catch (e) {
      setImportMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao verificar' })
    } finally { setImporting(false) }
  }

  const runImport = async (file: File, res: 'overwrite' | 'skip') => {
    setImporting(true); setExecResolution(res)
    const form = new FormData()
    form.append('file', file); form.append('mode', 'execute'); form.append('resolution', res)
    try {
      const response = await fetch('/api/admin/dados/import', { method: 'POST', body: form })
      const data     = await response.json()
      if (!response.ok) {
        setImportMsg({ type: 'error', text: data.error ?? 'Erro ao importar' })
      } else {
        const note = data.skipped > 0 ? ` ${data.skipped} ignorado(s).` : ''
        setImportMsg({ type: 'ok', text: `Importação concluída: ${data.participants} participante(s), ${data.matches} jogos, ${data.bonus} bônus.${note}` })
        setConflict(null)
        if (fileRef.current) fileRef.current.value = ''
      }
    } catch (e) {
      setImportMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally { setImporting(false); setExecResolution(null) }
  }

  const formatDeadline = (dl: string | null) =>
    dl ? new Date(dl).toLocaleString('pt-BR', { day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit', timeZone:'America/Sao_Paulo' }) : '—'

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-10 max-w-2xl">

      {/* ── MODE BADGE ── */}
      <div className={`rounded-xl border p-4 ${productionMode ? 'border-red-300 bg-red-50' : 'border-green-200 bg-green-50'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={`text-base font-bold ${productionMode ? 'text-red-800' : 'text-green-800'}`}>
              {productionMode ? '🔴 MODO PRODUÇÃO ATIVO' : '🟢 MODO TESTE ATIVO'}
            </p>
            <p className={`mt-1 text-xs leading-relaxed ${productionMode ? 'text-red-700' : 'text-green-700'}`}>
              {productionMode
                ? 'Palpites são ocultados até o prazo expirar E o admin liberar a rodada manualmente. Nenhum dado bruto de apostas em aberto chega ao frontend — nem para o admin.'
                : 'Todos os palpites são visíveis para todos os usuários. Ideal para testes antes do início do torneio.'}
            </p>
          </div>
          <button
            onClick={handleToggleMode}
            disabled={modePending}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              productionMode
                ? 'border-green-300 bg-white text-green-700 hover:bg-green-50'
                : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
            }`}
          >
            {modePending ? '…' : productionMode ? 'Mudar para Modo Teste' : 'Ativar Modo Produção'}
          </button>
        </div>
      </div>

      {/* ── ROUND RELEASE ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Controle de Liberação por Rodada</h3>
        <p className="mb-3 text-xs text-gray-500">
          {productionMode
            ? 'Em Modo Produção, os palpites só ficam visíveis quando o prazo expirar E a rodada estiver liberada abaixo.'
            : 'Em Modo Teste, estas configurações não têm efeito — todos os palpites são visíveis.'}
        </p>
        {availableRounds.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma partida encontrada no banco de dados.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-2">Rodada / Fase</th>
                  <th className="px-3 py-2">Prazo</th>
                  <th className="px-3 py-2 text-center">Liberado</th>
                </tr>
              </thead>
              <tbody>
                {availableRounds.map(round => {
                  const isReleased = releasedRounds.has(round.key)
                  const deadlineExpired = round.deadline ? new Date(round.deadline) <= new Date() : false
                  return (
                    <tr key={round.key} className={`border-b border-gray-50 last:border-0 ${!productionMode ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-700">{round.label}</td>
                      <td className={`px-3 py-2.5 ${deadlineExpired ? 'text-gray-500' : 'font-semibold text-amber-600'}`}>
                        {formatDeadline(round.deadline)}
                        {!deadlineExpired && round.deadline && (
                          <span className="ml-1 text-[10px] text-amber-500">(em aberto)</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => handleToggleRound(round.key, isReleased)}
                          disabled={roundPending || !productionMode}
                          title={!productionMode ? 'Ativo apenas no Modo Produção' : isReleased ? 'Clique para bloquear' : 'Clique para liberar'}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed ${
                            isReleased ? 'bg-verde-600' : 'bg-gray-200'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${isReleased ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* ── EXPORT ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Exportar todos os palpites</h3>
        <p className="mb-3 text-xs text-gray-500">
          Baixa uma planilha Excel com os palpites de todos os participantes.
          {productionMode && ' Em Modo Produção, apenas palpites de rodadas liberadas são incluídos.'}
        </p>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 rounded border border-verde-300 bg-verde-50 px-3 py-1.5 text-xs font-semibold text-verde-700 hover:bg-verde-100 transition"
        >
          Exportar Excel
        </button>
      </section>

      <hr className="border-gray-100" />

      {/* ── CLEAR BETS ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Limpar todos os palpites</h3>
        <p className="mb-3 text-xs text-gray-500">
          Remove permanentemente todos os palpites de todos os participantes e zera as pontuações. Os resultados oficiais são mantidos.
        </p>
        {!confirmBets ? (
          <button onClick={() => { setConfirmBets(true); setClearBetsMsg(null) }}
            className="inline-flex items-center rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition">
            Limpar todos os palpites
          </button>
        ) : (
          <div className="rounded border border-red-200 bg-red-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-red-800">Tem certeza? Esta ação apaga tudo e não pode ser desfeita.</p>
            <div className="flex gap-2">
              <button onClick={handleClearBets} disabled={clearingBets}
                className="rounded border border-red-500 bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition">
                {clearingBets ? 'Removendo…' : 'Sim, apagar tudo'}
              </button>
              <button onClick={() => setConfirmBets(false)} disabled={clearingBets}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {clearBetsMsg && (
          <p className={`mt-2 text-xs font-medium ${clearBetsMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{clearBetsMsg.text}</p>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* ── CLEAR RESULTS ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Limpar todos os resultados oficiais</h3>
        <p className="mb-3 text-xs text-gray-500">
          Apaga todos os placares dos jogos e zera as pontuações calculadas. Os palpites são mantidos.
        </p>
        {!confirmResults ? (
          <button onClick={() => { setConfirmResults(true); setClearResultsMsg(null) }}
            className="inline-flex items-center rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition">
            Limpar todos os resultados
          </button>
        ) : (
          <div className="rounded border border-orange-200 bg-orange-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-orange-800">Tem certeza? Todos os placares e pontuações calculadas serão apagados.</p>
            <div className="flex gap-2">
              <button onClick={handleClearResults} disabled={clearingResults}
                className="rounded border border-orange-500 bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60 transition">
                {clearingResults ? 'Limpando…' : 'Sim, limpar tudo'}
              </button>
              <button onClick={() => setConfirmResults(false)} disabled={clearingResults}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {clearResultsMsg && (
          <p className={`mt-2 text-xs font-medium ${clearResultsMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{clearResultsMsg.text}</p>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* ── IMPORT ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Importar palpites de planilha</h3>
        <p className="mb-3 text-xs text-gray-500">
          Importa palpites de múltiplos participantes a partir de uma planilha no formato da exportação acima.
        </p>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileChange(f) }} />

        {!conflict && (
          <button onClick={() => { resetImport(); fileRef.current?.click() }} disabled={importing}
            className="inline-flex items-center rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 transition">
            {importing ? 'Verificando…' : 'Selecionar planilha (.xlsx)'}
          </button>
        )}

        {conflict && (
          <div className="rounded border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-amber-800">Os participantes abaixo já têm palpites registrados:</p>
            <ul className="text-xs text-amber-700 list-disc ml-4 columns-2 gap-x-6">
              {conflict.conflicts.map(name => <li key={name}>{name}</li>)}
            </ul>
            <p className="text-xs text-amber-700 font-medium">Como deseja prosseguir?</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => runImport(conflict.file, 'overwrite')} disabled={importing}
                className="rounded border border-amber-500 bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60 transition">
                {importing && execResolution === 'overwrite' ? 'Importando…' : 'Substituir existentes'}
              </button>
              <button onClick={() => runImport(conflict.file, 'skip')} disabled={importing}
                className="rounded border border-gray-400 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition">
                {importing && execResolution === 'skip' ? 'Importando…' : 'Manter existentes (só novos)'}
              </button>
              <button onClick={resetImport} disabled={importing}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-50 disabled:opacity-60 transition">
                Cancelar
              </button>
            </div>
          </div>
        )}

        {importMsg && (
          <p className={`mt-3 text-xs font-medium ${importMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{importMsg.text}</p>
        )}
      </section>
    </div>
  )
}
