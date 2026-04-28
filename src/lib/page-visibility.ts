import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface PageVisibilityRow {
  id: string
  page_name: string
  label: string
  show_for_admin: boolean
  show_for_users: boolean
  sort_order: number
}

const PAGE_ORDER = [
  'jogos', 'palpites', 'tabela', 'acopa', 'tabelaMB', 'classificacaoMB',
  'participantes', 'pontuacao', 'regulamento',
]

// Memoized per request — deduplicates calls from Sidebar, Navbar, and page components
export const getPageVisibility = cache(async (): Promise<PageVisibilityRow[]> => {
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('page_visibility')
      .select('id, page_name, label, show_for_admin, show_for_users, sort_order')
    const rows = (data ?? []) as PageVisibilityRow[]
    return rows.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      const ai = PAGE_ORDER.indexOf(a.page_name)
      const bi = PAGE_ORDER.indexOf(b.page_name)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  } catch {
    return []
  }
})

export function isPageVisible(
  rows: PageVisibilityRow[],
  pageName: string,
  isAdmin: boolean,
): boolean {
  const row = rows.find(r => r.page_name === pageName)
  if (!row) return true // safe default when table not yet created
  return isAdmin ? row.show_for_admin : row.show_for_users
}

// Call in page server components after resolving isAdmin
export async function requirePageAccess(pageName: string, isAdmin: boolean): Promise<void> {
  const rows = await getPageVisibility()
  if (!isPageVisible(rows, pageName, isAdmin)) redirect('/')
}
