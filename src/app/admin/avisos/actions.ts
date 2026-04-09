'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')
}

export async function createAlert(data: {
  message: string
  start_at: string   // ISO UTC
  end_at: string | null  // ISO UTC or null
}) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from('admin_alerts').insert({
    message:  data.message.trim(),
    start_at: data.start_at,
    end_at:   data.end_at ?? null,
    is_active: true,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/admin/avisos')
}

export async function deactivateAlert(id: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from('admin_alerts')
    .update({ is_active: false })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/avisos')
}

export async function deleteAlert(id: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from('admin_alerts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/avisos')
}
