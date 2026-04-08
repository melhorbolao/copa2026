'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createPendingUserProfile } from '@/app/auth/actions'

type Mode = 'login' | 'signup' | 'forgot'

export function LoginForm() {
  const [mode, setMode]       = useState<Mode>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [info, setInfo]       = useState('')

  // Campos compartilhados
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')

  // Campos extras do cadastro
  const [name,     setName]     = useState('')
  const [phone,    setPhone]    = useState('')
  const [padrinho, setPadrinho] = useState('')
  const [apelido,  setApelido]  = useState('')

  const router   = useRouter()
  const supabase = createClient()

  const switchMode = (m: Mode) => { setMode(m); setError(''); setInfo('') }

  // ── Google OAuth ──────────────────────────────────────────────
  const handleGoogle = async () => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) { setError('Erro ao conectar com Google.'); setLoading(false) }
  }

  // ── Login com e-mail ─────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.toLowerCase().includes('email not confirmed')) {
        setError('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.')
      } else {
        setError('E-mail ou senha incorretos.')
      }
      setLoading(false)
    } else {
      router.refresh()
    }
  }

  // ── Cadastro com e-mail ───────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim())     { setError('Nome é obrigatório.'); return }
    if (!phone.trim())    { setError('WhatsApp é obrigatório.'); return }
    if (!padrinho.trim()) { setError('Selecione o padrinho no bolão.'); return }

    setLoading(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name.trim(), name: name.trim(), phone: phone.trim(), apelido: apelido.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (signUpError) {
      setError(signUpError.message === 'User already registered'
        ? 'Este e-mail já está cadastrado.'
        : signUpError.message)
      setLoading(false)
      return
    }

    // Cria perfil imediatamente para aparecer no painel admin com status "e-mail pendente"
    if (data.user) {
      try {
        await createPendingUserProfile(data.user.id, name.trim(), email, phone.trim(), padrinho, apelido.trim())
      } catch { /* silent */ }
    }

    setInfo('Após o cadastro, aguarde aprovação do administrador para acessar o Melhor Bolão.')
    router.push('/confirmar-email')
  }

  // ── Recuperação de senha ──────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) { setError('Informe seu e-mail cadastrado.'); return }
    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/redefinir-senha`,
    })
    setLoading(false)
    if (resetError) {
      setError('Não foi possível enviar o e-mail. Verifique o endereço informado.')
    } else {
      setInfo('E-mail de recuperação enviado! Verifique sua caixa de entrada e siga as instruções.')
      setError('')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Google */}
      <button
        type="button"
        onClick={handleGoogle}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
      >
        <GoogleIcon />
        {loading ? 'Aguarde...' : 'Entrar com Google'}
      </button>

      {/* Separador */}
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <div className="h-px flex-1 bg-gray-200" />
        ou
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Tabs */}
      {mode !== 'forgot' && (
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {(['login', 'signup'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
                mode === m
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>
      )}

      {/* Formulário — Esqueci minha senha */}
      {mode === 'forgot' && (
        <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-gray-700">Recuperar senha</p>
          <p className="text-xs text-gray-500">Informe seu e-mail cadastrado e enviaremos um link para redefinir sua senha.</p>
          <Field label="E-mail" id="email-forgot">
            <input
              id="email-forgot" type="email" required autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={inputCls}
            />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          {info  && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{info}</p>}
          <button
            type="submit" disabled={loading}
            className="mt-1 w-full rounded-lg py-3 text-sm font-bold text-white transition disabled:opacity-60"
            style={{ backgroundColor: '#009c3b' }}
          >
            {loading ? 'Enviando…' : 'Enviar link de recuperação'}
          </button>
          <button
            type="button" onClick={() => switchMode('login')}
            className="text-xs text-gray-400 hover:text-gray-600 text-center"
          >
            Voltar ao login
          </button>
        </form>
      )}

      {/* Formulário — Login / Cadastro */}
      {mode !== 'forgot' && (
      <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="flex flex-col gap-3">

        {mode === 'signup' && (
          <>
            <Field label="Nome completo" id="name">
              <input id="name" type="text" required autoComplete="name"
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Seu nome" className={inputCls} />
            </Field>
            <Field label="WhatsApp (com DDD)" id="phone">
              <input id="phone" type="tel" required autoComplete="tel"
                value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="(11) 99999-9999" className={inputCls} />
            </Field>
            <Field label="Padrinho no bolão" id="padrinho">
              <select id="padrinho" required value={padrinho}
                onChange={e => setPadrinho(e.target.value)} className={inputCls}>
                <option value="">— selecione —</option>
                {PADRINHOS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Apelido no bolão (opcional)" id="apelido">
              <input id="apelido" type="text" value={apelido}
                onChange={e => setApelido(e.target.value)}
                placeholder="Como quer ser chamado? (opcional)"
                className={inputCls} />
            </Field>
          </>
        )}

        <Field label="E-mail" id="email">
          <input
            id="email" type="email" required autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className={inputCls}
          />
        </Field>

        <Field label="Senha" id="password">
          <input
            id="password" type="password" required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            minLength={6}
            className={inputCls}
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}
        {info && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{info}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-1 w-full rounded-lg py-3 text-sm font-bold text-white transition disabled:opacity-60"
          style={{ backgroundColor: '#009c3b' }}
        >
          {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>

        {mode === 'login' && (
          <button
            type="button"
            onClick={() => switchMode('forgot')}
            className="text-xs text-gray-400 hover:text-gray-600 text-center"
          >
            Esqueci minha senha
          </button>
        )}
      </form>
      )}
    </div>
  )
}

const PADRINHOS = ['Bruninho','Cadu','Daniel','Guga','Luizinho','Medel','Nando "Sapo"','Teixeira']

const inputCls =
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-verde-400 focus:outline-none'

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-gray-500">
        {label}
      </label>
      {children}
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
