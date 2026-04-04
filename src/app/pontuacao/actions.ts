'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function updateScoringRule(key: string, points: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) throw new Error('Acesso negado')

  const admin = await createAdminClient()
  const { error } = await admin
    .from('scoring_rules')
    .update({ points })
    .eq('key', key)

  if (error) throw new Error(error.message)
  revalidatePath('/pontuacao')
}
