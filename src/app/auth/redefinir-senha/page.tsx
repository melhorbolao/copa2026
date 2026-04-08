'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function RedefinirSenhaPage() {
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState(false)
  const router  = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não coincidem.'); return }
    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError('Não foi possível redefinir a senha. O link pode ter expirado — solicite um novo.')
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/palpites'), 2500)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-black text-gray-900">Redefinir senha</h1>
        <p className="mb-6 text-sm text-gray-500">Melhor Bolão · Copa 2026</p>

        {success ? (
          <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
            Senha redefinida com sucesso! Redirecionando…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-gray-500">
                Nova senha
              </label>
              <input
                id="password" type="password" required minLength={6}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-verde-400 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-xs font-semibold text-gray-500">
                Confirmar nova senha
              </label>
              <input
                id="confirm" type="password" required minLength={6}
                value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="Repita a nova senha"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-verde-400 focus:outline-none"
              />
            </div>
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
            )}
            <button
              type="submit" disabled={loading}
              className="mt-1 w-full rounded-lg py-3 text-sm font-bold text-white transition disabled:opacity-60"
              style={{ backgroundColor: '#009c3b' }}
            >
              {loading ? 'Salvando…' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
