import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notifyAdminNewUser } from '@/lib/email'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code  = requestUrl.searchParams.get('code')
  const next  = requestUrl.searchParams.get('next') ?? '/palpites'
  const error = requestUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${requestUrl.origin}/login?error=${error}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      const { data: { user } } = await supabase.auth.getUser()

      if (user) {
        const { data: existing } = await supabase
          .from('users')
          .select('id, status, phone, name')
          .eq('id', user.id)
          .single()

        if (!existing) {
          // ── Primeiro acesso via OAuth (sem perfil pré-criado) ─────────
          const name     = user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? 'Usuário'
          const phone    = user.user_metadata?.phone ?? null
          const provider = user.app_metadata?.provider ?? 'email'

          await supabase.from('users').insert({
            id: user.id, name, email: user.email!, phone, provider,
            status: 'aprovacao_pendente', approved: false, paid: false, is_admin: false,
          })

          if (!phone) return NextResponse.redirect(`${requestUrl.origin}/completar-perfil`)
          return NextResponse.redirect(`${requestUrl.origin}/aguardando-aprovacao`)
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

        // Usuário já existente e com status avançado
        if (!existing.phone) {
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
