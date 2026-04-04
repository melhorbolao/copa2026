'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { notifyAdminNewUser } from '@/lib/email'

// ── Cria perfil imediatamente após signUp (antes da confirmação de e-mail)
export async function createPendingUserProfile(
  userId: string,
  name: string,
  email: string,
  whatsapp: string,
  padrinho: string,
  apelido = '',
) {
  const supabase = await createAdminClient()

  const { data: existing } = await supabase
    .from('users').select('id').eq('id', userId).single()
  if (existing) return

  await supabase.from('users').insert({
    id:        userId,
    name:      name.trim(),
    email,
    whatsapp:  whatsapp.trim(),
    padrinho:  padrinho || null,
    apelido:   apelido.trim() || null,
    provider:  'email',
    status:    'email_pendente',
    approved:  false,
    paid:      false,
    is_admin:  false,
    is_manual: false,
  })
}

// ── Salva/atualiza perfil do usuário autenticado (fluxo OAuth)
export async function saveUserProfile(
  name: string,
  whatsapp: string,
  padrinho: string,
  apelido = '',
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: existing } = await supabase
    .from('users')
    .select('whatsapp')
    .eq('id', user.id)
    .single()

  const isNewUser = !existing?.whatsapp

  const { error } = await supabase
    .from('users')
    .update({
      name:     name.trim(),
      whatsapp: whatsapp.trim(),
      padrinho: padrinho || null,
      apelido:  apelido.trim() || null,
    })
    .eq('id', user.id)

  if (error) throw new Error(error.message)

  // Notifica admin apenas no primeiro preenchimento de perfil (fluxo OAuth)
  if (isNewUser) {
    try {
      await notifyAdminNewUser({ name: name.trim(), email: user.email ?? '' })
    } catch { /* silent */ }
  }

  revalidatePath('/')
}
