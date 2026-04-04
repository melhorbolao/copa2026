'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function saveRegulamento(content: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')
  const { data: profile } = await supabase.from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')

  const { error } = await supabase
    .from('settings')
    .upsert({ key: 'regulamento', value: content }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  revalidatePath('/regulamento')
}
