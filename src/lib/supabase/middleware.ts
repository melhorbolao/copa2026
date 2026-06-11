import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { canAccessPage, type UserRole } from '@/lib/permissions'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Server Actions são enviados como POST com o header 'next-action'.
  // O middleware não deve redirecionar esses requests — a validação de auth
  // é feita pela própria action. Um redirect aqui causa "Server Components render error".
  const isServerAction = !!request.headers.get('next-action')

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

  const publicPaths = ['/', '/login', '/regulamento', '/confirmar-email', '/privacidade', '/termos']
  const isPublicPath =
    publicPaths.includes(pathname) ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/cron/')

  // Server Actions não devem ser redirecionadas — a auth é validada pela action
  if (isServerAction) return supabaseResponse

  // 1. Não autenticado → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && !isPublicPath) {
    const { data: profile } = await supabase
      .from('users')
      .select('status, whatsapp, padrinho, is_manual, role')
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

    // 3. E-mail pendente → redireciona para aguardando aprovação
    if (status === 'email_pendente' && !bypassPaths.includes(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/aguardando-aprovacao'
      return NextResponse.redirect(url)
    }

    // 4. Aguardando aprovação do admin
    if (status === 'aprovacao_pendente' && !bypassPaths.includes(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/aguardando-aprovacao'
      return NextResponse.redirect(url)
    }

    // 5. Proteção de rotas /admin/*
    const segments = pathname.split('/')
    if (segments[1] === 'admin') {
      const role = (profile?.role ?? 'user') as UserRole

      // Não é admin nem master → home
      if (role !== 'admin' && role !== 'master') {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        return NextResponse.redirect(url)
      }

      // Master acessa tudo sem restrição
      if (role === 'master') return supabaseResponse

      // Admin: valida página específica
      const pageKey = segments[2] ?? ''

      // Página exclusiva do master
      if (pageKey === 'acessos') {
        const url = request.nextUrl.clone()
        url.pathname = '/acesso-negado'
        return NextResponse.redirect(url)
      }

      // Índice /admin → deixa passar (admin/page.tsx redireciona para 1ª página permitida)
      if (!pageKey) return supabaseResponse

      // allowed_pages armazenado em app_metadata (zero queries extras)
      const allowedGroups = (user.app_metadata?.allowed_pages as string[] | undefined) ?? []
      if (!canAccessPage('admin', allowedGroups, pageKey)) {
        const url = request.nextUrl.clone()
        url.pathname = '/acesso-negado'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}
