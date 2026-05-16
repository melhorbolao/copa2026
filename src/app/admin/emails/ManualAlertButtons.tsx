'use client'

import { useState, useTransition } from 'react'
import { sendBonusAlert } from '../actions'

type AlertType = 'all' | 'incomplete' | 'receipt'

const ALERTS: Array<{
  type: AlertType
  label: string
  description: string
  defaultSubject: string
  defaultBody: string
}> = [
  {
    type: 'all',
    label: 'Aviso do prazo a todos',
    description: 'Envia a todos os participantes (completos e incompletos) com Excel de palpites em anexo. Recomendado ~24h antes do prazo.',
    defaultSubject: '⏰ Prazo se encerrando — envie seus palpites até 08/06',
    defaultBody: `Olá, {nome}!

O prazo para envio dos palpites da Copa do Mundo 2026 se encerra em 08/06/2026 às 23h59 (horário de Brasília).

Se ainda não preencheu tudo — grupos, fase final e artilheiro —, é hora de correr! Depois do prazo, os palpites ficam bloqueados para alteração.

Seus palpites atuais estão no arquivo Excel em anexo. Confira se está tudo como você quer antes da hora fechar.

Boa sorte! 🏆`,
  },
  {
    type: 'incomplete',
    label: 'Aviso de palpites incompletos',
    description: 'Envia somente aos participantes sem campeão preenchido, com Excel em anexo. Recomendado ~24h antes do prazo.',
    defaultSubject: '⚠️ Seus palpites estão incompletos — prazo em 08/06',
    defaultBody: `Olá, {nome}!

Notamos que seus palpites ainda estão incompletos. O prazo encerra em 08/06/2026 às 23h59 (horário de Brasília) — depois disso não será possível alterar nada.

Pode ser que falte preencher: classificação dos grupos, chaveamento da fase final ou artilheiro. Tudo isso conta ponto!

O arquivo Excel em anexo mostra o que já foi registrado até agora. Acesse o sistema e finalize antes que o prazo feche.

Não perca esta chance! ⚽`,
  },
  {
    type: 'receipt',
    label: 'Comprovante de palpites',
    description: 'Envia a todos com o Excel de palpites como comprovante. Recomendado imediatamente após o encerramento do prazo.',
    defaultSubject: '✅ Seus palpites foram registrados — Copa do Mundo 2026',
    defaultBody: `Olá, {nome}!

O prazo de palpites foi encerrado. Seus palpites estão registrados e prontos para pontuar!

No arquivo Excel em anexo você encontra o comprovante completo de tudo que foi enviado.

Que vença o melhor! 🏆🎉`,
  },
]

function AlertCard({ type, label, description, defaultSubject, defaultBody }: typeof ALERTS[number]) {
  const [open,    setOpen]   = useState(false)
  const [subject, setSubject] = useState(defaultSubject)
  const [body,    setBody]   = useState(defaultBody)
  const [result,  setResult] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const handleSend = () => {
    setResult(null)
    startTransition(async () => {
      try {
        const { sent } = await sendBonusAlert(type, subject, body)
        setResult(`✓ ${sent} e-mail${sent !== 1 ? 's' : ''} enviado${sent !== 1 ? 's' : ''} com sucesso.`)
      } catch (err) {
        setResult(`Erro: ${err instanceof Error ? err.message : 'Falha ao enviar.'}`)
      }
    })
  }

  if (!open) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition"
          style={{ backgroundColor: '#002776' }}
        >
          Enviar
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">{label}</h3>
        <button
          onClick={() => { setOpen(false); setResult(null) }}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
        >×</button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">Assunto</label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-gray-600">
          Corpo <span className="font-normal text-gray-400">(use {'{nome}'} para personalizar)</span>
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={7}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none resize-none font-mono"
        />
      </div>

      <p className="mt-2 text-xs text-gray-500">
        📎 Excel de palpites de cada participante será anexado automaticamente.
      </p>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSend}
          disabled={pending || !body.trim() || !subject.trim()}
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

export function ManualAlertButtons() {
  return (
    <div className="space-y-3">
      {ALERTS.map(a => <AlertCard key={a.type} {...a} />)}
    </div>
  )
}
