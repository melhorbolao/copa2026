'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

export async function updatePageVisibility(
  pageName: string,
  field: 'show_for_admin' | 'show_for_users',
  value: boolean,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: 'Sem permissão' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAuthAdminClient() as any)
    .from('page_visibility')
    .update({ [field]: value })
    .eq('page_name', pageName)

  if (error) return { error: error.message }

  revalidatePath('/admin/paginas')
  return {}
}

export async function updatePageLabel(
  pageName: string,
  label: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Não autenticado' }

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return { error: 'Sem permissão' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAuthAdminClient() as any)
    .from('page_visibility')
    .update({ label: label.trim() })
    .eq('page_name', pageName)

  if (error) return { error: error.message }
  revalidatePath('/admin/paginas')
  return {}
}
