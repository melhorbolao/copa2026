'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient, createAuthAdminClient } from '@/lib/supabase/server'
import { notifyAdminNewUser } from '@/lib/email'
import { isEmailEnabled } from '@/lib/email-settings'

// ── Cadastro completo via admin (sem e-mail de confirmação do Supabase) ───────
export async function signUpAndCreateProfile(params: {
  email: string
  password: string
  name: string
  phone: string
  padrinho: string
  apelido: string
  bio: string
}): Promise<{ error?: string }> {
  const adminDb   = await createAdminClient()
  const adminAuth = createAuthAdminClient()

  const email = params.email.toLowerCase().trim()

  // Verifica duplicidade
  const { data: existing } = await adminDb
    .from('users').select('id').eq('email', email).maybeSingle()
  if (existing) return { error: 'Este e-mail já está cadastrado. Tente entrar ou use outro e-mail.' }

  // Cria o usuário sem enviar e-mail de confirmação
  const { data, error: authError } = await adminAuth.auth.admin.createUser({
    email,
    password: params.password,
    email_confirm: true,
    user_metadata: {
      full_name: params.name.trim(),
      name:      params.name.trim(),
      phone:     params.phone.trim(),
      apelido:   params.apelido.trim(),
    },
  })

  if (authError) {
    const msg = authError.message.toLowerCase()
    if (msg.includes('already registered') || msg.includes('already been registered')) {
      return { error: 'Este e-mail já está cadastrado.' }
    }
    return { error: 'Erro ao criar conta. Tente novamente.' }
  }
  if (!data.user) return { error: 'Erro ao criar conta. Tente novamente.' }

  // Cria perfil com status pendente
  await adminDb.from('users').insert({
    id:        data.user.id,
    name:      params.name.trim(),
    email,
    whatsapp:  params.phone.trim(),
    padrinho:  params.padrinho || null,
    apelido:   params.apelido.trim() || null,
    provider:  'email',
    status:    'email_pendente',
    approved:  false,
    paid:      false,
    is_admin:  false,
    is_manual: false,
    bio:       params.bio.trim() || null,
  })

  // Notifica admin
  if (await isEmailEnabled('notify_new_user')) {
    try { await notifyAdminNewUser({ name: params.name.trim(), email }) } catch { /* silent */ }
  }

  return {}
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
