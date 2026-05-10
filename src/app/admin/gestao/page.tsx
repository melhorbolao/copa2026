import { createAuthAdminClient } from '@/lib/supabase/server'
import { getVisibilitySettings, buildAvailableRounds } from '@/lib/production-mode'
import { getPhaseSettings, roundKeyToStage } from '@/lib/phase-availability'
import { GestaoAdminClient } from './GestaoAdminClient'

export default async function GestaoAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [{ productionMode, releasedRounds }, phaseSettings, { data: matchesRaw }] = await Promise.all([
    getVisibilitySettings(),
    getPhaseSettings(),
    admin.from('matches').select('phase, round, betting_deadline').order('match_datetime', { ascending: true }),
  ])

  const availableRounds = buildAvailableRounds(matchesRaw ?? [])

  // Mapeia availableStages (StageKey) -> roundKeys do production-mode para
  // permitir que o GestaoAdminClient acompanhe o mesmo conjunto de toggles.
  const fillableRoundKeys = availableRounds
    .filter(r => {
      const stage = roundKeyToStage(r.key)
      return stage ? phaseSettings.availableStages.has(stage) : false
    })
    .map(r => r.key)

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Gestão</h2>
      <p className="mb-6 text-sm text-gray-500">
        Controle de visibilidade, exportação, importação e limpeza de dados do bolão.
      </p>
      <GestaoAdminClient
        productionMode={productionMode}
        releasedRounds={[...releasedRounds]}
        fillableRoundKeys={fillableRoundKeys}
        availableRounds={availableRounds}
      />
    </>
  )
}
