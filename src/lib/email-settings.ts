import { createAdminClient } from '@/lib/supabase/server'

/**
 * Verifica se um tipo de e-mail está habilitado nas configurações.
 * Se não houver registro na tabela, assume habilitado (fail-open).
 */
export async function isEmailEnabled(key: string): Promise<boolean> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from('email_settings')
      .select('enabled')
      .eq('key', key)
      .maybeSingle()
    return data?.enabled !== false
  } catch {
    return true // fail-open: se a tabela não existir ainda, não bloqueia
  }
}
