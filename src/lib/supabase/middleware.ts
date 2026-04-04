import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  const publicPaths = ['/', '/login', '/regulamento', '/confirmar-email']
  const isPublicPath =
    publicPaths.includes(pathname) || pathname.startsWith('/auth/')

  // 1. Não autenticado → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && !isPublicPath) {
    const { data: profile } = await supabase
      .from('users')
      .select('status, whatsapp, padrinho, is_manual')
      .eq('id', user.id)
      .single()

    // 2. Perfil incompleto → completar perfil (apenas usuários não-manuais)
    const profileComplete = profile?.is_manual || (!!profile?.whatsapp && !!profile?.padrinho)
    if (!profileComplete && pathname !== '/completar-perfil') {
      const url = request.nextUrl.clone()
      url.pathname = '/completar-perfil'
      return NextResponse.redirect(url)
    }

    const status = profile?.status ?? 'aprovacao_pendente'
    const bypassPaths = ['/completar-perfil', '/aguardando-aprovacao', '/confirmar-email']

    // 3. E-mail pendente de confirmação
    if (status === 'email_pendente' && !bypassPaths.includes(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/confirmar-email'
      return NextResponse.redirect(url)
    }

    // 4. Aguardando aprovação do admin
    if (status === 'aprovacao_pendente' && !bypassPaths.includes(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/aguardando-aprovacao'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
