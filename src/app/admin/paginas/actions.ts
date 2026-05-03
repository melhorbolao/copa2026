'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { getPageVisibility } from '@/lib/page-visibility'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return null
  return createAuthAdminClient() as any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function updatePageVisibility(
  pageName: string,
  field: 'show_for_admin' | 'show_for_users',
  value: boolean,
): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: 'Sem permissão' }

  // Pull the full current row (merges DB rows with in-memory defaults)
  const allRows = await getPageVisibility()
  const row = allRows.find(r => r.page_name === pageName)
  if (!row) return { error: 'Página não encontrada' }

  const { error } = await admin.from('page_visibility').upsert(
    {
      page_name:      row.page_name,
      label:          row.label,
      show_for_admin: field === 'show_for_admin' ? value : row.show_for_admin,
      show_for_users: field === 'show_for_users' ? value : row.show_for_users,
      sort_order:     row.sort_order,
    },
    { onConflict: 'page_name' },
  )

  if (error) return { error: error.message }
  revalidatePath('/admin/paginas')
  return {}
}

export async function updatePageOrders(
  orders: { page_name: string; sort_order: number }[],
): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: 'Sem permissão' }

  const allRows = await getPageVisibility()
  const rowMap = Object.fromEntries(allRows.map(r => [r.page_name, r]))

  const payload = orders
    .map(({ page_name, sort_order }) => {
      const row = rowMap[page_name]
      if (!row) return null
      return {
        page_name,
        label:          row.label,
        show_for_admin: row.show_for_admin,
        show_for_users: row.show_for_users,
        sort_order,
      }
    })
    .filter(Boolean)

  const { error } = await admin
    .from('page_visibility')
    .upsert(payload, { onConflict: 'page_name' })

  if (error) return { error: error.message }
  revalidatePath('/admin/paginas')
  return {}
}

export async function updatePageLabel(
  pageName: string,
  label: string,
): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!admin) return { error: 'Sem permissão' }

  const allRows = await getPageVisibility()
  const row = allRows.find(r => r.page_name === pageName)
  if (!row) return { error: 'Página não encontrada' }

  const { error } = await admin.from('page_visibility').upsert(
    {
      page_name:      row.page_name,
      label:          label.trim(),
      show_for_admin: row.show_for_admin,
      show_for_users: row.show_for_users,
      sort_order:     row.sort_order,
    },
    { onConflict: 'page_name' },
  )

  if (error) return { error: error.message }
  revalidatePath('/admin/paginas')
  return {}
}
