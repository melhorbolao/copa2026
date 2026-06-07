import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyAdminNewUser } from '@/lib/email'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code       = requestUrl.searchParams.get('code')
  const token_hash = requestUrl.searchParams.get('token_hash')
  const type       = requestUrl.searchParams.get('type') as EmailOtpType | null
  const next       = requestUrl.searchParams.get('next') ?? '/palpites'
  const error      = requestUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=${error}`)
  }

  // ── Fluxo OTP / recuperação de senha (token_hash + type) ─────────────────
  // Ocorre quando o link de recuperação é aberto em browser/dispositivo
  // diferente do que fez o pedido (sem o verifier PKCE em cookie) ou quando
  // o projeto Supabase não usa PKCE para e-mails de recovery.
  if (token_hash && type) {
    const supabase = await createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!verifyError) {
      if (type === 'recovery') {
        return NextResponse.redirect(`${requestUrl.origin}/auth/redefinir-senha`)
      }
      return NextResponse.redirect(`${requestUrl.origin}${next}`)
    }

    return NextResponse.redirect(`${requestUrl.origin}/login?error=link_invalido`)
  }

  // ── Fluxo PKCE (code) ─────────────────────────────────────────────────────
  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      // Fluxo de recuperação de senha — redireciona direto para redefinição
      if (next === '/auth/redefinir-senha') {
        return NextResponse.redirect(`${requestUrl.origin}/auth/redefinir-senha`)
      }

      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: existing } = await supabase
          .from('users')
          .select('id, status, whatsapp, padrinho, name')
          .eq('id', user.id)
          .single()

        if (!existing) {
          // ── Primeiro acesso via OAuth (sem perfil pré-criado) ─────────
          const name     = user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? 'Usuário'
          const provider = user.app_metadata?.provider ?? 'email'

          await supabase.from('users').insert({
            id: user.id, name, email: user.email!, provider,
            status: 'aprovacao_pendente', approved: false, paid: false, is_admin: false,
          })

          // OAuth nunca fornece whatsapp/padrinho — sempre exige completar perfil
          return NextResponse.redirect(`${requestUrl.origin}/completar-perfil`)
        }

        // ── Confirmação de e-mail (status transita de email_pendente) ──
        if (existing.status === 'email_pendente') {
          await supabase
            .from('users')
            .update({ status: 'aprovacao_pendente' })
            .eq('id', user.id)

          try {
            await notifyAdminNewUser({ name: existing.name ?? user.email!, email: user.email! })
          } catch { /* silent */ }

          return NextResponse.redirect(`${requestUrl.origin}/aguardando-aprovacao`)
        }

        // Usuário já existente — verifica se perfil está completo (whatsapp + padrinho)
        if (!existing.whatsapp || !existing.padrinho) {
          return NextResponse.redirect(`${requestUrl.origin}/completar-perfil`)
        }

        if (existing.status !== 'aprovado') {
          return NextResponse.redirect(`${requestUrl.origin}/aguardando-aprovacao`)
        }
      }

      return NextResponse.redirect(`${requestUrl.origin}${next}`)
    }
  }

  return NextResponse.redirect(`${requestUrl.origin}/login?error=auth_error`)
}
