'use server'

import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Sem permissão')
}

export async function updateTeam(
  name: string,
  fields: { abbr_br?: string; abbr_fifa?: string; group_name?: string },
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const admin = createAuthAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from('teams').update(fields).eq('name', name)
    if (error) return { error: error.message }
    revalidatePath('/admin/equipes')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
