'use client'

import { useState, useRef } from 'react'
import { clearAllBets, clearAllResults } from './actions'

type Msg = { type: 'ok' | 'error'; text: string }
type ConflictMsg = { type: 'conflict'; conflicts: string[]; file: File }

export function DadosAdminClient() {
  // ── Export ────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false)

  // ── Clear bets ────────────────────────────────────────────────
  const [confirmBets, setConfirmBets]     = useState(false)
  const [clearingBets, setClearingBets]   = useState(false)
  const [clearBetsMsg, setClearBetsMsg]   = useState<Msg | null>(null)

  // ── Clear results ─────────────────────────────────────────────
  const [confirmResults, setConfirmResults]   = useState(false)
  const [clearingResults, setClearingResults] = useState(false)
  const [clearResultsMsg, setClearResultsMsg] = useState<Msg | null>(null)

  // ── Import ────────────────────────────────────────────────────
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting]     = useState(false)
  const [importMsg, setImportMsg]     = useState<Msg | null>(null)
  const [conflict, setConflict]       = useState<ConflictMsg | null>(null)
  const [execResolution, setExecResolution] = useState<'overwrite' | 'skip' | null>(null)

  // ── Handlers ──────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/admin/dados/export')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const blob      = await res.blob()
      const url       = URL.createObjectURL(blob)
      const name      = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'palpites.xlsx'
      const a         = document.createElement('a')
      a.href          = url
      a.download      = name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Erro ao exportar: ' + (e instanceof Error ? e.message : 'desconhecido'))
    } finally {
      setExporting(false)
    }
  }

  const handleClearBets = async () => {
    setClearingBets(true)
    setClearBetsMsg(null)
    try {
      await clearAllBets()
      setClearBetsMsg({ type: 'ok', text: 'Todos os palpites foram removidos e pontuações zeradas.' })
      setConfirmBets(false)
    } catch (e) {
      setClearBetsMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally {
      setClearingBets(false)
    }
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
    } finally {
      setClearingResults(false)
    }
  }

  const resetImport = () => {
    setImportMsg(null)
    setConflict(null)
    setExecResolution(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFileChange = async (file: File) => {
    setImporting(true)
    setImportMsg(null)
    setConflict(null)

    const form = new FormData()
    form.append('file', file)
    form.append('mode', 'check')

    try {
      const res  = await fetch('/api/admin/dados/import', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) {
        setImportMsg({ type: 'error', text: data.error ?? `HTTP ${res.status}` })
        return
      }

      if (data.conflicts?.length > 0) {
        setConflict({ type: 'conflict', conflicts: data.conflicts, file })
      } else {
        await runImport(file, 'overwrite')
      }
    } catch (e) {
      setImportMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro ao verificar arquivo' })
    } finally {
      setImporting(false)
    }
  }

  const runImport = async (file: File, res: 'overwrite' | 'skip') => {
    setImporting(true)
    setExecResolution(res)

    const form = new FormData()
    form.append('file', file)
    form.append('mode', 'execute')
    form.append('resolution', res)

    try {
      const response = await fetch('/api/admin/dados/import', { method: 'POST', body: form })
      const data     = await response.json()

      if (!response.ok) {
        setImportMsg({ type: 'error', text: data.error ?? 'Erro ao importar' })
      } else {
        const skippedNote = data.skipped > 0 ? ` ${data.skipped} participante(s) com palpites mantidos.` : ''
        setImportMsg({
          type: 'ok',
          text: `Importação concluída: ${data.participants} participante(s), ${data.matches} palpites de jogos, ${data.bonus} bônus.${skippedNote}`,
        })
        setConflict(null)
        if (fileRef.current) fileRef.current.value = ''
      }
    } catch (e) {
      setImportMsg({ type: 'error', text: e instanceof Error ? e.message : 'Erro desconhecido' })
    } finally {
      setImporting(false)
      setExecResolution(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-10 max-w-2xl">

      {/* ── EXPORT ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Exportar todos os palpites</h3>
        <p className="mb-3 text-xs text-gray-500">
          Baixa uma planilha Excel com os palpites de todos os participantes em um único arquivo.
          Este arquivo pode ser reimportado pelo sistema.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded border border-verde-300 bg-verde-50 px-3 py-1.5 text-xs font-semibold text-verde-700 hover:bg-verde-100 disabled:opacity-60 transition"
        >
          {exporting ? 'Exportando…' : 'Exportar Excel'}
        </button>
      </section>

      <hr className="border-gray-100" />

      {/* ── CLEAR BETS ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Limpar todos os palpites</h3>
        <p className="mb-3 text-xs text-gray-500">
          Remove permanentemente todos os palpites de todos os participantes e zera as pontuações.
          Os resultados oficiais dos jogos são mantidos.
        </p>
        {!confirmBets ? (
          <button
            onClick={() => { setConfirmBets(true); setClearBetsMsg(null) }}
            className="inline-flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition"
          >
            Limpar todos os palpites
          </button>
        ) : (
          <div className="rounded border border-red-200 bg-red-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-red-800">
              Tem certeza? Esta ação apaga todos os palpites e não pode ser desfeita.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearBets}
                disabled={clearingBets}
                className="rounded border border-red-500 bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition"
              >
                {clearingBets ? 'Removendo…' : 'Sim, apagar tudo'}
              </button>
              <button
                onClick={() => setConfirmBets(false)}
                disabled={clearingBets}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {clearBetsMsg && (
          <p className={`mt-2 text-xs font-medium ${clearBetsMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {clearBetsMsg.text}
          </p>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* ── CLEAR RESULTS ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Limpar todos os resultados oficiais</h3>
        <p className="mb-3 text-xs text-gray-500">
          Apaga todos os placares registrados nos jogos e zera as pontuações calculadas.
          Os palpites dos participantes são mantidos.
        </p>
        {!confirmResults ? (
          <button
            onClick={() => { setConfirmResults(true); setClearResultsMsg(null) }}
            className="inline-flex items-center gap-1.5 rounded border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100 transition"
          >
            Limpar todos os resultados
          </button>
        ) : (
          <div className="rounded border border-orange-200 bg-orange-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-orange-800">
              Tem certeza? Todos os placares e pontuações calculadas serão apagados.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClearResults}
                disabled={clearingResults}
                className="rounded border border-orange-500 bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-60 transition"
              >
                {clearingResults ? 'Limpando…' : 'Sim, limpar tudo'}
              </button>
              <button
                onClick={() => setConfirmResults(false)}
                disabled={clearingResults}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
        {clearResultsMsg && (
          <p className={`mt-2 text-xs font-medium ${clearResultsMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {clearResultsMsg.text}
          </p>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* ── IMPORT ── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Importar palpites de planilha</h3>
        <p className="mb-3 text-xs text-gray-500">
          Importa palpites de múltiplos participantes a partir de uma planilha no formato da exportação acima.
          As colunas de pontuação calculada são ignoradas.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFileChange(f)
          }}
        />

        {!conflict && (
          <button
            onClick={() => { resetImport(); fileRef.current?.click() }}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 transition"
          >
            {importing ? 'Verificando…' : 'Selecionar planilha (.xlsx)'}
          </button>
        )}

        {conflict && (
          <div className="rounded border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3 w-fit">
            <p className="text-xs font-semibold text-amber-800">
              Os participantes abaixo já têm palpites registrados:
            </p>
            <ul className="text-xs text-amber-700 list-disc ml-4 columns-2 gap-x-6">
              {conflict.conflicts.map(name => <li key={name}>{name}</li>)}
            </ul>
            <p className="text-xs text-amber-700 font-medium">Como deseja prosseguir?</p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => runImport(conflict.file, 'overwrite')}
                disabled={importing}
                className="rounded border border-amber-500 bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60 transition"
              >
                {importing && execResolution === 'overwrite' ? 'Importando…' : 'Substituir palpites existentes'}
              </button>
              <button
                onClick={() => runImport(conflict.file, 'skip')}
                disabled={importing}
                className="rounded border border-gray-400 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition"
              >
                {importing && execResolution === 'skip' ? 'Importando…' : 'Manter existentes (importar só novos)'}
              </button>
              <button
                onClick={resetImport}
                disabled={importing}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-50 disabled:opacity-60 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {importMsg && (
          <p className={`mt-3 text-xs font-medium ${importMsg.type === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
            {importMsg.text}
          </p>
        )}
      </section>
    </div>
  )
}
