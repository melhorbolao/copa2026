'use client'

import { useState, useTransition } from 'react'
import { createManualUser } from '../actions'

const PADRINHOS = ['Bruninho','Cadu','Daniel','Guga','Luizinho','Medel','Nando "Sapo"','Teixeira']

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-verde-400 focus:outline-none'

export function CreateUserModal() {
  const [open, setOpen]         = useState(false)
  const [pending, start]        = useTransition()
  const [error,   setError]     = useState('')
  const [success, setSuccess]   = useState(false)

  const [name,       setName]       = useState('')
  const [email,      setEmail]      = useState('')
  const [whatsapp,   setWhatsapp]   = useState('')
  const [padrinho,   setPadrinho]   = useState('')
  const [apelido,    setApelido]    = useState('')
  const [observacao, setObservacao] = useState('')

  const reset = () => {
    setName(''); setEmail(''); setWhatsapp(''); setPadrinho(''); setApelido(''); setObservacao('')
    setError(''); setSuccess(false)
  }

  const handleClose = () => { setOpen(false); reset() }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim())     { setError('Nome é obrigatório.'); return }
    if (!email.trim())    { setError('E-mail é obrigatório.'); return }
    if (!whatsapp.trim()) { setError('WhatsApp é obrigatório.'); return }
    if (!padrinho)        { setError('Selecione o padrinho.'); return }

    start(async () => {
      try {
        await createManualUser({ name, email, whatsapp, padrinho, apelido, observacao })
        setSuccess(true)
        setTimeout(handleClose, 1200)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao cadastrar.')
      }
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition"
        style={{ backgroundColor: '#009c3b' }}
      >
        + Cadastrar participante
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between rounded-t-2xl bg-gray-900 px-5 py-3">
              <span className="text-sm font-black uppercase tracking-wide text-white">Cadastrar Participante</span>
              <button onClick={handleClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Nome completo *</label>
                  <input type="text" required value={name} onChange={e => setName(e.target.value)}
                    placeholder="Nome do participante" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">E-mail *</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="email@exemplo.com" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">WhatsApp *</label>
                  <input type="tel" required value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
                    placeholder="(11) 99999-9999" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Padrinho no bolão *</label>
                  <select required value={padrinho} onChange={e => setPadrinho(e.target.value)} className={inputCls}>
                    <option value="">— selecione —</option>
                    {PADRINHOS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Apelido no bolão</label>
                  <input type="text" value={apelido} onChange={e => setApelido(e.target.value)}
                    placeholder="Como quer ser chamado? (opcional)" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Observação</label>
                  <textarea value={observacao} onChange={e => setObservacao(e.target.value)}
                    placeholder="Opcional..." rows={2}
                    className={`${inputCls} resize-none`} />
                </div>
              </div>

              <p className="text-xs text-gray-400">
                Participantes cadastrados manualmente entram direto como <strong>Aprovados</strong>.
              </p>

              {error   && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
              {success && <p className="rounded-lg bg-verde-50 px-3 py-2 text-xs text-verde-700 font-semibold">✓ Participante cadastrado!</p>}

              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={pending}
                  className="flex-1 rounded-lg py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: '#009c3b' }}>
                  {pending ? 'Cadastrando…' : 'Cadastrar'}
                </button>
                <button type="button" onClick={handleClose}
                  className="flex-1 rounded-lg py-2.5 text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
