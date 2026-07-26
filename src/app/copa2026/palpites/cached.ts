import { unstable_cache } from 'next/cache'
import { createAuthAdminClient } from '@/lib/supabase/server'

/**
 * Config quasi-estática (regras, mapeamento de artilheiros, configuração do
 * artilheiro oficial) cacheada por 1 hora — admin atualiza raramente.
 *
 * Tags permitem invalidação manual via revalidateTag('scoring_rules' | …)
 * caso o admin atualize.
 */

export const getCachedScoringRules = unstable_cache(
  async (): Promise<Record<string, number>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin.from('scoring_rules').select('key, points')
    return Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data ?? []) as any[]).map((r: any) => [r.key, r.points])
    )
  },
  ['palpites:scoring_rules'],
  { revalidate: 3600, tags: ['scoring_rules'] },
)

export const getCachedScorerMapping = unstable_cache(
  async (): Promise<Record<string, string>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin.from('top_scorer_mapping').select('raw_name, standardized_name')
    return Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data ?? []) as any[]).map((m: any) => [m.raw_name.toLowerCase().trim(), m.standardized_name])
    )
  },
  ['palpites:top_scorer_mapping'],
  { revalidate: 3600, tags: ['top_scorer_mapping'] },
)

export const getCachedOfficialScorers = unstable_cache(
  async (): Promise<string[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAuthAdminClient() as any
    const { data } = await admin
      .from('tournament_settings')
      .select('value')
      .eq('key', 'official_top_scorer')
      .maybeSingle()
    if (!data?.value) return []
    try {
      const parsed = JSON.parse(data.value as string)
      return Array.isArray(parsed) ? parsed : [data.value as string]
    } catch {
      return [data.value as string]
    }
  },
  ['palpites:official_top_scorer'],
  { revalidate: 3600, tags: ['tournament_settings'] },
)
