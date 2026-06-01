'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveUserProfile } from '@/app/auth/actions'

const PADRINHOS = ['Bruninho','Cadu','Daniel','Guga','Luizinho','Medel','Nando "Sapo"','Teixeira']

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-verde-400 focus:outline-none'

interface Props { initialName: string }

export function CompletarPerfilForm({ initialName }: Props) {
  const [name,     setName]     = useState(initialName)
  const [whatsapp, setWhatsapp] = useState('')
  const [padrinho, setPadrinho] = useState('')
  const [apelido,  setApelido]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim())     { setError('Nome é obrigatório.'); return }
    if (!whatsapp.trim()) { setError('WhatsApp é obrigatório.'); return }
    if (!padrinho)        { setError('Selecione o padrinho no bolão.'); return }

    setLoading(true)
    try {
      await saveUserProfile(name.trim(), whatsapp.trim(), padrinho, apelido.trim())
      router.push('/aguardando-aprovacao')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar. Tente novamente.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">Nome completo</label>
        <input type="text" required autoComplete="name"
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Seu nome" className={inputCls} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">WhatsApp (com DDD)</label>
        <input type="tel" required autoComplete="tel"
          value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
          placeholder="(11) 99999-9999" className={inputCls} />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">Padrinho no bolão</label>
        <select required value={padrinho} onChange={e => setPadrinho(e.target.value)} className={inputCls}>
          <option value="">— selecione —</option>
          {PADRINHOS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-500">
          Apelido no bolão <span className="font-normal text-gray-400">(opcional)</span>
        </label>
        <input type="text" value={apelido} onChange={e => setApelido(e.target.value)}
          placeholder="Como quer ser chamado? (opcional)" className={inputCls} />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      <button type="submit" disabled={loading}
        className="w-full rounded-lg py-3 text-sm font-bold text-white transition disabled:opacity-60"
        style={{ backgroundColor: '#009c3b' }}>
        {loading ? 'Salvando...' : 'Continuar'}
      </button>
    </form>
  )
}
