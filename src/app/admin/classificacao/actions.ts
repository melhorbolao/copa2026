'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Sem permissão')
}

export async function updateClassifColVisibility(
  key: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { error } = await admin
      .from('tournament_settings')
      .upsert({ key, value: enabled ? 'true' : 'false' }, { onConflict: 'key' })
    if (error) return { error: error.message }
    revalidatePath('/classificacaoMB')
    revalidatePath('/admin/classificacao')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erro inesperado' }
  }
}
