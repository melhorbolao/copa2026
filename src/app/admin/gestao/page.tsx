import { createAuthAdminClient } from '@/lib/supabase/server'
import { getVisibilitySettings, buildAvailableRounds } from '@/lib/production-mode'
import { GestaoAdminClient } from './GestaoAdminClient'

export default async function GestaoAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [{ productionMode, releasedRounds }, { data: matchesRaw }] = await Promise.all([
    getVisibilitySettings(),
    admin.from('matches').select('phase, round, betting_deadline').order('match_datetime', { ascending: true }),
  ])

  const availableRounds = buildAvailableRounds(matchesRaw ?? [])

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Gestão</h2>
      <p className="mb-6 text-sm text-gray-500">
        Controle de visibilidade, exportação, importação e limpeza de dados do bolão.
      </p>
      <GestaoAdminClient
        productionMode={productionMode}
        releasedRounds={[...releasedRounds]}
        availableRounds={availableRounds}
      />
    </>
  )
}
