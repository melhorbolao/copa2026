'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { notifyAdminNewUser } from '@/lib/email'
import { isEmailEnabled } from '@/lib/email-settings'

// ── Verifica se e-mail já existe na tabela de usuários ───────────────────────
export async function checkEmailExists(email: string): Promise<boolean> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle()
  return !!data
}

// ── Cria perfil imediatamente após signUp (antes da confirmação de e-mail)
export async function createPendingUserProfile(
  userId: string,
  name: string,
  email: string,
  whatsapp: string,
  padrinho: string,
  apelido = '',
  bio = '',
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
    bio:       bio.trim() || null,
  })
}

// ── Salva/atualiza perfil do usuário autenticado (fluxo OAuth)
export async function saveUserProfile(
  name: string,
  whatsapp: string,
  padrinho: string,
  apelido = '',
  bio = '',
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
      bio:      bio.trim() || null,
    })
    .eq('id', user.id)

  if (error) throw new Error(error.message)

  // Notifica admin apenas no primeiro preenchimento de perfil (fluxo OAuth)
  if (isNewUser && await isEmailEnabled('notify_new_user')) {
    try {
      await notifyAdminNewUser({ name: name.trim(), email: user.email ?? '' })
    } catch { /* silent */ }
  }

  revalidatePath('/')
}
