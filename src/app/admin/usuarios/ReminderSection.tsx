'use client'

import { useState, useTransition } from 'react'
import { sendReminderEmails } from '../actions'

const STAGES = [
  { value: 'r1',    label: 'Rodada 1'      },
  { value: 'r2',    label: 'Rodada 2'      },
  { value: 'r3',    label: 'Rodada 3'      },
  { value: 'r32',   label: '16 Avos'       },
  { value: 'r16',   label: 'Oitavas'       },
  { value: 'qf',    label: 'Quartas'       },
  { value: 'sf',    label: 'Semifinais'    },
  { value: 'final', label: '3º e Final'    },
]

// Filtros de corte (baseados em quem apostou nas fases posteriores)
const CUT_FILTERS = [
  { value: 'cut1', label: 'Classificados após 1º corte (apostaram nos 16avos)' },
  { value: 'cut2', label: 'Classificados após 2º corte (apostaram nas quartas)' },
]

const DEFAULT_BODY =
  `Olá {nome},

faltam poucos dias para o prazo da próxima etapa. Não se esqueça de enviar seus palpites em:

melhorbolao.app.br

Boa sorte! 🏆`

export function ReminderSection() {
  const [open,           setOpen]       = useState(false)
  const [recipients,     setRecipients] = useState<'all' | 'pending' | 'cut1' | 'cut2'>('all')
  const [stage,          setStage]      = useState('r1')
  const [body,           setBody]       = useState(DEFAULT_BODY)
  const [attachPalpites, setAttachPalpites] = useState(false)
  const [result,         setResult]     = useState<string | null>(null)
  const [pending,        startTransition] = useTransition()

  const handleSend = () => {
    setResult(null)
    startTransition(async () => {
      try {
        const { sent } = await sendReminderEmails(recipients, stage, body, attachPalpites)
        setResult(`✓ ${sent} e-mail${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} com sucesso.`)
      } catch (err) {
        setResult(`Erro: ${err instanceof Error ? err.message : 'Falha ao enviar.'}`)
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition"
        style={{ backgroundColor: '#002776' }}
      >
        📨 Enviar e-mail
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">📨 Enviar e-mail</h3>
        <button onClick={() => { setOpen(false); setResult(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Destinatários */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Destinatários</label>
          <select
            value={recipients}
            onChange={e => setRecipients(e.target.value as 'all' | 'pending' | 'cut1' | 'cut2')}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            <option value="all">Todos os aprovados</option>
            <option value="pending">Aprovados com palpites pendentes na etapa:</option>
            <optgroup label="Filtros de corte">
              {CUT_FILTERS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Etapa (só para "pending") */}
        <div className={recipients !== 'pending' ? 'opacity-40 pointer-events-none' : ''}>
          <label className="mb-1 block text-xs font-semibold text-gray-600">Etapa</label>
          <select
            value={stage}
            onChange={e => setStage(e.target.value)}
            disabled={recipients !== 'pending'}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            {STAGES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Corpo do e-mail */}
      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-gray-600">
          Corpo do e-mail <span className="font-normal text-gray-400">(use {'{nome}'} para personalizar)</span>
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none font-mono"
        />
      </div>

      {/* Checkbox anexo */}
      <label className="mt-3 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={attachPalpites}
          onChange={e => setAttachPalpites(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 accent-blue-600"
        />
        <span className="text-xs text-gray-700">
          Anexar planilha de palpites de cada participante
          <span className="block text-gray-400">
            Se o usuário tiver mais de um participante, todas as planilhas são anexadas.
          </span>
        </span>
      </label>

      {/* Ações */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSend}
          disabled={pending || !body.trim()}
          className="rounded-lg px-5 py-2 text-sm font-bold text-white disabled:opacity-40 transition"
          style={{ backgroundColor: '#002776' }}
        >
          {pending ? 'Enviando…' : 'Confirmar envio'}
        </button>
        <button
          onClick={() => { setOpen(false); setResult(null) }}
          disabled={pending}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancelar
        </button>
        {result && (
          <span className={`text-sm font-medium ${result.startsWith('✓') ? 'text-verde-600' : 'text-red-500'}`}>
            {result}
          </span>
        )}
      </div>
    </div>
  )
}
